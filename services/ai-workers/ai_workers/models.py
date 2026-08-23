"""Data models shared across the AI pipeline (mirrors packages/shared)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

MarkerCategory = Literal["fix", "highlight", "chapter", "note", "intro"]


@dataclass(frozen=True)
class Marker:
    """A review marker dropped via the hotkey (see ReviewMarker in shared)."""

    tc_ms: int
    category: MarkerCategory
    note: str | None = None

    @staticmethod
    def from_dict(d: dict) -> "Marker":
        return Marker(
            tc_ms=int(d["tcMs"]),
            category=d.get("category", "note"),
            note=d.get("note") or None,
        )


@dataclass(frozen=True)
class Segment:
    """A [start, end) span in milliseconds, optionally labelled."""

    start_ms: int
    end_ms: int
    label: str | None = None

    @property
    def duration_ms(self) -> int:
        return max(0, self.end_ms - self.start_ms)


@dataclass(frozen=True)
class TranscriptSegment:
    start_ms: int
    end_ms: int
    text: str


@dataclass(frozen=True)
class Chapter:
    start_ms: int
    title: str


@dataclass
class Edl:
    """An Edit Decision List: what the render stage will produce."""

    source: str
    full_edit: list[Segment] = field(default_factory=list)
    highlights: list[Segment] = field(default_factory=list)
    chapters: list[Chapter] = field(default_factory=list)


@dataclass(frozen=True)
class DeliverableTemplate:
    """The "agreed materials" for a studio/content type (docs §6.4)."""

    full_edit: bool = True
    highlights: int = 3
    shorts_vertical: bool = True
    chapters: bool = True
    transcript: bool = True


DEFAULT_TEMPLATE = DeliverableTemplate()
