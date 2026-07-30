"""Pilot orchestrator (docs §6.4) — drives the vendored editing skills.

    python -m ai_workers.pilot <session_dir> [--dry-run]

Reads `<session_dir>/job.json` (the questionnaire + capture path) and
`markers.json` (review markers), prepares the skill inputs (cuts.txt from the
'fix' markers, config.json from the questionnaire), then runs the selected
skills:

  - editType basic/both  → basic-editing-he: extract audio → transcribe →
    plan_edits (merges cuts.txt) → render_final → final.mp4
  - editType reels/both  → podcast-reels-he: transcribe → propose clips (from
    highlight markers) → cut → captions → render simple previews

Works in Hebrew and English (language flows into config). Every step is
independent and its status reported, so a missing dependency (ffmpeg / the
ivrit.ai Whisper model / node) degrades gracefully instead of crashing.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
from pathlib import Path

from .cuts import markers_to_cuts_txt
from .models import Marker
from .reels_plan import propose_specs, spec_to_arg

SKILLS_DIR = Path(__file__).resolve().parents[2] / "skills"
BASIC_SKILL = SKILLS_DIR / "basic-editing-he"
REELS_SKILL = SKILLS_DIR / "podcast-reels-he"


def emit(phase: str, frac: float, detail: str = "") -> None:
    """Stream a progress event the desktop app renders as a live bar.

    The `@@SM@@` sentinel lets the Node side tell progress lines apart from the
    final JSON summary printed on stdout.
    """
    payload = {"phase": phase, "frac": round(max(0.0, min(1.0, frac)), 3), "detail": detail}
    print("@@SM@@" + json.dumps(payload, ensure_ascii=False), flush=True)


def _run(cmd: list[str], cwd: Path | None = None, env: dict | None = None) -> dict:
    """Run a command, capturing status; never raises."""
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(cwd) if cwd else None,
            env={**os.environ, **(env or {})},
            capture_output=True,
            text=True,
        )
        return {
            "cmd": " ".join(cmd[:3]) + (" …" if len(cmd) > 3 else ""),
            "ok": proc.returncode == 0,
            "code": proc.returncode,
            "error": (proc.stderr or "").strip()[-400:] if proc.returncode else None,
        }
    except FileNotFoundError as exc:
        return {"cmd": cmd[0], "ok": False, "code": -1, "error": f"not found: {exc}"}


def _probe_duration_ms(media: Path) -> int:
    if shutil.which("ffprobe") is None:
        return 0
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(media)],
            check=True, capture_output=True, text=True,
        )
        return int(float(out.stdout.strip()) * 1000)
    except Exception:
        return 0


def _write_config(work: Path, job: dict) -> None:
    d = job.get("deliverables", {})
    config = {
        "source": job.get("capturePath", ""),
        "intro": d.get("intro") or None,
        "outro": d.get("outro") or None,
        "target_lufs": d.get("targetLufs", -16.0),
        "language": d.get("language", "he"),
        "auto_detect": True,
    }
    (work / "config.json").write_text(json.dumps(config, ensure_ascii=False, indent=2), "utf-8")


def run_basic(work: Path, capture: Path, dry_run: bool, base: float = 0.0, span: float = 1.0) -> dict:
    steps: list[dict] = []
    inner = work / "work"
    inner.mkdir(exist_ok=True)
    audio = inner / "raw_audio_16k.wav"
    transcript = inner / "transcript.txt"
    env = {"CT2_FORCE_CPU_ISA": "GENERIC"}

    if dry_run:
        return {"skill": "basic-editing-he", "dry_run": True, "steps": [], "output": None}

    emit("basic-audio", base + span * 0.05, "מחלץ שמע מהוידאו")
    steps.append(
        _run(["ffmpeg", "-y", "-vn", "-i", str(capture), "-ac", "1", "-ar", "16000",
              "-c:a", "pcm_s16le", str(audio)])
    )
    emit("basic-transcribe", base + span * 0.15, "מתמלל את הפרק (עשוי לקחת מספר דקות)")
    steps.append(
        _run(["python", str(BASIC_SKILL / "scripts" / "transcribe_full.py"),
              str(audio), str(transcript)], env=env)
    )
    emit("basic-plan", base + span * 0.6, "מתכנן חיתוכים לפי הסימונים")
    steps.append(_run(["python", str(BASIC_SKILL / "scripts" / "plan_edits.py"), str(inner)]))
    emit("basic-render", base + span * 0.75, "מרנדר את הפרק הערוך")
    steps.append(_run(["python", str(BASIC_SKILL / "scripts" / "render_final.py"), str(inner)]))

    final = inner / "final.mp4"
    emit("basic-done", base + span, "הפרק המלא מוכן")
    return {
        "skill": "basic-editing-he",
        "steps": steps,
        "output": str(final) if final.exists() else None,
    }


def _hook_for(markers: list[Marker], start_s: float, end_s: float) -> str:
    """Best hook line for a clip window: a highlight marker's note, else any note."""
    fallback = ""
    for m in markers:
        tc = m.tc_ms / 1000.0
        note = (m.note or "").strip()
        if start_s <= tc <= end_s and note:
            if m.category == "highlight":
                return note
            fallback = fallback or note
    return fallback


def _render_clip(clip: Path, captions: Path, out: Path, hook: str, premium: bool) -> dict:
    """Render one reel with captions + graphics. Premium falls back to simple."""
    if premium:
        args = ["python", str(REELS_SKILL / "scripts" / "render_premium.py"),
                str(clip), str(out), "--captions", str(captions), "--premium"]
        if hook:
            args += ["--hook", hook]
        result = _run(args)
        if result.get("ok"):
            result["style"] = "premium"
            return result
        # Premium needs puppeteer/Chrome; if it fails, still deliver captioned reels.
        fallback = _run(["python", str(REELS_SKILL / "scripts" / "render_simple.py"),
                         str(clip), str(captions), str(out)] + (["--hook", hook] if hook else []))
        fallback["style"] = "simple(fallback)"
        fallback["premium_error"] = result.get("error")
        return fallback
    result = _run(["python", str(REELS_SKILL / "scripts" / "render_simple.py"),
                   str(clip), str(captions), str(out)] + (["--hook", hook] if hook else []))
    result["style"] = "simple"
    return result


def run_reels(work: Path, capture: Path, job: dict, markers: list[Marker], dry_run: bool,
              base: float = 0.0, span: float = 1.0) -> dict:
    d = job.get("deliverables", {})
    count = int(d.get("reelsCount", 15))
    style = d.get("reelStyle", "simple")
    premium = style == "premium"
    duration = _probe_duration_ms(capture) or (max((m.tc_ms for m in markers), default=0) + 60_000)
    specs = propose_specs(markers, duration, count, int(d.get("reelMinSec", 40)),
                          int(d.get("reelMaxSec", 70)))
    (work / "reel_specs.txt").write_text(
        "\n".join(spec_to_arg(s) for s in specs) + ("\n" if specs else ""), "utf-8"
    )
    if dry_run:
        return {"skill": "podcast-reels-he", "dry_run": True, "style": style,
                "planned_clips": len(specs), "steps": [], "outputs": []}

    steps: list[dict] = []
    clips_dir = work / "clips"
    words_dir = work / "words"
    captions_dir = work / "captions"
    out_dir = work / "out_final"
    out_dir.mkdir(exist_ok=True)
    whisper_env = {"CT2_FORCE_CPU_ISA": "GENERIC"}

    # 1) full-episode transcript (reference) + 2) cut the selected clips.
    emit("reels-transcribe", base + span * 0.05, "מתמלל את הפרק")
    steps.append(
        _run(["python", str(REELS_SKILL / "scripts" / "transcribe_full.py"),
              str(capture), str(work / "transcript.txt")], env=whisper_env)
    )
    emit("reels-cut", base + span * 0.3, f"חותך {len(specs)} קליפים")
    steps.append(
        _run(["python", str(REELS_SKILL / "scripts" / "cut_clips.py"), str(capture),
              str(clips_dir)] + [spec_to_arg(s) for s in specs])
    )

    clip_files = sorted(clips_dir.glob("*.mp4")) if clips_dir.exists() else []

    # 3) word-level transcription of the SHORT clips (input for captions).
    emit("reels-words", base + span * 0.45, "מתמלל מילים לכתוביות")
    if clip_files:
        steps.append(
            _run(["python", str(REELS_SKILL / "scripts" / "transcribe_words.py"),
                  str(words_dir)] + [str(c) for c in clip_files], env=whisper_env)
        )
    # 4) group words into caption files (captions/<NN>.json).
    emit("reels-captions", base + span * 0.55, "בונה כתוביות")
    steps.append(
        _run(["python", str(REELS_SKILL / "scripts" / "build_captions.py"), "build", str(work),
              str(REELS_SKILL / "fixes" / "fixes_he.json")])
    )

    # 5) render each clip WITH captions + graphics, in the chosen style.
    style_label = "כריסלייט" if premium else "פשוט"
    renders: list[dict] = []
    for i, clip in enumerate(clip_files):
        nn = clip.name[:2]
        captions = captions_dir / f"{nn}.json"
        out = out_dir / f"{nn}.mp4"
        # Map this clip back to its spec window to pick a hook line from markers.
        spec = next((s for s in specs if f"{s[0]:02d}" == nn), None)
        hook = _hook_for(markers, spec[1], spec[2]) if spec else ""
        frac = base + span * (0.6 + 0.38 * ((i + 1) / max(1, len(clip_files))))
        emit("reels-render", frac, f"מרנדר רילס {i + 1} מתוך {len(clip_files)} ({style_label})")
        if captions.exists():
            renders.append(_render_clip(clip, captions, out, hook, premium))
        else:
            renders.append({"cmd": "render", "ok": False, "error": f"no captions for {nn}"})
    steps.extend(renders)

    outputs = sorted(str(p) for p in out_dir.glob("*.mp4"))
    emit("reels-done", base + span, f"{len(outputs)} רילסים מוכנים")
    return {"skill": "podcast-reels-he", "style": style, "premium": premium,
            "planned_clips": len(specs), "rendered": len(outputs),
            "steps": steps, "outputs": outputs}


def process(session_dir: Path, dry_run: bool) -> dict:
    job = json.loads((session_dir / "job.json").read_text("utf-8")) if (session_dir / "job.json").exists() else {}
    markers = [
        Marker.from_dict(m)
        for m in (json.loads((session_dir / "markers.json").read_text("utf-8"))
                  if (session_dir / "markers.json").exists() else [])
    ]
    deliverables = job.get("deliverables", {})
    edit_type = deliverables.get("editType", "basic")

    # Prepare skill inputs regardless of which skill runs.
    (session_dir / "cuts.txt").write_text(markers_to_cuts_txt(markers), "utf-8")
    _write_config(session_dir, job)

    capture = Path(job.get("capturePath", ""))
    capture_ok = capture.exists()

    result: dict = {
        "session_dir": str(session_dir),
        "edit_type": edit_type,
        "language": deliverables.get("language", "he"),
        "capture": str(capture),
        "capture_found": capture_ok,
        "markers": len(markers),
        "fix_markers": sum(1 for m in markers if m.category == "fix"),
        "highlight_markers": sum(1 for m in markers if m.category == "highlight"),
        "dry_run": dry_run,
        "basic": None,
        "reels": None,
    }
    if not capture_ok and not dry_run:
        result["error"] = "capture file not found — set capturePath in job.json"
        emit("error", 1.0, "קובץ ההקלטה לא נמצא")
        return result

    emit("start", 0.02, "מכין קלט לעריכה")
    both = edit_type == "both"
    if edit_type in ("basic", "both"):
        result["basic"] = run_basic(session_dir, capture, dry_run,
                                    base=0.02, span=(0.53 if both else 0.93))
    if edit_type in ("reels", "both"):
        result["reels"] = run_reels(session_dir, capture, job, markers, dry_run,
                                    base=(0.55 if both else 0.02), span=(0.43 if both else 0.93))
    emit("done", 1.0, "העריכה הושלמה")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="StudioMaster pilot editing orchestrator")
    parser.add_argument("session_dir", type=Path)
    parser.add_argument("--dry-run", action="store_true", help="prepare inputs + plan, no heavy render")
    args = parser.parse_args()
    print(json.dumps(process(args.session_dir, args.dry_run), ensure_ascii=False))


if __name__ == "__main__":
    main()
