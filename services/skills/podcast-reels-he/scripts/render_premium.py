"""
PREMIUM style renderer — the "hyperframes / Chris" converged look, in Hebrew (RTL).

Self-contained: uses this skill's VENDORED engine (engine/build_reel.py builds the
transparent GSAP overlay HTML; scripts/render_overlay_he.js composites it with
puppeteer -> ffmpeg over the full-frame presenter + ducked music). Falls back to a
sibling reels-pro/reelkit if you set REELS_PRO_REELKIT.

Persistent face-safe hook + 2-4 word captions with amber number highlights, optional
stat/headline cards and full-screen b-roll cutaways.

B-ROLL is automatic: if `gen_brolls_he.py` wrote <WORK>/broll/<NN>.brolls.json for this
clip, it is picked up with no extra flags. Override/point explicitly with --brolls PATH,
or pass a full reels-pro --config to control everything.

Routes the heavy render through the central render queue (rq).

Usage (minimal — hook + captions [+ auto b-roll] + music):
  python render_premium.py <clip.mp4> <out.mp4> --captions <captions.json> \
         --hook "טקסט ההוק" [--watermark "שם"] [--brolls PATH] [--music PATH] \
         [--music-vol 0.13] [--crop-x N] [--premium]

Usage (full control — author a reels-pro config.json with cards/brolls):
  python render_premium.py <clip.mp4> <out.mp4> --config <config.json> [--music PATH]
"""
import argparse, glob, json, os, re, subprocess, sys, tempfile

_HERE = os.path.dirname(os.path.abspath(__file__))
_SKILL = os.path.dirname(_HERE)
_SKILLS_DIR = os.path.dirname(_SKILL)

# Vendored engine first (self-contained); sibling reels-pro as an override/fallback.
_VENDORED = os.path.join(_SKILL, "engine")
REELKIT = (os.environ.get("REELS_PRO_REELKIT")
           or (_VENDORED if os.path.exists(os.path.join(_VENDORED, "build_reel.py"))
               else os.path.join(_SKILLS_DIR, "reels-pro", "reelkit")))
ASSETS = os.path.join(REELKIT, "assets")
BUILD = os.path.join(REELKIT, "build_reel.py")
OVERLAY = os.path.join(_HERE, "render_overlay_he.js")   # portable compositor (this skill)
DEFAULT_MUSIC = os.path.join(ASSETS, "music.mp3")

RTL_CSS = """
  /* ---- Hebrew / RTL overrides (podcast-reels-he) ---- */
  #reel { direction: rtl; }
  .hook-txt, .cap, .broll-tag, .broll-headline, .hl-text, .stat-eyebrow,
  .hl-eyebrow, .topbar, .brand-name {
    direction: rtl; unicode-bidi: plaintext;
    font-family: 'Heebo','Rubik',sans-serif;
  }
  .stat-unit { text-align: right; }
  .cap { width: max-content; max-width: 1000px; font-size: 54px; padding: 12px 30px; }
  .card { top: 880px; }
  /* B-ROLL: neutralise GSAP's inline transform so the cutaway stays FULL-FRAME and
     OPAQUE for its whole window (otherwise the presenter flashes through for a frame). */
  #reel .broll, #reel .broll-img { transform: none !important; }
"""


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
        print("[premium] no render queue found; rendering directly.", file=sys.stderr)
        return
    try:
        sys.path.insert(0, d)
        from rq_guard import ensure_queued
        ensure_queued("PODCAST-REELS-HE")
    except Exception as e:
        print(f"[premium] rq_guard unavailable ({e}); rendering directly.", file=sys.stderr)


def ffprobe_dur(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                          "-of", "default=nk=1:nw=1", path], capture_output=True, text=True)
    return float(out.stdout.strip() or 0)


def rtl_patch(html_path):
    s = open(html_path, encoding="utf-8").read()
    s = s.replace('<html lang="en" dir="ltr">', '<html lang="he" dir="rtl">')
    extra = os.environ.get("PRH_ACCENT_CSS", "")
    s = s.replace("</style>", RTL_CSS + extra + "</style>", 1)
    open(html_path, "w", encoding="utf-8").write(s)


def discover_brolls(clip, explicit):
    """Load the b-roll manifest for this clip. Explicit --brolls wins; else auto-discover
    <WORK>/broll/<NN>.brolls.json (WORK = parent of the clip's folder)."""
    if explicit and os.path.exists(explicit):
        return json.load(open(explicit, encoding="utf-8"))
    m = re.match(r"^(\d{2}|\w+)", os.path.basename(clip))
    nn = m.group(1) if m else None
    if not nn:
        return []
    work = os.path.dirname(os.path.dirname(os.path.abspath(clip)))  # <WORK>/clips/NN.mp4 -> WORK
    cand = os.path.join(work, "broll", f"{nn}.brolls.json")
    if os.path.exists(cand):
        print(f"[premium] using b-roll manifest {cand}", flush=True)
        return json.load(open(cand, encoding="utf-8"))
    return []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("clip"); ap.add_argument("out")
    ap.add_argument("--config", default="")
    ap.add_argument("--captions", default="")
    ap.add_argument("--hook", default="")
    ap.add_argument("--watermark", default="")
    ap.add_argument("--brolls", default="")
    ap.add_argument("--music", default=DEFAULT_MUSIC)
    ap.add_argument("--music-vol", default="0.15")
    ap.add_argument("--crop-x", default="")
    ap.add_argument("--premium", action="store_true")
    ap.add_argument("--project", default="")
    a = ap.parse_args()

    clip = os.path.abspath(a.clip); out = os.path.abspath(a.out)
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    dur = ffprobe_dur(clip)
    project = os.path.abspath(a.project) if a.project else os.path.dirname(clip)

    if a.config:
        cfg = json.load(open(a.config, encoding="utf-8"))
        cfg.setdefault("duration", dur)
    else:
        caps = json.load(open(a.captions, encoding="utf-8")) if a.captions else []
        brolls = discover_brolls(clip, a.brolls)
        cfg = {
            "id": os.path.splitext(os.path.basename(out))[0],
            "duration": dur,
            "hook": a.hook,
            "watermark": a.watermark,
            "premium": True if a.premium else False,
            "captions": [{"start": c["start"], "end": c["end"],
                          "html": c.get("html", c.get("text", ""))} for c in caps],
            "brolls": brolls, "cards": [],
        }

    tmp = tempfile.mkdtemp(prefix="prh_premium_")
    cfg_path = os.path.join(tmp, "config.json")
    json.dump(cfg, open(cfg_path, "w", encoding="utf-8"), ensure_ascii=False)
    index = os.path.join(tmp, "index.html")

    subprocess.run([sys.executable, BUILD, cfg_path, index, ASSETS, project], check=True)
    rtl_patch(index)

    music = a.music if (a.music and os.path.exists(a.music)) else ""
    argv = ["node", OVERLAY, index, clip, out, f"{dur:.3f}", music, a.crop_x, "", a.music_vol]

    queue()
    nb = len(cfg.get("brolls", []))
    print(f"[premium] rendering {os.path.basename(clip)} -> {out}  "
          f"(dur={dur:.1f}, brolls={nb})", flush=True)
    subprocess.run(argv, check=True)
    print(f"[premium] DONE -> {out}", flush=True)


if __name__ == "__main__":
    main()
