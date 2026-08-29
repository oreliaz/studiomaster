"""Re-render one target after a MANUAL edit in the timeline editor.

    python -m ai_workers.reedit <session_dir> --mode basic
    python -m ai_workers.reedit <session_dir> --mode reel --reel 01

Unlike the full pilot, this does NOT re-plan: the editor has already written the
edited artifacts (edit_plan.json kept ranges, config.json, audio_channels.json
for basic; reel_specs.txt for a reel). We just invalidate the cached render
products and re-run the render, so millisecond cut/gain/effect tweaks take
effect. Progress streams as @@SM@@ lines the desktop app renders as a bar.
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import shutil
from pathlib import Path

from .pilot import BASIC_SKILL, REELS_SKILL, _run, emit

# Cached render products for the basic edit — deleted so an edit re-renders.
BASIC_CACHE = [
    "aud_raw.wav", "aud_chain.wav", "aud_cut.wav", "aud_final.m4a", "_measure.json",
    "_aconcat.txt", "body.mp4", "body_v.mp4", "bodylead.mp4", "bodymain.mp4",
    "bodyrest.mp4", "final.mp4", "_vconcat.txt",
]
BASIC_CACHE_DIRS = ["_achunks", "_vchunks"]


def _clear(work: Path) -> None:
    for name in BASIC_CACHE:
        (work / name).unlink(missing_ok=True)
    for d in BASIC_CACHE_DIRS:
        shutil.rmtree(work / d, ignore_errors=True)


def reedit_basic(session_dir: Path) -> dict:
    work = session_dir / "work"
    if not (work / "edit_plan.json").exists():
        return {"ok": False, "error": "no edit_plan.json — run a full edit first"}
    emit("reedit-clear", 0.05, "מנקה רינדור קודם")
    _clear(work)
    emit("reedit-render", 0.15, "מרנדר מחדש את הפרק לפי העריכה הידנית")
    step = _run(["python", str(BASIC_SKILL / "scripts" / "render_final.py"), str(work)])
    final = work / "final.mp4"
    ok = step.get("ok") and final.exists()
    emit("reedit-done", 1.0, "הפרק עודכן" if ok else "הרינדור נכשל")
    return {"ok": bool(ok), "output": str(final) if final.exists() else None, "step": step}


def _spec_for(session_dir: Path, reel_id: str) -> str | None:
    specs = session_dir / "reel_specs.txt"
    if not specs.exists():
        return None
    for line in specs.read_text("utf-8").splitlines():
        line = line.strip()
        if line and line.split(":", 1)[0] == reel_id:
            return line
    return None


def reedit_reel(session_dir: Path, reel_id: str) -> dict:
    """Re-cut + re-caption + re-render ONE reel from its (edited) spec."""
    spec = _spec_for(session_dir, reel_id)
    if not spec:
        return {"ok": False, "error": f"no spec for reel {reel_id} in reel_specs.txt"}
    capture = _capture_path(session_dir)
    if not capture or not Path(capture).exists():
        return {"ok": False, "error": "capture file not found"}
    style = _reel_style(session_dir)
    premium = style == "premium"

    clips_dir = session_dir / "clips"
    words_dir = session_dir / "words"
    captions_dir = session_dir / "captions"
    out_dir = session_dir / "out_final"
    out_dir.mkdir(exist_ok=True)
    whisper_env = {"CT2_FORCE_CPU_ISA": "GENERIC"}

    # Remove the previous cut/words/caption/output for just this clip.
    for p in clips_dir.glob(f"{reel_id}_*.mp4"):
        p.unlink(missing_ok=True)
    (words_dir / f"{reel_id}_words.json").unlink(missing_ok=True)
    (captions_dir / f"{reel_id}.json").unlink(missing_ok=True)
    (out_dir / f"{reel_id}.mp4").unlink(missing_ok=True)

    steps = []
    emit("reel-cut", 0.15, f"חותך מחדש רילס {reel_id}")
    steps.append(_run(["python", str(REELS_SKILL / "scripts" / "cut_clips.py"),
                       str(capture), str(clips_dir), spec]))
    clip = next(iter(sorted(clips_dir.glob(f"{reel_id}_*.mp4"))), None)
    if clip is None:
        return {"ok": False, "error": "cut failed", "steps": steps}

    emit("reel-words", 0.4, "מתמלל מילים לכתוביות")
    steps.append(_run(["python", str(REELS_SKILL / "scripts" / "transcribe_words.py"),
                       str(words_dir), str(clip)], env=whisper_env))
    emit("reel-captions", 0.6, "בונה כתוביות")
    steps.append(_run(["python", str(REELS_SKILL / "scripts" / "build_captions.py"), "build",
                       str(session_dir), str(REELS_SKILL / "fixes" / "fixes_he.json")]))

    captions = captions_dir / f"{reel_id}.json"
    out = out_dir / f"{reel_id}.mp4"
    hook = _reel_hook(session_dir, reel_id)
    emit("reel-render", 0.8, f"מרנדר רילס {reel_id} ({'כריסלייט' if premium else 'פשוט'})")
    if captions.exists():
        if premium:
            r = _run(["python", str(REELS_SKILL / "scripts" / "render_premium.py"), str(clip),
                      str(out), "--captions", str(captions), "--premium"]
                     + (["--hook", hook] if hook else []))
            if not r.get("ok"):
                r = _run(["python", str(REELS_SKILL / "scripts" / "render_simple.py"), str(clip),
                          str(captions), str(out)] + (["--hook", hook] if hook else []))
        else:
            r = _run(["python", str(REELS_SKILL / "scripts" / "render_simple.py"), str(clip),
                      str(captions), str(out)] + (["--hook", hook] if hook else []))
        steps.append(r)
    else:
        steps.append({"ok": False, "error": "no captions built"})

    ok = out.exists()
    emit("reel-done", 1.0, "הרילס עודכן" if ok else "הרינדור נכשל")
    return {"ok": bool(ok), "output": str(out) if ok else None, "steps": steps}


def _capture_path(session_dir: Path) -> str:
    job = session_dir / "job.json"
    if job.exists():
        try:
            return json.loads(job.read_text("utf-8")).get("capturePath", "")
        except Exception:  # noqa: BLE001
            return ""
    return ""


def _reel_style(session_dir: Path) -> str:
    job = session_dir / "job.json"
    if job.exists():
        try:
            return json.loads(job.read_text("utf-8")).get("deliverables", {}).get("reelStyle", "simple")
        except Exception:  # noqa: BLE001
            return "simple"
    return "simple"


def _reel_hook(session_dir: Path, reel_id: str) -> str:
    hooks = session_dir / "reel_hooks.json"
    if hooks.exists():
        try:
            return str(json.loads(hooks.read_text("utf-8")).get(reel_id, ""))
        except Exception:  # noqa: BLE001
            return ""
    return ""


def main() -> None:
    ap = argparse.ArgumentParser(description="Re-render one edited target")
    ap.add_argument("session_dir", type=Path)
    ap.add_argument("--mode", choices=["basic", "reel"], default="basic")
    ap.add_argument("--reel", default=None, help="reel id (NN) when --mode reel")
    args = ap.parse_args()
    emit("start", 0.02, "מתחיל עריכה מחדש")
    if args.mode == "reel":
        if not args.reel:
            print(json.dumps({"ok": False, "error": "--reel <NN> required"}))
            return
        result = reedit_reel(args.session_dir, args.reel)
    else:
        result = reedit_basic(args.session_dir)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
