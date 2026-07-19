"""StudioMaster AI editing agents (docs/ARCHITECTURE.md §6.4).

Pipeline: ingest -> transcribe -> analyze -> plan (EDL) -> render -> deliver.
The pure pieces (EDL math, ffmpeg command construction) are unit-tested; the
heavy pieces (whisper, ffmpeg, Claude) degrade gracefully when unavailable.
"""

__all__ = ["models", "edl", "render", "analyze"]
