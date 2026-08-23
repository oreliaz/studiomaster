"""
ONE finished episode from the (reviewed) edit_plan.json — robust against environments that
kill any single long ffmpeg pass. Strategy: AUDIO is processed CONTINUOUSLY (fast, so the
speaker-leveling dynaudnorm sees the whole timeline — no chunk-boundary pumping), while the
slow VIDEO encode is done in short time-CHUNKS and stream-concatenated.

Pipeline:
  audio:  extract full 48k wav -> sound chain (highpass+denoise+level+compress) -> CUT to
          kept ranges -> loudnorm to target + true-peak limiter            -> aud_final.m4a
  video:  encode each kept range in <=chunk_sec frame-accurate pieces (video only) -> concat
          -> body_v.mp4
  body:   mux body_v + aud_final (both stream-copied)                      -> body.mp4
  final:  match intro/outro to body params, concat-copy intro+body+outro   -> final.mp4

Every ffmpeg invocation stays short (audio passes are seconds; each video chunk ~2 min;
concats are stream-copy). Resumable: a complete body.mp4 is reused.

Usage:  python render_final.py <work_dir>
Config (episode dir/config.json): intro, outro, target_lufs(-16), target_tp(-1.5),
  target_lra(11), highpass_hz(80), denoise("afftdn"|"none"), dialogue_level("gentle"|
  "strong"|"off"), v_bitrate("10M"), preset("faster"), chunk_sec(200).
"""
import os, re, shutil, subprocess, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import load_json, measure_loudness, ffprobe_json, ffprobe_duration, fmt_tc

DEF = {"target_lufs": -16.0, "target_tp": -1.5, "target_lra": 11.0, "highpass_hz": 80,
       "denoise": "afftdn", "dialogue_level": "gentle", "v_bitrate": "10M",
       "preset": "faster", "intro": None, "outro": None, "chunk_sec": 200,
       "intro_dissolve": True, "dissolve_dur": 0.7,
       # ── Per-microphone audio (multitrack recordings) ──────────────────────
       # OBS multitrack: audio stream 0 = the mixed-down (mixdown) track, streams
       # 1..N = one microphone each. We DROP the mixdown, keep only microphones
       # that were actually used, balance them to a common level, and fold each to
       # mono so every voice is heard equally in both speakers.
       "per_mic_audio": True,       # set False to force the plain stereo extraction
       "active_max_db": -40.0,      # a mic is "used" if its peak is louder than this
       "mic_target_db": -24.0,      # balance each mic's average toward this level
       "max_mic_gain_db": 15.0}     # never push a single mic by more than this


def cfg_get(work):
    epi = os.path.dirname(work.rstrip("/\\")) or "."
    c = dict(DEF)
    p = os.path.join(epi, "config.json")
    if os.path.exists(p):
        c.update(load_json(p))
    for k in ("intro", "outro", "source"):
        if c.get(k) and not os.path.isabs(c[k]):
            c[k] = os.path.join(epi, c[k])
    c["_epi"] = epi
    return c


def run(cmd, label=""):
    if label:
        print(f"  $ {label}", flush=True)
    r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                       text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        sys.stderr.write((r.stdout or "")[-3000:])
        raise SystemExit(f"ffmpeg failed ({r.returncode}) at: {label}")
    return r.stdout


def audio_chain(c):
    ch = [f"highpass=f={c['highpass_hz']}"]
    if c["denoise"] and c["denoise"] != "none":
        ch.append("afftdn=nf=-25" if c["denoise"] == "afftdn" else c["denoise"])
    if c["dialogue_level"] == "gentle":
        ch.append("dynaudnorm=f=250:g=13:p=0.92:m=10:s=10")
        ch.append("acompressor=threshold=-22dB:ratio=2.5:attack=20:release=250:makeup=2")
    elif c["dialogue_level"] == "strong":
        ch.append("dynaudnorm=f=200:g=11:p=0.95:m=12:s=12")
        ch.append("acompressor=threshold=-20dB:ratio=3.5:attack=15:release=200:makeup=3")
    return ",".join(ch)


# Output frame rate (video is forced to this everywhere: vf "fps=30", match_clip).
FPS = 30.0


def _snap_fps(t):
    """Snap a time to the output frame grid so audio (sample-exact) and video
    (whole frames) cut at the SAME instants — otherwise each cut adds a small
    A/V mismatch that accumulates into a growing sound delay."""
    return round(float(t) * FPS) / FPS


def kept_ranges(plan):
    out = []
    for k in plan["kept"]:
        s = _snap_fps(k["start"])
        e = _snap_fps(k["end"])
        if e - s > 0.05:
            out.append((s, e))
    return out


def _ok(path, dur, tol=2.0):
    if not os.path.exists(path):
        return False
    try:
        return abs(ffprobe_duration(path) - dur) < tol
    except (ValueError, Exception):
        return False  # corrupt/partial file (e.g. killed mid-write) -> re-make it


def _audio_stream_count(src):
    """How many audio streams the source carries (mixdown + per-mic tracks)."""
    try:
        info = ffprobe_json(src)
    except Exception:
        return 0
    return sum(1 for s in info.get("streams", []) if s.get("codec_type") == "audio")


def _stream_stats(src, ai):
    """(mean_db, max_db) for audio stream `ai` via ffmpeg volumedetect.
    Returns (None, None) for a silent/empty channel (mean is -inf)."""
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-vn",
                        "-i", src, "-map", f"0:a:{ai}", "-af", "volumedetect",
                        "-f", "null", "-"],
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                       text=True, encoding="utf-8", errors="replace").stdout
    def grab(label):
        m = re.search(label + r":\s*(-?[\d.]+) dB", r)
        return float(m.group(1)) if m else None
    return grab("mean_volume"), grab("max_volume")


def _active_mics(src, c):
    """Identify which microphone tracks were actually used.

    Returns a list of (stream_index, mean_db) for the active mics, or None to
    signal "no per-mic layout detected — extract the mixed track as usual".
    Stream 0 is treated as the mixdown and always skipped when >=2 streams exist.
    """
    if not c.get("per_mic_audio", True):
        return None
    n = _audio_stream_count(src)
    if n < 2:
        return None                      # single track -> nothing to drop/balance
    active = []
    for ai in range(1, n):               # skip stream 0 = mixdown
        mean_db, max_db = _stream_stats(src, ai)
        if max_db is not None and max_db > c["active_max_db"]:
            active.append((ai, mean_db if mean_db is not None else -30.0))
    if not active:
        return None                      # couldn't tell mics apart -> safe fallback
    return active


def _extract_per_mic(src, raw, mics, c):
    """Balance the active mics to a common level, fold to mono, and lay that mono
    signal into BOTH stereo channels (heard equally left+right). Drops the
    mixdown and every unused track."""
    parts = []
    for j, (ai, mean_db) in enumerate(mics):
        gain = max(-c["max_mic_gain_db"], min(c["max_mic_gain_db"],
                                              c["mic_target_db"] - mean_db))
        parts.append(f"[0:a:{ai}]aformat=channel_layouts=mono,"
                     f"volume={gain:.1f}dB[m{j}]")
    mix = "".join(f"[m{j}]" for j in range(len(mics)))
    parts.append(f"{mix}amix=inputs={len(mics)}:normalize=0[mono]")
    parts.append("[mono]pan=stereo|c0=c0|c1=c0[out]")
    fc = ";".join(parts)
    labels = ", ".join(f"a:{ai} ({mean:.0f}dB)" for ai, mean in mics)
    run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", src,
         "-filter_complex", fc, "-map", "[out]", "-ar", "48000",
         "-c:a", "pcm_s16le", raw], f"balance mics -> mono [{labels}]")


def build_audio_final(work, c, src, plan):
    """Continuous chain -> cut -> CHUNKED loudnorm+limiter. Resumable at each step.
    loudnorm uses global measured values (constant gain) so per-chunk == single pass."""
    out = os.path.join(work, "aud_final.m4a")
    if _ok(out, plan["kept_sec"]):
        print("[render] reusing aud_final.m4a", flush=True)
        return out
    raw = os.path.join(work, "aud_raw.wav")
    if not _ok(raw, plan["total_sec"]):
        mics = _active_mics(src, c)
        if mics:
            print(f"[render] per-mic audio: keeping {len(mics)} active mic(s), "
                  f"dropping mixdown + unused tracks", flush=True)
            _extract_per_mic(src, raw, mics, c)
        else:
            run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-vn", "-i", src,
                 "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", raw], "extract full audio")
    chained = os.path.join(work, "aud_chain.wav")
    if not _ok(chained, plan["total_sec"]):
        run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", raw,
             "-af", audio_chain(c), "-c:a", "pcm_s16le", chained], "sound chain (continuous)")
    cut = os.path.join(work, "aud_cut.wav")
    if not _ok(cut, plan["kept_sec"]):
        ranges = kept_ranges(plan)
        parts = "".join(f"[0:a]atrim={s}:{e},asetpts=N/SR/TB[a{i}];"
                        for i, (s, e) in enumerate(ranges))
        parts += "".join(f"[a{i}]" for i in range(len(ranges))) + \
                 f"concat=n={len(ranges)}:v=0:a=1[a]"
        run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", chained,
             "-filter_complex", parts, "-map", "[a]", "-c:a", "pcm_s16le", cut], "cut audio")

    mcache = os.path.join(work, "_measure.json")
    if os.path.exists(mcache):
        m = load_json(mcache)
    else:
        m = measure_loudness(cut)
        from common import save_json
        save_json(mcache, m)
    print(f"[render] cut audio {m['input_i']} LUFS / {m['input_tp']} dBTP "
          f"-> target {c['target_lufs']}", flush=True)
    ln = (f"loudnorm=I={c['target_lufs']}:TP={c['target_tp']}:LRA={c['target_lra']}"
          f":measured_I={m['input_i']}:measured_TP={m['input_tp']}"
          f":measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:linear=true")
    lim = round(10 ** (c["target_tp"] / 20.0), 4)
    af = f"{ln},alimiter=limit={lim}:level=disabled"

    ad = os.path.join(work, "_achunks"); os.makedirs(ad, exist_ok=True)
    total = ffprobe_duration(cut); chunk = float(c["chunk_sec"]); t = 0.0; i = 0
    listf = os.path.join(work, "_aconcat.txt")
    with open(listf, "w", encoding="utf-8") as lf:
        while t < total - 0.02:
            dur = min(chunk, total - t)
            outc = os.path.join(ad, f"a{i:04d}.m4a")
            if not _ok(outc, dur, 0.3):
                run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                     "-ss", f"{t}", "-t", f"{dur}", "-i", cut, "-af", af,
                     "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-ac", "2", outc],
                    f"loudnorm chunk {i+1} @ {fmt_tc(t)}")
            lf.write(f"file '{outc}'\n"); t += dur; i += 1
    run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0",
         "-i", listf, "-c", "copy", out], "concat audio chunks")
    return out


def build_video_body(work, c, src, plan):
    """Encode each kept range in <=chunk_sec frame-accurate video-only pieces; concat.
    Resumable: an existing correct chunk (or body_v) is reused."""
    body_v = os.path.join(work, "body_v.mp4")
    if _ok(body_v, plan["kept_sec"]):
        print("[render] reusing body_v.mp4", flush=True)
        return body_v
    vd = os.path.join(work, "_vchunks")
    os.makedirs(vd, exist_ok=True)
    chunk = float(c["chunk_sec"])
    pieces = []
    for (s, e) in kept_ranges(plan):
        t = s
        while t < e - 0.02:
            u = min(e, t + chunk)
            pieces.append((t, u - t))
            t = u
    listf = os.path.join(work, "_vconcat.txt")
    vf = "fps=30,format=yuv420p,setsar=1"
    with open(listf, "w", encoding="utf-8") as lf:
        for i, (s, dur) in enumerate(pieces):
            outp = os.path.join(vd, f"v{i:04d}.mp4")
            if not _ok(outp, dur, 0.4):
                pre = min(4.0, s)                   # fast-seek to keyframe before, then accurate
                run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                     "-ss", f"{s-pre}", "-i", src, "-ss", f"{pre}", "-t", f"{dur}",
                     "-an", "-vf", vf, "-c:v", "libx264", "-b:v", c["v_bitrate"],
                     "-preset", c["preset"], "-g", "60",
                     outp], f"video chunk {i+1}/{len(pieces)} @ {fmt_tc(s)}")
            lf.write(f"file '{outp}'\n")
    run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0",
         "-i", listf, "-c", "copy", body_v], "concat video chunks")
    return body_v


def match_clip(path, c, tmp, name):
    out = os.path.join(tmp, name)
    run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", path,
         "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,"
                "pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p",
         "-c:v", "libx264", "-b:v", c["v_bitrate"], "-preset", c["preset"], "-g", "60",
         "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-ac", "2", out], f"match {name}")
    return out


def detect_trailing_black(path):
    """If the intro ends with a black section (a 'black cut'), return its start time, else None.
    That start is where the episode should begin while the intro music keeps playing under it."""
    dur = ffprobe_duration(path)
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", path,
                        "-vf", "blackdetect=d=1.0:pix_th=0.10", "-f", "null", "-"],
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                       encoding="utf-8", errors="replace").stdout
    best = None
    for m in re.finditer(r"black_start:([\d.]+) black_end:([\d.]+)", r):
        s, e = float(m.group(1)), float(m.group(2))
        if e >= dur - 1.5 and e - s >= 2.0 and s > 3.0:   # a real trailing-black tail
            best = s
    return best


def kf_at_or_after(path, t):
    """First video keyframe timestamp >= t (for a clean stream-copy split); fallback t."""
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0",
                        "-skip_frame", "nokey", "-show_entries", "frame=pts_time",
                        "-of", "csv=p=0", "-read_intervals", f"{t}%{t+12}", path],
                       stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True).stdout
    ks = sorted(float(x) for x in r.split() if x.strip())
    for k in ks:
        if k >= t - 0.05:
            return k
    return t


def build_intro_dissolve(work, c, intro_m, body, black_start, tmp):
    """intro logo -> FADE dissolve into body at the black cut; intro music continues under the
    episode opening and fades out. Returns (transition_clip, split_time). Matches the house style."""
    dur = float(c.get("dissolve_dur", 0.7))
    intro_len = ffprobe_duration(intro_m)
    offset = max(0.0, black_start - dur * 0.8)           # blend centered on the black cut
    need = (intro_len - offset) + 3.0                    # body must cover the music overlap
    split = kf_at_or_after(body, need)
    off_ms = int(round(offset * 1000))
    lim = round(10 ** (c["target_tp"] / 20.0), 4)
    fc = (f"[0:v]fps=30,format=yuv420p,setsar=1[iv];"
          f"[1:v]trim=0:{split},setpts=PTS-STARTPTS,fps=30,format=yuv420p,setsar=1[bv];"
          f"[iv][bv]xfade=transition=fade:duration={dur}:offset={offset}[vout];"
          f"[0:a]afade=out:st={max(0,intro_len-3):.2f}:d=3[ia];"
          f"[1:a]atrim=0:{split},asetpts=PTS-STARTPTS,afade=in:st=0:d=0.4,"
          f"adelay={off_ms}|{off_ms}[ba];"
          f"[ia][ba]amix=inputs=2:duration=longest:normalize=0,"
          f"alimiter=limit={lim}:level=disabled[aout]")
    trans = os.path.join(tmp, "transition.mp4")
    run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", intro_m, "-i", body,
         "-filter_complex", fc, "-map", "[vout]", "-map", "[aout]",
         "-c:v", "libx264", "-b:v", c["v_bitrate"], "-preset", c["preset"], "-g", "60",
         "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-ac", "2",
         trans], f"intro dissolve @ {fmt_tc(offset)} (music under, fade)")
    return trans, split


def assemble(work, c, body):
    intro, outro = c.get("intro"), c.get("outro")
    have = [p for p in (intro, outro) if p and os.path.exists(p)]
    final = os.path.join(work, "final.mp4")
    if not have:
        shutil.copyfile(body, final)
        print("[render] no intro/outro provided — final = body only", flush=True)
        return final
    tmp = tempfile.mkdtemp(prefix="be_")
    seq = []
    if intro and os.path.exists(intro):
        intro_m = match_clip(intro, c, tmp, "intro.mp4")
        black = detect_trailing_black(intro_m) if c.get("intro_dissolve", True) else None
        if black:
            print(f"[render] intro has black cut @ {fmt_tc(black)} -> music-over dissolve", flush=True)
            trans, split = build_intro_dissolve(work, c, intro_m, body, black, tmp)
            rest = os.path.join(work, "bodyrest.mp4")
            run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{split}",
                 "-i", body, "-c", "copy", "-avoid_negative_ts", "make_zero", rest],
                f"body from {fmt_tc(split)} (copy)")
            seq += [trans, rest]
        else:
            seq += [intro_m, body]
    else:
        seq.append(body)
    if outro and os.path.exists(outro):
        seq.append(match_clip(outro, c, tmp, "outro.mp4"))
    listf = os.path.join(tmp, "list.txt")
    with open(listf, "w", encoding="utf-8") as f:
        for p in seq:
            f.write(f"file '{p}'\n")
    r = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                        "-f", "concat", "-safe", "0", "-i", listf, "-c", "copy",
                        "-movflags", "+faststart", final],
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if r.returncode != 0:
        print("[render] concat-copy failed; re-muxing intro/outro via TS then concat", flush=True)
        tss = []
        for p in seq:
            ts = p + ".ts"
            run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", p,
                 "-c", "copy", "-bsf:v", "h264_mp4toannexb", "-f", "mpegts", ts], "->ts")
            tss.append(ts)
        run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
             "-i", "concat:" + "|".join(tss), "-c", "copy",
             "-bsf:a", "aac_adtstoasc", "-movflags", "+faststart", final], "concat ts")
    print(f"[render] assembled intro/body/outro -> {final}", flush=True)
    return final


def main():
    work = os.path.abspath(sys.argv[1])  # absolute so concat list entries resolve correctly
    c = cfg_get(work)
    plan = load_json(os.path.join(work, "edit_plan.json"))
    src = c.get("source") or plan["source"]
    print(f"[render] {len(plan['kept'])} kept segments, body ~{fmt_tc(plan['kept_sec'])}", flush=True)

    body = os.path.join(work, "body.mp4")
    if os.path.exists(body) and abs(ffprobe_duration(body) - plan["kept_sec"]) < 1.5:
        print("[render] reusing existing body.mp4", flush=True)
    else:
        aud = build_audio_final(work, c, src, plan)
        body_v = build_video_body(work, c, src, plan)
        run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", body_v, "-i", aud,
             "-map", "0:v", "-map", "1:a", "-c", "copy", "-movflags", "+faststart", body],
            "mux body")

    final = assemble(work, c, body)
    fin = measure_loudness(final)
    dur = ffprobe_duration(final)
    tp = fin['input_tp'] if fin['input_tp'] is not None else f"<= {c['target_tp']}"
    print(f"\n[render] DONE -> {final}")
    print(f"        duration {fmt_tc(dur)}  ·  loudness {fin['input_i']} LUFS  ·  peak {tp} dBTP")


if __name__ == "__main__":
    main()
