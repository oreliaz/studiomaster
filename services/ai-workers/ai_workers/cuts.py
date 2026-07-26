"""Convert StudioMaster review markers to the basic-editing skill's cuts.txt.

The basic-editing-he skill reads editor-marked removals from `cuts.txt`, one per
line: "START-END  reason" or "START END reason" (TC = s | m:s | h:m:s). Our
'fix' hotkey drops a single timecode at the moment the editor noticed a mistake,
so we turn each into a short window ENDING at the marker (the mistake precedes
the press) — plan_edits then snaps the boundaries to the nearest silence.

Pure + unit-tested so the mapping never drifts.
"""

from __future__ import annotations

from .models import Marker

DEFAULT_PRE_MS = 4_000


def _fmt_tc(ms: int) -> str:
    ms = max(0, ms)
    total_s = ms / 1000.0
    minutes = int(total_s // 60)
    seconds = total_s - minutes * 60
    return f"{minutes}:{seconds:04.1f}"


def marker_to_cut_line(marker: Marker, pre_ms: int = DEFAULT_PRE_MS) -> str:
    start = max(0, marker.tc_ms - pre_ms)
    reason = marker.note or "editor-marked"
    return f"{_fmt_tc(start)} {_fmt_tc(marker.tc_ms)} {reason}"


def markers_to_cuts_txt(markers: list[Marker], pre_ms: int = DEFAULT_PRE_MS) -> str:
    """Build the full cuts.txt body from the 'fix' markers, in timecode order."""
    fixes = sorted((m for m in markers if m.category == "fix"), key=lambda m: m.tc_ms)
    lines = [marker_to_cut_line(m, pre_ms) for m in fixes]
    return "\n".join(lines) + ("\n" if lines else "")
