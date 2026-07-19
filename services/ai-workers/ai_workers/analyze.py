"""Transcript analysis helpers (docs §6.4) — pure, unit-testable."""

from __future__ import annotations

from .models import Segment, TranscriptSegment


def silences(segments: list[TranscriptSegment], total_ms: int, min_gap_ms: int = 1_500) -> list[Segment]:
    """Gaps between consecutive transcript segments longer than `min_gap_ms`.

    These are candidate dead-air windows the editor may want to tighten.
    """
    if not segments:
        return []
    ordered = sorted(segments, key=lambda s: s.start_ms)
    gaps: list[Segment] = []
    for prev, nxt in zip(ordered, ordered[1:]):
        gap = nxt.start_ms - prev.end_ms
        if gap >= min_gap_ms:
            gaps.append(Segment(prev.end_ms, nxt.start_ms, "silence"))
    # trailing silence after the last spoken segment
    tail = total_ms - ordered[-1].end_ms
    if tail >= min_gap_ms:
        gaps.append(Segment(ordered[-1].end_ms, total_ms, "silence"))
    return gaps


def speaking_ratio(segments: list[TranscriptSegment], total_ms: int) -> float:
    """Fraction of the recording that contains speech (0..1)."""
    if total_ms <= 0:
        return 0.0
    spoken = sum(s.end_ms - s.start_ms for s in segments)
    return max(0.0, min(1.0, spoken / total_ms))
