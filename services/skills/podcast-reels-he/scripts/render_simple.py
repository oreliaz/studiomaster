"""
SIMPLE style renderer — popping Hebrew captions in Aduma Bold, white with a black
outline, 4 words per line (already enforced by build_captions.py), RTL, 9:16.

Presenter is scaled-to-cover 1080x1920 and centre-cropped (robust for any source;
keeps a centred speaker framed). Optional persistent top hook, background music
(ducked), and logo overlay.

Routes the heavy ffmpeg encode through the central render queue (rq).

Usage:
  python render_simple.py <clip.mp4> <captions.json> <out.mp4> \
         [--hook "טקסט הוק"] [--crop-x N] [--music PATH] [--music-vol 0.10] \
         [--logo PATH] [--font Aduma]
"""
import argparse, json, os, shutil, subprocess, sys, tempfile

SKILL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTS_DIR = os.path.join(SKILL_DIR, "assets", "fonts")
RLE = "‫"  # RIGHT-TO-LEFT EMBEDDING — prepend to every Hebrew line

W, H = 1080, 1920


def _find_queue_dir():
    cands = [os.environ.get("RENDER_QUEUE_DIR"),
             os.path.join(os.path.expanduser("~"), "Desktop", "claude-code", "render-queue"),
             r"C:\Users\OR\Desktop\claude-code\render-queue"]
    for d in cands:
        if d and os.path.exists(os.path.join(d, "rq_guard.py")):
            return d
    return None


def queue():
    d = _find_queue_dir()
    if not d:
        print("[simple] no render queue found; rendering directly.", file=sys.stderr)
        return
    try:
        sys.path.insert(0, d)
        from rq_guard import ensure_queued
        ensure_queued("PODCAST-REELS-HE")
    except Exception as e:
        print(f"[simple] rq_guard unavailable ({e}); rendering directly.", file=sys.stderr)


def ass_time(t):
    h, rem = divmod(float(t), 3600); m, s = divmod(rem, 60)
    return f"{int(h)}:{int(m):02d}:{s:05.2f}"


def build_ass(caps, hook, dur, font):
    head = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {W}
PlayResY: {H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,{font},86,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,6,3,2,80,80,360,1
Style: Hook,{font},74,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,6,3,8,90,90,235,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    ev = []
    # pop-in: small overshoot then settle, with a soft fade
    pop = r"{\fad(70,50)\fscx72\fscy72\t(0,130,\fscx105\fscy105)\t(130,210,\fscx100\fscy100)}"
    for c in caps:
        txt = RLE + c["text"].replace("\n", " ")
        ev.append(f"Dialogue: 0,{ass_time(c['start'])},{ass_time(c['end'])},Cap,,0,0,0,,{pop}{txt}")
    if hook:
        ev.append(f"Dialogue: 0,{ass_time(0)},{ass_time(dur)},Hook,,0,0,0,,"
                  f"{{\\fad(120,0)}}{RLE}{hook}")
    return head + "\n".join(ev) + "\n"


def ffprobe_dur(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                          "-of", "default=nk=1:nw=1", path], capture_output=True, text=True)
    return float(out.stdout.strip() or 0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("clip"); ap.add_argument("captions"); ap.add_argument("out")
    ap.add_argument("--hook", default="")
    ap.add_argument("--crop-x", type=int, default=0)
    ap.add_argument("--music", default="")
    ap.add_argument("--music-vol", type=float, default=0.10)
    ap.add_argument("--logo", default="")
    ap.add_argument("--font", default="Aduma")
    a = ap.parse_args()

    caps = json.load(open(a.captions, encoding="utf-8"))
    dur = ffprobe_dur(a.clip)

    tmp = tempfile.mkdtemp(prefix="prh_simple_")
    shutil.copytree(FONTS_DIR, os.path.join(tmp, "fonts"))
    ass_path = os.path.join(tmp, "subs.ass")
    open(ass_path, "w", encoding="utf-8").write(build_ass(caps, a.hook, dur, a.font))

    clip = os.path.abspath(a.clip); out = os.path.abspath(a.out)
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)

    inputs = ["-i", clip]
    music_on = a.music and os.path.exists(a.music)
    logo_on = a.logo and os.path.exists(a.logo)
    if logo_on:
        inputs += ["-i", os.path.abspath(a.logo)]
    if music_on:
        inputs += ["-stream_loop", "-1", "-i", os.path.abspath(a.music)]

    cover = (f"[0:v]scale={W}:{H}:force_original_aspect_ratio=increase,"
             f"crop={W}:{H}:(in_w-{W})/2+{a.crop_x}:(in_h-{H})/2,setsar=1[base]")
    chain = [cover]
    vlast = "base"
    if logo_on:
        chain.append("[1:v]scale=360:-1[logo]")
        chain.append(f"[{vlast}][logo]overlay=(W-w)/2:1640[wl]"); vlast = "wl"
    # subtitles read relative to cwd=tmp
    chain.append(f"[{vlast}]subtitles=subs.ass:fontsdir=fonts[v]")

    audio_map = "0:a:0"
    if music_on:
        mi = 2 if logo_on else 1
        chain.append(f"[0:a]volume=1.0[voice];[{mi}:a]volume={a.music_vol}[bg];"
                     f"[voice][bg]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]")
        audio_map = "[a]"

    fc = ";".join(chain)
    cmd = ["ffmpeg", "-y", *inputs, "-filter_complex", fc, "-map", "[v]", "-map", audio_map,
           "-t", f"{dur:.3f}", "-c:v", "libx264", "-preset", "medium", "-crf", "20",
           "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
           "-movflags", "+faststart", out]

    queue()
    print(f"[simple] rendering {os.path.basename(clip)} -> {out}", flush=True)
    subprocess.run(cmd, check=True, cwd=tmp)
    shutil.rmtree(tmp, ignore_errors=True)
    print(f"[simple] DONE -> {out}", flush=True)


if __name__ == "__main__":
    main()
