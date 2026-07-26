"""Pick reel clip windows (docs §6.4) — pure + unit-tested.

Prefers the editor's 'highlight' markers as clip centers; if there are fewer
than requested, fills the rest with evenly spaced centers across the episode.
Each clip is clamped to [min, max] seconds and to the episode bounds. Feeds the
podcast-reels-he skill's `cut_clips.py` (NN:start:end:slug specs).
"""

from __future__ import annotations

from .models import Marker


def propose_specs(
    markers: list[Marker],
    duration_ms: int,
    count: int,
    min_s: int = 40,
    max_s: int = 70,
) -> list[tuple[int, float, float, str]]:
    if duration_ms <= 0 or count <= 0:
        return []
    clip_ms = int(((min_s + max_s) / 2) * 1000)
    half = clip_ms // 2

    centers = [m.tc_ms for m in sorted(markers, key=lambda m: m.tc_ms) if m.category == "highlight"]
    if len(centers) < count:
        # evenly spaced centers across the episode fill the remainder
        step = duration_ms / (count + 1)
        extra = [int(step * (i + 1)) for i in range(count)]
        for c in extra:
            if len(centers) >= count:
                break
            if all(abs(c - existing) > clip_ms for existing in centers):
                centers.append(c)
    centers = sorted(centers)[:count]

    specs: list[tuple[int, float, float, str]] = []
    for i, center in enumerate(centers, start=1):
        start = max(0, center - half)
        end = min(duration_ms, start + clip_ms)
        start = max(0, end - clip_ms)
        specs.append((i, round(start / 1000, 1), round(end / 1000, 1), f"clip{i:02d}"))
    return specs


def spec_to_arg(spec: tuple[int, float, float, str]) -> str:
    idx, start, end, slug = spec
    return f"{idx:02d}:{start}:{end}:{slug}"
