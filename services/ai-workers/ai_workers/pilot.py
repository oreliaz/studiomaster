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


def run_basic(work: Path, capture: Path, dry_run: bool) -> dict:
    steps: list[dict] = []
    inner = work / "work"
    inner.mkdir(exist_ok=True)
    audio = inner / "raw_audio_16k.wav"
    transcript = inner / "transcript.txt"
    env = {"CT2_FORCE_CPU_ISA": "GENERIC"}

    if dry_run:
        return {"skill": "basic-editing-he", "dry_run": True, "steps": [], "output": None}

    steps.append(
        _run(["ffmpeg", "-y", "-vn", "-i", str(capture), "-ac", "1", "-ar", "16000",
              "-c:a", "pcm_s16le", str(audio)])
    )
    steps.append(
        _run(["python", str(BASIC_SKILL / "scripts" / "transcribe_full.py"),
              str(audio), str(transcript)], env=env)
    )
    steps.append(_run(["python", str(BASIC_SKILL / "scripts" / "plan_edits.py"), str(inner)]))
    steps.append(_run(["python", str(BASIC_SKILL / "scripts" / "render_final.py"), str(inner)]))

    final = inner / "final.mp4"
    return {
        "skill": "basic-editing-he",
        "steps": steps,
        "output": str(final) if final.exists() else None,
    }


def run_reels(work: Path, capture: Path, job: dict, markers: list[Marker], dry_run: bool) -> dict:
    d = job.get("deliverables", {})
    count = int(d.get("reelsCount", 15))
    style = d.get("reelStyle", "simple")
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
    steps.append(
        _run(["python", str(REELS_SKILL / "scripts" / "transcribe_full.py"),
              str(capture), str(work / "transcript.txt")], env={"CT2_FORCE_CPU_ISA": "GENERIC"})
    )
    steps.append(
        _run(["python", str(REELS_SKILL / "scripts" / "cut_clips.py"), str(capture),
              str(clips_dir)] + [spec_to_arg(s) for s in specs])
    )
    steps.append(
        _run(["python", str(REELS_SKILL / "scripts" / "build_captions.py"), "build", str(work),
              str(REELS_SKILL / "fixes" / "fixes_he.json")])
    )
    outputs = sorted(str(p) for p in (work / "out_preview").glob("*.mp4")) if (work / "out_preview").exists() else []
    return {"skill": "podcast-reels-he", "style": style, "planned_clips": len(specs),
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
        return result

    if edit_type in ("basic", "both"):
        result["basic"] = run_basic(session_dir, capture, dry_run)
    if edit_type in ("reels", "both"):
        result["reels"] = run_reels(session_dir, capture, job, markers, dry_run)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="StudioMaster pilot editing orchestrator")
    parser.add_argument("session_dir", type=Path)
    parser.add_argument("--dry-run", action="store_true", help="prepare inputs + plan, no heavy render")
    args = parser.parse_args()
    print(json.dumps(process(args.session_dir, args.dry_run), ensure_ascii=False))


if __name__ == "__main__":
    main()
