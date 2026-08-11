"""Thumbnail candidates — extract high-quality frames with ffmpeg (docs §6.4).

Frames are taken at 'highlight' markers first (the moments the editor flagged),
then filled with evenly-spaced points, so the candidates are actually meaningful.
Pure of network; returns the written file paths.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from .models import Marker


def thumbnail_times_ms(markers: list[Marker], duration_ms: int, count: int) -> list[int]:
    centers = [m.tc_ms for m in markers if m.category == "highlight"]
    if len(centers) < count and duration_ms > 0:
        step = duration_ms / (count + 1)
        centers += [int(step * (i + 1)) for i in range(count)]
    # unique, in order, clamped to the episode, capped at `count`
    seen: list[int] = []
    for c in sorted(set(centers)):
        c = max(0, min(c, max(0, duration_ms - 1)) if duration_ms > 0 else c)
        if c not in seen:
            seen.append(c)
        if len(seen) >= count:
            break
    return seen


def extract_thumbnails(
    capture: str, markers: list[Marker], duration_ms: int, out_dir: Path, count: int = 4
) -> list[str]:
    """Write up to `count` candidate thumbnails (1280px wide JPEGs). []
    if ffmpeg is unavailable."""
    if shutil.which("ffmpeg") is None:
        return []
    out_dir.mkdir(parents=True, exist_ok=True)
    files: list[str] = []
    for i, ms in enumerate(thumbnail_times_ms(markers, duration_ms, count), start=1):
        out = out_dir / f"thumb{i:02d}.jpg"
        try:
            res = subprocess.run(
                ["ffmpeg", "-y", "-ss", f"{ms / 1000:.3f}", "-i", capture,
                 "-frames:v", "1", "-q:v", "2", "-vf", "scale=1280:-2", str(out)],
                capture_output=True,
            )
            if res.returncode == 0 and out.exists():
                files.append(str(out))
        except Exception:  # noqa: BLE001
            continue
    return files
