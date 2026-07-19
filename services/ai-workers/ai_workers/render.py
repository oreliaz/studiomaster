"""ffmpeg command construction (docs §6.4).

The argument builders are pure functions (unit-tested); `run_ffmpeg` is the only
part that touches the system, so the render logic can be verified without ffmpeg
installed.
"""

from __future__ import annotations

import shutil
import subprocess

from .models import Segment


def _ms_to_seconds(ms: int) -> str:
    return f"{ms / 1000:.3f}"


def trim_concat_args(source: str, keep: list[Segment], output: str) -> list[str]:
    """Build ffmpeg args that trim `keep` segments from `source` and concat them.

    Uses a single filter_complex with per-segment trim + concat, so the output is
    one continuous video/audio stream.
    """
    if not keep:
        raise ValueError("no segments to keep")

    parts: list[str] = []
    for i, seg in enumerate(keep):
        start = _ms_to_seconds(seg.start_ms)
        end = _ms_to_seconds(seg.end_ms)
        parts.append(
            f"[0:v]trim=start={start}:end={end},setpts=PTS-STARTPTS[v{i}];"
            f"[0:a]atrim=start={start}:end={end},asetpts=PTS-STARTPTS[a{i}]"
        )
    concat_inputs = "".join(f"[v{i}][a{i}]" for i in range(len(keep)))
    filtergraph = (
        ";".join(parts)
        + f";{concat_inputs}concat=n={len(keep)}:v=1:a=1[outv][outa]"
    )
    return [
        "ffmpeg", "-y", "-i", source,
        "-filter_complex", filtergraph,
        "-map", "[outv]", "-map", "[outa]",
        output,
    ]


def clip_args(source: str, seg: Segment, output: str) -> list[str]:
    """Extract a single clip [start, end) — fast seek before input."""
    return [
        "ffmpeg", "-y",
        "-ss", _ms_to_seconds(seg.start_ms),
        "-to", _ms_to_seconds(seg.end_ms),
        "-i", source,
        "-c", "copy",
        output,
    ]


def vertical_reframe_args(source: str, output: str, width: int = 1080, height: int = 1920) -> list[str]:
    """Crop/scale to a 9:16 vertical frame for social shorts."""
    vf = (
        f"scale={width}:-2:force_original_aspect_ratio=increase,"
        f"crop={width}:{height}"
    )
    return ["ffmpeg", "-y", "-i", source, "-vf", vf, "-c:a", "copy", output]


def ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


def run_ffmpeg(args: list[str]) -> None:
    """Run an ffmpeg command; raises CalledProcessError on failure."""
    if not ffmpeg_available():
        raise RuntimeError("ffmpeg is not installed")
    subprocess.run(args, check=True, capture_output=True)
