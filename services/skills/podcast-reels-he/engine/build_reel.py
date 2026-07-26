"""
Build a transparent OVERLAY index.html for one reel from a config JSON.
The overlay (persistent hook + captions + floating cards + full-screen b-roll)
is rendered frame-by-frame by render_overlay.js with a transparent background,
then composited onto the full-frame presenter video by ffmpeg.

This MERGES the two converged renderers:
  * SHAHROZ  -> captions (2-3 word, amber number highlight), stat/headline cards,
               full-screen b-roll with tag + headline + ken-burns, topbar, watermark,
               persistent bottom legibility gradient.
  * WARREN   -> a HIGH, FACE-SAFE HOOK that stays on screen the WHOLE clip near the
               top (top ~140px), compact, never covering the presenter's face.

Usage:
  python build_reel.py <config.json> <out_index.html> <assets_dir> <project_dir>

Config schema:
{
  "id": "07",
  "duration": 42.7,
  "hook": "How I saved a client 800K AED",   # persistent top hook (face-safe). "" to hide.
  "topbar": "SHAHROZ TAHIR",                  # null/"" to hide
  "watermark": "SHAHROZ TAHIR",               # null/"" to hide
  "premium": false,                           # premium tightens caption band / hook look
  "captions": [ {"start":0.0,"end":1.2,"html":"My <span class='hl'>client</span> had"} ],
  "brolls":   [ {"start":6.0,"dur":4.0,"img":"broll/skyline.png","transition":"swipe"|"fade",
                 "tag":"DLD CANCELLATION","headline":""} ],
  "cards":    [ {"start":3.0,"dur":4.5,"type":"stat","eyebrow":"OUTSTANDING",
                 "number":"800K","unit":"AED","accent":"danger"},
                {"start":18.0,"dur":4.0,"type":"headline","eyebrow":"SOLD IN",
                 "text":"3 DAYS","accent":"good"} ]
}
accent in {amber, cool, danger, good}. transition default "swipe".
b-roll `img` is resolved relative to <project_dir>.
"""
import json, sys, html as htmlmod, subprocess
from pathlib import Path

cfg = json.load(open(sys.argv[1], encoding="utf-8"))
OUT = sys.argv[2]
ASSETS = Path(sys.argv[3]).resolve()
PROJECT = Path(sys.argv[4]).resolve() if len(sys.argv) > 4 else Path(".").resolve()


def _probe_dur(rel):
    """ffprobe the presenter clip's real duration (robustness: if a config omits
    `duration`, don't KeyError — measure it)."""
    p = Path(rel)
    if not p.is_absolute():
        p = PROJECT / rel
    try:
        r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                            "-of", "default=nokey=1:noprint_wrappers=1", str(p)],
                           capture_output=True, text=True, timeout=60)
        return round(float(r.stdout.strip()), 3)
    except Exception:
        return 0.0


DUR = float(cfg["duration"]) if cfg.get("duration") else _probe_dur(cfg.get("presenter", ""))
CAPS = cfg.get("captions", [])
# Auto-clamp: drop any card/b-roll that would run past the clip end (re-probed durations
# are often a touch shorter than planned). Stops an overlay rendering past the last frame
# — previously hand-filtered per project (zeeshan author_configs.py).
BROLLS = [b for b in cfg.get("brolls", []) if float(b.get("start", 0)) + float(b.get("dur", 0)) <= DUR - 0.3]
CARDS = [c for c in cfg.get("cards", []) if float(c.get("start", 0)) + float(c.get("dur", 0)) <= DUR - 0.3]
HOOK = cfg.get("hook", "") or ""
TOPBAR = cfg.get("topbar", "") or ""
WM = cfg.get("watermark", "") or ""
PREMIUM = bool(cfg.get("premium", False))
# RTL/Hebrew support (movetodubai was Hebrew run through the LTR renderer -> broken
# number/punctuation bidi). Set "rtl":true or "lang":"he" in the config.
RTL = bool(cfg.get("rtl")) or str(cfg.get("lang", "")).lower().startswith("he")
# The topbar chip and a b-roll tag chip share the same zone (HOOK_TOP+130) and COLLIDE.
# If any b-roll carries a tag, suppress the topbar and let the watermark carry the brand
# (zeeshan set topbar="" by hand for exactly this).
if TOPBAR and any(b.get("tag") for b in BROLLS):
    TOPBAR = ""

# layout knobs
CAP_TOP = 1200 if PREMIUM else 1500
HOOK_TOP = 110 if PREMIUM else 100   # high, above the head
HOOK_SIZE = 58 if PREMIUM else 56    # one line always (nowrap) -> keep hooks short


def asset_url(name):
    return "file:///" + str((ASSETS / name)).replace("\\", "/")


def broll_url(rel):
    p = Path(rel)
    if not p.is_absolute():
        p = PROJECT / rel
    return "file:///" + str(p.resolve()).replace("\\", "/")


def cap_block(c, i):
    dur = max(0.05, round(c["end"] - c["start"] - 0.005, 3))
    return (f'<div class="clip cap" id="cap{i}" data-start="{c["start"]}" '
            f'data-duration="{dur}">{c["html"]}</div>')


def broll_block(b, i):
    tag = b.get("tag", "")
    head = b.get("headline", "")
    tag_html = f'<div class="broll-tag">{htmlmod.escape(tag)}</div>' if tag else ""
    head_html = f'<div class="broll-headline">{htmlmod.escape(head)}</div>' if head else ""
    return (f'<div class="clip broll" id="broll{i}" data-start="{b["start"]}" data-duration="{b["dur"]}">'
            f'<img src="{broll_url(b["img"])}" class="broll-img" alt=""/>'
            f'<div class="broll-grad"></div>{tag_html}{head_html}</div>')


def card_block(c, i):
    acc = c.get("accent", "amber")
    if c.get("type") == "stat":
        unit = c.get("unit", "")
        unit_html = f'<div class="stat-unit">{htmlmod.escape(unit)}</div>' if unit else ""
        inner = (f'<div class="stat-eyebrow acc-{acc}">{htmlmod.escape(c.get("eyebrow",""))}</div>'
                 f'<div class="stat-row"><div class="stat-number acc-{acc}">{htmlmod.escape(c.get("number",""))}</div>{unit_html}</div>')
        cls = "card stat-card"
    else:  # headline
        eb = c.get("eyebrow", "")
        eb_html = f'<div class="hl-eyebrow acc-{acc}">{htmlmod.escape(eb)}</div>' if eb else ""
        inner = f'{eb_html}<div class="hl-text acc-{acc}">{htmlmod.escape(c.get("text",""))}</div>'
        cls = "card hl-card"
    return (f'<div class="clip {cls}" id="card{i}" data-start="{c["start"]}" '
            f'data-duration="{c["dur"]}"><div class="card-inner acc-border-{acc}">{inner}</div></div>')


# ---- GSAP timeline ----
g = ["const tl = gsap.timeline({ paused: true });"]

# Hook: appears once and STAYS the whole clip (data-duration = DUR keeps it visible).
if HOOK:
    g.append('tl.from("#hook", {opacity:0, y:-24, duration:0.5, ease:"power3.out"}, 0.15);')

for i, c in enumerate(CAPS):
    s, e = c["start"], c["end"]
    g.append(f'tl.set("#cap{i}", {{opacity:0, y:20}}, 0);')
    g.append(f'tl.to("#cap{i}", {{opacity:1, y:0, duration:0.16, ease:"power3.out"}}, {s});')
    g.append(f'tl.to("#cap{i}", {{opacity:0, duration:0.12, ease:"power2.in"}}, {round(e-0.12,3)});')
    g.append(f'tl.set("#cap{i}", {{opacity:0}}, {round(e,3)});')

for i, b in enumerate(BROLLS):
    s, d = b["start"], b["dur"]
    trans = b.get("transition", "swipe")
    g.append(f'tl.set("#broll{i}", {{opacity:0}}, 0);')
    if trans == "swipe":
        g.append(f'tl.fromTo("#broll{i}", {{xPercent:100, opacity:1}}, {{xPercent:0, duration:0.45, ease:"power3.out", immediateRender:false}}, {s});')
        g.append(f'tl.to("#broll{i}", {{xPercent:-100, duration:0.4, ease:"power3.in"}}, {round(s+d-0.4,3)});')
        g.append(f'tl.fromTo("#broll{i} .broll-img", {{scale:1.12}}, {{scale:1.0, duration:{round(d,3)}, ease:"none"}}, {s});')
    else:  # fade
        g.append(f'tl.fromTo("#broll{i}", {{opacity:0}}, {{opacity:1, duration:0.35, ease:"power2.out", immediateRender:false}}, {s});')
        g.append(f'tl.to("#broll{i}", {{opacity:0, duration:0.4, ease:"power2.in"}}, {round(s+d-0.4,3)});')
        g.append(f'tl.fromTo("#broll{i} .broll-img", {{scale:1.0}}, {{scale:1.1, duration:{round(d,3)}, ease:"none"}}, {s});')
    g.append(f'tl.set("#broll{i}", {{opacity:0}}, {round(s+d,3)});')
    if b.get("tag"):
        g.append(f'tl.from("#broll{i} .broll-tag", {{y:-18, opacity:0, duration:0.4, ease:"expo.out"}}, {round(s+0.2,3)});')
    if b.get("headline"):
        g.append(f'tl.from("#broll{i} .broll-headline", {{y:26, opacity:0, scale:0.95, duration:0.5, ease:"back.out(1.6)"}}, {round(s+0.3,3)});')

for i, c in enumerate(CARDS):
    s, d = c["start"], c["dur"]
    g.append(f'tl.set("#card{i}", {{opacity:0}}, 0);')
    g.append(f'tl.fromTo("#card{i}", {{opacity:0, y:24, scale:0.9}}, {{opacity:1, y:0, scale:1, duration:0.45, ease:"back.out(1.7)"}}, {s});')
    if c.get("type") == "stat":
        g.append(f'tl.fromTo("#card{i} .stat-number", {{scale:0.5, opacity:0}}, {{scale:1, opacity:1, duration:0.5, ease:"back.out(1.9)"}}, {round(s+0.15,3)});')
        g.append(f'tl.to("#card{i} .stat-number", {{scale:1.06, duration:0.5, ease:"sine.inOut", repeat:3, yoyo:true}}, {round(s+0.7,3)});')
    g.append(f'tl.to("#card{i}", {{opacity:0, y:-14, duration:0.3, ease:"power2.in"}}, {round(s+d-0.3,3)});')

if TOPBAR:
    g.append('tl.from("#topbar", {opacity:0, y:-16, duration:0.5, ease:"power3.out"}, 0.2);')

g.append('window.__timelines = window.__timelines || {};')
g.append('window.__timelines["reel"] = tl;')
gsap_block = "\n      ".join(g)

caps_html = "\n".join(cap_block(c, i) for i, c in enumerate(CAPS))
brolls_html = "\n".join(broll_block(b, i) for i, b in enumerate(BROLLS))
cards_html = "\n".join(card_block(c, i) for i, c in enumerate(CARDS))
hook_html = (f'<div class="clip hook" id="hook" data-start="0" data-duration="{DUR}">'
             f'<span class="hook-txt">{htmlmod.escape(HOOK)}</span></div>') if HOOK else ""
topbar_html = (f'<div class="topbar" id="topbar"><span class="brand-dot"></span>'
               f'<span class="brand-name">{htmlmod.escape(TOPBAR)}</span></div>') if TOPBAR else ""
wm_html = f'<div class="watermark">{htmlmod.escape(WM)}</div>' if WM else ""

LANG = "he" if RTL else "en"
DIR = "rtl" if RTL else "ltr"
# When RTL, isolate the text so leading hyphens/numbers (e.g. "מ -15,000") don't bidi-flip.
RTL_CSS = (".hook-txt,.cap,.hl-text,.stat-unit,.broll-headline{direction:rtl;unicode-bidi:isolate;}"
           if RTL else "")

HTML = f"""<!DOCTYPE html>
<html lang="{LANG}" dir="{DIR}">
<head><meta charset="UTF-8">
<link rel="stylesheet" href="{asset_url('fonts.css')}">
<style>
  :root {{
    --amber:#ffb347; --cool:#5b8cff; --danger:#ef4444; --good:#22c55e;
    --text:#f5f7fb; --navy:#0c1326;
  }}
  * {{ box-sizing:border-box; margin:0; padding:0; }}
  html, body {{ width:1080px; height:1920px; background:transparent !important; overflow:hidden;
    font-family:'Heebo','Rubik',sans-serif; color:var(--text); }}
  #reel {{ position:relative; width:1080px; height:1920px; overflow:hidden; background:transparent; }}

  .acc-amber {{ color:var(--amber); }} .acc-cool {{ color:var(--cool); }}
  .acc-danger {{ color:var(--danger); }} .acc-good {{ color:var(--good); }}

  /* legibility gradients: subtle top (for hook) + strong bottom (for captions) */
  .leg {{ position:absolute; left:0; right:0; pointer-events:none; z-index:2; }}
  .leg.top {{ top:0; height:360px; background:linear-gradient(to bottom, rgba(7,11,24,0.62), rgba(7,11,24,0)); }}
  .leg.bot {{ bottom:0; height:720px;
    background:linear-gradient(to top, rgba(7,11,24,0.92), rgba(7,11,24,0.45) 38%, rgba(7,11,24,0)); }}

  /* HIGH FACE-SAFE HOOK — persists the whole clip, sits above the face, never over it */
  .hook {{ position:absolute; top:{HOOK_TOP}px; left:0; right:0; text-align:center; z-index:24; }}
  .hook-txt {{ display:inline-block; font-family:'Rubik',sans-serif; font-weight:900;
    font-size:{HOOK_SIZE}px; line-height:1.05; letter-spacing:-0.02em; color:#fff;
    max-width:920px; padding:6px 18px; text-shadow:0 4px 24px rgba(0,0,0,0.95);
    border-bottom:5px solid var(--amber); white-space:normal; text-wrap:balance;
    overflow-wrap:break-word; }}

  /* TOPBAR (optional small brand chip, sits just under the hook) */
  .topbar {{ position:absolute; top:{HOOK_TOP + 130}px; left:50%; transform:translateX(-50%); z-index:20;
    display:flex; align-items:center; gap:14px; padding:10px 24px;
    background:rgba(12,19,38,0.72);
    border:1px solid rgba(91,140,255,0.32); border-radius:999px;
    font-family:'JetBrains Mono',monospace; font-weight:700; font-size:20px; letter-spacing:0.16em; }}
  .brand-dot {{ width:13px; height:13px; border-radius:50%; background:var(--amber); box-shadow:0 0 16px rgba(255,179,71,0.7); }}
  .brand-name {{ color:#cfd8ff; }}

  /* B-ROLL full-screen */
  .broll {{ position:absolute; inset:0; width:1080px; height:1920px; z-index:9; overflow:hidden; }}
  .broll-img {{ position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }}
  .broll-grad {{ position:absolute; inset:0; background:linear-gradient(180deg,
      rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.12) 22%, rgba(0,0,0,0.05) 55%, rgba(7,11,24,0.85) 100%); }}
  /* b-roll tag sits BELOW the persistent hook so they never collide */
  .broll-tag {{ position:absolute; top:{HOOK_TOP + 130}px; left:50%; transform:translateX(-50%);
    padding:12px 30px; background:rgba(255,179,71,0.96); color:#221705;
    font-family:'JetBrains Mono',monospace; font-weight:800; font-size:30px; letter-spacing:0.18em;
    border-radius:10px; white-space:nowrap; box-shadow:0 8px 28px rgba(255,179,71,0.5); }}
  .broll-headline {{ position:absolute; bottom:560px; left:50%; transform:translateX(-50%);
    width:920px; text-align:center; font-family:'Rubik',sans-serif; font-weight:900; font-size:74px;
    line-height:1.04; letter-spacing:-0.02em; text-shadow:0 4px 30px rgba(0,0,0,0.95); }}

  /* FLOATING CARDS (raised so they never collide with captions; compact) */
  .card {{ position:absolute; top:1040px; left:50%; transform:translateX(-50%); z-index:14; text-align:center; }}
  .card-inner {{ display:inline-block; background:rgba(12,19,38,0.92);
    border:2px solid rgba(255,179,71,0.5); border-radius:18px; padding:14px 26px;
    box-shadow:0 14px 50px rgba(0,0,0,0.5); }}
  .acc-border-amber {{ border-color:rgba(255,179,71,0.55); box-shadow:0 12px 50px rgba(255,179,71,0.22),0 16px 60px rgba(0,0,0,0.5); }}
  .acc-border-cool {{ border-color:rgba(91,140,255,0.55); box-shadow:0 12px 50px rgba(91,140,255,0.25),0 16px 60px rgba(0,0,0,0.5); }}
  .acc-border-danger {{ border-color:rgba(239,68,68,0.55); box-shadow:0 12px 50px rgba(239,68,68,0.22),0 16px 60px rgba(0,0,0,0.5); }}
  .acc-border-good {{ border-color:rgba(34,197,94,0.55); box-shadow:0 12px 50px rgba(34,197,94,0.22),0 16px 60px rgba(0,0,0,0.5); }}
  .stat-eyebrow, .hl-eyebrow {{ display:inline-block; padding:6px 16px; border-radius:8px; margin-bottom:12px;
    font-family:'JetBrains Mono',monospace; font-weight:800; font-size:18px; letter-spacing:0.16em; color:#0c1326; }}
  .stat-eyebrow.acc-amber, .hl-eyebrow.acc-amber {{ background:var(--amber); }}
  .stat-eyebrow.acc-cool, .hl-eyebrow.acc-cool {{ background:var(--cool); color:#fff; }}
  .stat-eyebrow.acc-danger, .hl-eyebrow.acc-danger {{ background:var(--danger); color:#fff; }}
  .stat-eyebrow.acc-good, .hl-eyebrow.acc-good {{ background:var(--good); }}
  .stat-row {{ display:flex; flex-direction:row; align-items:center; justify-content:center; gap:22px; }}
  .stat-number {{ font-family:'Rubik',sans-serif; font-weight:900; font-size:92px; line-height:0.9;
    text-shadow:0 6px 50px rgba(0,0,0,0.6); }}
  .stat-number.acc-amber {{ color:var(--amber); }} .stat-number.acc-cool {{ color:var(--cool); }}
  .stat-number.acc-danger {{ color:var(--danger); }} .stat-number.acc-good {{ color:var(--good); }}
  .stat-unit {{ font-family:'Heebo',sans-serif; font-weight:800; font-size:26px; color:var(--text); line-height:1.1; text-align:left; }}
  .hl-text {{ font-family:'Rubik',sans-serif; font-weight:900; font-size:60px; line-height:0.98;
    letter-spacing:-0.02em; text-shadow:0 4px 30px rgba(0,0,0,0.6); }}
  .hl-text.acc-amber {{ color:var(--amber); }} .hl-text.acc-cool {{ color:var(--cool); }}
  .hl-text.acc-danger {{ color:var(--danger); }} .hl-text.acc-good {{ color:var(--good); }}

  /* CAPTIONS — 2-3 words, centered, lower band */
  .cap {{ position:absolute; top:{CAP_TOP}px; left:50%; transform:translateX(-50%); max-width:940px;
    padding:14px 34px; background:rgba(12,19,38,0.84);
    border-bottom:5px solid var(--amber); border-radius:14px;
    font-family:'Heebo','Rubik',sans-serif; font-weight:800; font-size:62px; line-height:1.12;
    color:var(--text); text-align:center; text-shadow:0 2px 14px rgba(0,0,0,0.95);
    box-shadow:0 10px 36px rgba(0,0,0,0.55); white-space:nowrap; z-index:30; }}
  .cap .hl, .cap .amber {{ color:var(--amber); }} .cap .cool {{ color:var(--cool); }}
  .cap .danger {{ color:var(--danger); }} .cap .good {{ color:var(--good); }}

  .watermark {{ position:absolute; bottom:46px; left:50%; transform:translateX(-50%);
    font-family:'JetBrains Mono',monospace; font-weight:700; font-size:20px;
    color:rgba(255,255,255,0.5); letter-spacing:0.2em; z-index:25; }}
  {RTL_CSS}
</style></head>
<body>
  <div id="reel" data-composition-id="reel" data-start="0" data-duration="{DUR}" data-width="1080" data-height="1920">
    <div class="leg top"></div>
    <div class="leg bot"></div>
{brolls_html}
{cards_html}
    {topbar_html}
    {hook_html}
{caps_html}
    {wm_html}
  </div>
  <script src="{asset_url('gsap.min.js')}"></script>
  <script>
      {gsap_block}
  </script>
</body></html>
"""

open(OUT, "w", encoding="utf-8").write(HTML)
print(f"Wrote {OUT}  (hook={'yes' if HOOK else 'no'}, {len(CAPS)} caps, "
      f"{len(BROLLS)} brolls, {len(CARDS)} cards, premium={PREMIUM}, dur={DUR})")
