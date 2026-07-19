"""Pipeline orchestrator + CLI (docs §6.4).

    python -m ai_workers.worker <session_dir> [--dry-run] [--highlights N]

Reads a recording session folder (markers.json + media), runs
transcribe -> analyze -> plan -> render, and writes deliverables into
<session_dir>/edited/. Degrades gracefully: without whisper it skips
transcription; without ffmpeg it writes the EDL only; without an API key it uses
the deterministic marker-based plan.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
from dataclasses import asdict
from pathlib import Path

from .analyze import silences
from .models import DeliverableTemplate, Edl, Marker
from .plan import plan_edl
from .render import (
    clip_args,
    ffmpeg_available,
    run_ffmpeg,
    trim_concat_args,
    vertical_reframe_args,
)
from .transcribe import transcribe, transcript_text

VIDEO_EXTS = {".mp4", ".mkv", ".mov", ".flv"}


def load_markers(session_dir: Path) -> list[Marker]:
    path = session_dir / "markers.json"
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    return [Marker.from_dict(d) for d in data]


def find_media(session_dir: Path) -> Path | None:
    candidates = [p for p in session_dir.iterdir() if p.suffix.lower() in VIDEO_EXTS]
    if not candidates:
        return None
    # prefer a "mix" file, else the largest.
    mix = [p for p in candidates if "mix" in p.stem.lower()]
    pool = mix or candidates
    return max(pool, key=lambda p: p.stat().st_size)


def probe_duration_ms(media: Path) -> int | None:
    if shutil.which("ffprobe") is None:
        return None
    try:
        out = subprocess.run(
            [
                "ffprobe", "-v", "error", "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1", str(media),
            ],
            check=True, capture_output=True, text=True,
        )
        return int(float(out.stdout.strip()) * 1000)
    except Exception:
        return None


def estimate_total_ms(media: Path | None, markers: list[Marker]) -> int:
    if media is not None:
        probed = probe_duration_ms(media)
        if probed:
            return probed
    if markers:
        return max(m.tc_ms for m in markers) + 60_000
    return 0


def edl_to_dict(edl: Edl) -> dict:
    return {
        "source": edl.source,
        "full_edit": [asdict(s) for s in edl.full_edit],
        "highlights": [asdict(s) for s in edl.highlights],
        "chapters": [asdict(c) for c in edl.chapters],
    }


def process_session(session_dir: Path, template: DeliverableTemplate, dry_run: bool) -> dict:
    out_dir = session_dir / "edited"
    out_dir.mkdir(exist_ok=True)

    markers = load_markers(session_dir)
    media = find_media(session_dir)
    total_ms = estimate_total_ms(media, markers)

    transcript = transcribe(str(media)) if (media and template.transcript) else []
    if transcript:
        (out_dir / "transcript.txt").write_text(transcript_text(transcript), encoding="utf-8")

    source = str(media) if media else ""
    edl = plan_edl(source, markers, transcript, total_ms, template)

    (out_dir / "edl.json").write_text(
        json.dumps(edl_to_dict(edl), ensure_ascii=False, indent=2), encoding="utf-8"
    )
    if edl.chapters:
        (out_dir / "chapters.txt").write_text(
            "\n".join(f"{c.start_ms} {c.title}" for c in edl.chapters), encoding="utf-8"
        )

    rendered: list[str] = []
    dead_air = len(silences(transcript, total_ms)) if transcript else 0

    if not dry_run and media and ffmpeg_available():
        rendered = _render(edl, media, out_dir, template)

    summary = {
        "session_dir": str(session_dir),
        "media": source,
        "total_ms": total_ms,
        "markers": len(markers),
        "transcript_segments": len(transcript),
        "dead_air_windows": dead_air,
        "full_edit_segments": len(edl.full_edit),
        "highlights": len(edl.highlights),
        "chapters": len(edl.chapters),
        "rendered": rendered,
        "ffmpeg": ffmpeg_available(),
        "dry_run": dry_run,
    }
    return summary


def _render(edl: Edl, media: Path, out_dir: Path, template: DeliverableTemplate) -> list[str]:
    rendered: list[str] = []
    if edl.full_edit:
        target = out_dir / "full_edit.mp4"
        run_ffmpeg(trim_concat_args(str(media), edl.full_edit, str(target)))
        rendered.append(target.name)
    for i, seg in enumerate(edl.highlights, start=1):
        clip = out_dir / f"highlight_{i}.mp4"
        run_ffmpeg(clip_args(str(media), seg, str(clip)))
        rendered.append(clip.name)
        if template.shorts_vertical:
            short = out_dir / f"short_{i}.mp4"
            run_ffmpeg(vertical_reframe_args(str(clip), str(short)))
            rendered.append(short.name)
    return rendered


def main() -> None:
    parser = argparse.ArgumentParser(description="StudioMaster AI editing worker")
    parser.add_argument("session_dir", type=Path)
    parser.add_argument("--dry-run", action="store_true", help="plan only, no ffmpeg render")
    parser.add_argument("--highlights", type=int, default=None)
    args = parser.parse_args()

    template = DeliverableTemplate()
    if args.highlights is not None:
        template = DeliverableTemplate(
            full_edit=template.full_edit,
            highlights=args.highlights,
            shorts_vertical=template.shorts_vertical,
            chapters=template.chapters,
            transcript=template.transcript,
        )

    summary = process_session(args.session_dir, template, args.dry_run)
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
