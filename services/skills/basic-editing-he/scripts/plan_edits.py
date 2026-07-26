"""
Build the Edit Decision List for one episode.

Detects (autonomously):
  * head trim   - leading prep/silence before the episode really starts
  * tail trim   - trailing dead air after the last real speech
  * dead air    - long internal silences (candidate removals)
  * retakes     - near-duplicate consecutive segments (false starts / "let's do that again")
  * markers     - segments containing Hebrew retake/mistake cue words
Then MERGES the editor's pre-marked timecodes (cuts.txt), snaps every boundary to the
nearest silence so cuts land in pauses (not mid-word), and writes:
  * edit_plan.json  - machine plan: kept segments + removals (with reasons)
  * review.md       - human review sheet: every removal with timecode + transcript excerpt

Usage:
  python plan_edits.py <work_dir>
Reads  <work_dir>/transcript.json  and (video/audio) via config.json in the episode dir.
Env / config knobs documented in SKILL.md.
"""
import difflib, json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (detect_silences, ffprobe_duration, fmt_tc, parse_tc,
                    load_json, save_json)

# ---- Hebrew cue phrases that usually mark a mistake / retake / restart ----
# Multi-word only: single words like "עצור"/"רגע"/"סליחה"/"שוב" appear constantly in normal
# speech (e.g. "לעצור", "אבל שוב") and generate false positives — the model-review pass adds
# semantic cuts those would have caught. Matched as whole tokens (Hebrew-letter boundaries).
MARKER_WORDS = [
    "בוא נעשה שוב", "בואי נעשה שוב", "בוא נעשה את זה שוב", "בוא נתחיל שוב",
    "בואי נתחיל שוב", "אני עוצר", "אני עוצרת", "קאט", "בוא נחזור", "בואי נחזור",
    "פספסתי", "תחתוך את זה", "בלי השם", "בלי שמות", "נעשה את זה שוב",
]
HEB = "֐-ׯ"

def has_marker(text):
    for w in MARKER_WORDS:
        if re.search(rf"(?<![{HEB}]){re.escape(w)}(?![{HEB}])", text):
            return w
    return None

DEFAULTS = {
    "head_max_scan_sec": 180,     # only look for the real start within the first N sec
    "tail_max_scan_sec": 180,
    "deadair_min_sec": 3.0,       # internal silence longer than this -> candidate cut
    "deadair_keep_sec": 0.6,      # after cutting dead air, leave this much breathing room
    "retake_similarity": 0.82,    # difflib ratio over consecutive segments
    "snap_window_sec": 0.8,       # search this far for a silence to snap a boundary to
    "silence_noise_db": -45.0,
    "silence_min_dur": 0.35,
    "handle_sec": 0.15,           # small handle kept around speech at head/tail
    "auto_detect": True,          # False -> use ONLY cuts.txt (finalized/model-curated plan)
}


def load_config(work_dir):
    epi = os.path.dirname(work_dir.rstrip("/\\")) or "."
    cfg_path = os.path.join(epi, "config.json")
    cfg = dict(DEFAULTS)
    if os.path.exists(cfg_path):
        cfg.update(load_json(cfg_path))
    # resolve source media (prefer explicit config, else raw.* in episode dir)
    src = cfg.get("source")
    if src and not os.path.isabs(src):
        src = os.path.join(epi, src)
    if not src or not os.path.exists(src):
        cands = [f for f in os.listdir(epi)
                 if f.lower().endswith((".mp4", ".mov", ".mkv"))
                 and "final" not in f.lower() and "intro" not in f.lower()
                 and "outro" not in f.lower()]
        # biggest file = the raw capture
        cands.sort(key=lambda f: os.path.getsize(os.path.join(epi, f)), reverse=True)
        if cands:
            src = os.path.join(epi, cands[0])
    cfg["_source"] = src
    cfg["_episode_dir"] = epi
    return cfg


def parse_user_cuts(epi):
    """cuts.txt lines: 'START-END  reason'  or  'START END reason'. TC = s / m:s / h:m:s."""
    path = os.path.join(epi, "cuts.txt")
    out = []
    if not os.path.exists(path):
        return out
    for ln in open(path, encoding="utf-8"):
        ln = ln.strip()
        if not ln or ln.startswith("#"):
            continue
        body = ln.split(None, 0)
        seg = ln.replace("-", " ").replace("\t", " ")
        toks = seg.split()
        try:
            a = parse_tc(toks[0]); b = parse_tc(toks[1])
        except Exception:
            continue
        reason = " ".join(toks[2:]) or "editor-marked"
        if a is not None and b is not None and b > a:
            out.append({"start": a, "end": b, "reason": f"editor: {reason}", "src": "editor"})
    return out


def nearest_silence_edge(t, silences, window):
    """Snap time t to the closest silence midpoint within +/- window; else return t."""
    best = t; bestd = window + 1
    for (s, e) in silences:
        mid = (s + e) / 2
        for cand in (mid, s, e):
            d = abs(cand - t)
            if d < bestd:
                bestd = d; best = cand
    return best if bestd <= window else t


def main():
    work = sys.argv[1]
    cfg = load_config(work)
    epi = cfg["_episode_dir"]
    src = cfg["_source"]
    tj = load_json(os.path.join(work, "transcript.json"))
    segs = tj["segments"]
    total = tj.get("duration") or ffprobe_duration(src)

    audio_for_sil = os.path.join(work, "raw_audio_16k.wav")
    sil_src = audio_for_sil if os.path.exists(audio_for_sil) else src
    silences = detect_silences(sil_src, cfg["silence_noise_db"], cfg["silence_min_dur"])

    removals = []

    if cfg["auto_detect"]:
        # ---- HEAD trim: cut from 0 up to first real speech (within scan window) ----
        if segs:
            first = segs[0]["start"]
            if first > 1.0 and first <= cfg["head_max_scan_sec"]:
                removals.append({"start": 0.0, "end": max(0.0, first - cfg["handle_sec"]),
                                 "reason": "head: prep/silence before episode start", "src": "auto"})

        # ---- TAIL trim: cut from last real speech to end ----
        if segs:
            last = segs[-1]["end"]
            if total - last > 1.0 and total - last <= cfg["tail_max_scan_sec"]:
                removals.append({"start": min(total, last + cfg["handle_sec"]), "end": total,
                                 "reason": "tail: dead air after episode end", "src": "auto"})

        # ---- DEAD AIR: long internal silences ----
        body_lo = segs[0]["start"] if segs else 0
        body_hi = segs[-1]["end"] if segs else total
        for (s, e) in silences:
            if e - s >= cfg["deadair_min_sec"] and s > body_lo + 1 and e < body_hi - 1:
                keep = cfg["deadair_keep_sec"]
                removals.append({"start": s + keep, "end": e - keep,
                                 "reason": f"dead air {e-s:.1f}s", "src": "auto"})

        # ---- RETAKES: near-duplicate consecutive segments ----
        for i in range(len(segs) - 1):
            a, b = segs[i], segs[i + 1]
            r = difflib.SequenceMatcher(None, a["text"], b["text"]).ratio()
            if r >= cfg["retake_similarity"] and len(a["text"]) > 12:
                removals.append({"start": a["start"], "end": b["start"],
                                 "reason": f"retake/false-start (sim {r:.2f}): “{a['text'][:40]}”",
                                 "src": "auto"})

        # ---- MARKER cue phrases ----
        for s in segs:
            w = has_marker(s["text"])
            if w:
                removals.append({"start": s["start"], "end": s["end"],
                                 "reason": f"cue “{w}”: {s['text'][:50]}", "src": "auto"})

    # ---- MERGE editor-marked cuts (always) ----
    removals += parse_user_cuts(epi)

    # ---- snap boundaries to silence, clamp, drop invalid ----
    for r in removals:
        if r["src"] != "auto" or "head" not in r["reason"] and "tail" not in r["reason"]:
            r["start"] = nearest_silence_edge(r["start"], silences, cfg["snap_window_sec"])
            r["end"] = nearest_silence_edge(r["end"], silences, cfg["snap_window_sec"])
        r["start"] = max(0.0, min(total, r["start"]))
        r["end"] = max(0.0, min(total, r["end"]))
    removals = [r for r in removals if r["end"] - r["start"] > 0.1]

    # ---- merge overlapping removals ----
    removals.sort(key=lambda x: x["start"])
    merged = []
    for r in removals:
        if merged and r["start"] <= merged[-1]["end"] + 0.05:
            if r["end"] > merged[-1]["end"]:
                merged[-1]["end"] = r["end"]
                merged[-1]["reason"] += " + " + r["reason"]
        else:
            merged.append(dict(r))

    # ---- compute kept segments (complement) ----
    kept = []
    cur = 0.0
    for r in merged:
        if r["start"] > cur + 0.05:
            kept.append({"start": round(cur, 3), "end": round(r["start"], 3)})
        cur = max(cur, r["end"])
    if total - cur > 0.05:
        kept.append({"start": round(cur, 3), "end": round(total, 3)})

    kept_dur = sum(k["end"] - k["start"] for k in kept)
    plan = {
        "source": src, "total_sec": round(total, 3),
        "kept_sec": round(kept_dur, 3), "removed_sec": round(total - kept_dur, 3),
        "n_removals": len(merged), "kept": kept, "removals": [
            {"start": round(r["start"], 3), "end": round(r["end"], 3),
             "dur": round(r["end"] - r["start"], 3), "reason": r["reason"], "src": r["src"]}
            for r in merged],
        "config": {k: cfg[k] for k in DEFAULTS},
    }
    save_json(os.path.join(work, "edit_plan.json"), plan)

    # ---- human review sheet ----
    def seg_text_at(a, b):
        return " ".join(s["text"] for s in segs if s["start"] < b and s["end"] > a)[:200]
    lines = ["# עריכה בסיסית — גיליון בדיקה", "",
             f"מקור: `{os.path.basename(src)}`  ·  אורך גלם: **{fmt_tc(total)}**",
             f"אחרי חיתוך: **{fmt_tc(kept_dur)}**  ·  הוסר: **{fmt_tc(total-kept_dur)}** "
             f"ב-{len(merged)} חיתוכים", "",
             "לכל חיתוך: קליפ תצוגה `preview_NN.mp4` (איך הקאט יישמע) + `removed_NN.mp4` "
             "(מה נמחק). אשרו / תקנו טיימקוד / בטלו.", "",
             "| # | טיימקוד (מ:ש) | משך | סוג | תמלול באזור |",
             "|---|---|---|---|---|"]
    for i, r in enumerate(merged, 1):
        lines.append(f"| {i:02d} | {fmt_tc(r['start'])} → {fmt_tc(r['end'])} | "
                     f"{r['end']-r['start']:.1f}s | {r['reason'][:60]} | "
                     f"{seg_text_at(r['start'], r['end'])[:90]} |")
    with open(os.path.join(work, "review.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    print(f"[plan] total {fmt_tc(total)} -> kept {fmt_tc(kept_dur)} "
          f"({len(merged)} removals, {total-kept_dur:.1f}s cut)")
    for i, r in enumerate(merged, 1):
        print(f"  {i:02d}. {fmt_tc(r['start'])} -> {fmt_tc(r['end'])}  "
              f"({r['end']-r['start']:.1f}s)  {r['reason'][:70]}")


if __name__ == "__main__":
    main()
