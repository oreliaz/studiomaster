"""Pure Edit Decision List math (docs §6.4).

Turns review markers into concrete keep/clip segments and chapters. This is the
deterministic core the render stage consumes, and the fallback used when no LLM
is available. Everything here is side-effect free and unit-tested.
"""

from __future__ import annotations

from .models import Chapter, DeliverableTemplate, Edl, Marker, Segment

FIX_PAD_MS = 2_000  # trim this much around a "fix" marker
HIGHLIGHT_PRE_MS = 15_000
HIGHLIGHT_POST_MS = 30_000


def merge_windows(windows: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """Merge overlapping/adjacent (start, end) windows, sorted."""
    if not windows:
        return []
    ordered = sorted((min(a, b), max(a, b)) for a, b in windows)
    merged = [ordered[0]]
    for start, end in ordered[1:]:
        last_start, last_end = merged[-1]
        if start <= last_end:
            merged[-1] = (last_start, max(last_end, end))
        else:
            merged.append((start, end))
    return merged


def fix_windows(markers: list[Marker], total_ms: int, pad_ms: int = FIX_PAD_MS) -> list[tuple[int, int]]:
    """Windows to remove, derived from 'fix' markers (padded, clamped, merged)."""
    raw = [
        (max(0, m.tc_ms - pad_ms), min(total_ms, m.tc_ms + pad_ms))
        for m in markers
        if m.category == "fix"
    ]
    return merge_windows(raw)


def complement(total_ms: int, remove: list[tuple[int, int]]) -> list[Segment]:
    """Segments to KEEP: [0, total] minus the removed windows."""
    if total_ms <= 0:
        return []
    keep: list[Segment] = []
    cursor = 0
    for start, end in merge_windows(remove):
        start = max(0, min(start, total_ms))
        end = max(0, min(end, total_ms))
        if start > cursor:
            keep.append(Segment(cursor, start))
        cursor = max(cursor, end)
    if cursor < total_ms:
        keep.append(Segment(cursor, total_ms))
    return keep


def highlight_segments(
    markers: list[Marker],
    total_ms: int,
    pre_ms: int = HIGHLIGHT_PRE_MS,
    post_ms: int = HIGHLIGHT_POST_MS,
    limit: int | None = None,
) -> list[Segment]:
    """One clip per 'highlight' marker, clamped to [0, total] and de-overlapped."""
    windows = [
        (max(0, m.tc_ms - pre_ms), min(total_ms, m.tc_ms + post_ms))
        for m in markers
        if m.category == "highlight"
    ]
    merged = merge_windows(windows)
    segments = [Segment(s, e, "highlight") for s, e in merged if e > s]
    return segments[:limit] if limit is not None else segments


def chapters_from_markers(markers: list[Marker]) -> list[Chapter]:
    """Chapter boundaries from 'chapter' markers, in timecode order."""
    chapters = [
        Chapter(m.tc_ms, m.note or f"פרק {i + 1}")
        for i, m in enumerate(sorted(
            (m for m in markers if m.category == "chapter"), key=lambda m: m.tc_ms
        ))
    ]
    return chapters


def build_edl(
    source: str,
    markers: list[Marker],
    total_ms: int,
    template: DeliverableTemplate,
) -> Edl:
    """Deterministic EDL from markers honoring the deliverable template."""
    edl = Edl(source=source)
    if template.full_edit:
        edl.full_edit = complement(total_ms, fix_windows(markers, total_ms))
    if template.highlights:
        edl.highlights = highlight_segments(markers, total_ms, limit=template.highlights)
    if template.chapters:
        edl.chapters = chapters_from_markers(markers)
    return edl


def total_kept_ms(segments: list[Segment]) -> int:
    return sum(s.duration_ms for s in segments)
