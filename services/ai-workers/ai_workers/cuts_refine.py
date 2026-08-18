"""Transcript-aware refinement of 'fix' cut ranges (docs §6.4).

A 'fix' marker is a single moment the host flagged a mistake: the botched take
PRECEDES the press, and the good retake continues AFTER it. Instead of removing
a fixed window, read the timed transcript and remove exactly the flubbed span —
from the start of the sentence being redone up to the marker. Uses Claude when
available; otherwise snaps the cut start to the transcript sentence boundary.

The deterministic fallback (`fallback_cuts`) is pure and unit-tested.
"""

from __future__ import annotations

import json
import os

from .models import Marker

CLAUDE_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-opus-4-8")


def _fmt(sec: float) -> str:
    sec = max(0.0, sec)
    m = int(sec // 60)
    return f"{m}:{sec - m * 60:04.1f}"


def cuts_to_txt(ranges: list[tuple[float, float, str]]) -> str:
    """Format refined ranges as the basic-editing skill's cuts.txt body."""
    lines = [f"{_fmt(a)} {_fmt(b)} {r}" for a, b, r in ranges if b > a]
    return "\n".join(lines) + ("\n" if lines else "")


def fallback_cuts(
    fix_markers: list[Marker], segments: list[dict], pre_ms: int = 4000
) -> list[tuple[float, float, str]]:
    """Snap each fix cut's start to the start of the transcript sentence the
    marker falls in (removing that sentence up to the press). Falls back to a
    fixed pre-window when no segment is nearby."""
    out: list[tuple[float, float, str]] = []
    for m in fix_markers:
        t = m.tc_ms / 1000.0
        seg_start: float | None = None
        for s in segments:
            st = float(s.get("start", 0))
            en = float(s.get("end", 0))
            if st <= t <= en:
                seg_start = st
                break
            if st <= t:
                seg_start = st  # last sentence starting before the marker
        start = seg_start if seg_start is not None else max(0.0, t - pre_ms / 1000.0)
        if t - start < 0.3:  # marker at the very start of a sentence — take the pre-window
            start = max(0.0, t - pre_ms / 1000.0)
        out.append((round(start, 1), round(t, 1), (m.note or "editor-marked").strip()))
    return out


def _refine_with_claude(
    fix_markers: list[Marker], segments: list[dict], guidance: str, api_key: str
) -> list[tuple[float, float, str]]:
    import anthropic  # type: ignore

    client = anthropic.Anthropic(api_key=api_key)
    transcript = "\n".join(
        f"{float(s.get('start', 0)):.1f}-{float(s.get('end', 0)):.1f} {s.get('text', '')}"
        for s in segments
    )
    marks = "\n".join(
        f"- marker at {m.tc_ms / 1000.0:.1f}s: {(m.note or '').strip()}" for m in fix_markers
    )
    system = (
        "You are a precise podcast video editor. The host pressed 'fix' markers "
        "at moments a mistake or false start occurred: the botched take PRECEDES "
        "the marker, and the good retake continues AFTER it. Using the timestamped "
        "transcript, return the EXACT spans to REMOVE so each cut is clean and "
        "lands on sentence boundaries — start at the beginning of the botched "
        "sentence/phrase, end where the retake begins (at or just after the "
        "marker). NEVER cut mid-word or mid-sentence. If a marker's note gives "
        "specific instructions, follow them. "
        'Return ONLY JSON: {"cuts":[{"start":<sec>,"end":<sec>,"reason":"..."}]}'
    )
    if guidance.strip():
        system += f"\n\nEDITOR GUIDANCE (follow closely): {guidance.strip()}"
    message = client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=2000,
        system=system,
        messages=[{"role": "user", "content": f"Fix markers:\n{marks}\n\nTranscript:\n{transcript}"}],
    )
    text = "".join(b.text for b in message.content if b.type == "text")
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end < start:
        return []
    data = json.loads(text[start:end + 1])
    duration = max((float(s.get("end", 0)) for s in segments), default=0.0) + 5.0
    out: list[tuple[float, float, str]] = []
    for c in data.get("cuts", []):
        try:
            a = max(0.0, float(c["start"]))
            b = min(float(c["end"]), duration)
        except (KeyError, TypeError, ValueError):
            continue
        if b <= a:
            continue
        out.append((round(a, 1), round(b, 1), str(c.get("reason", "editor-marked"))[:80]))
    return out


def refine_fix_cuts(
    fix_markers: list[Marker], segments: list[dict], guidance: str = ""
) -> list[tuple[float, float, str]]:
    """Model-based clean cut ranges from fix markers; deterministic fallback."""
    if not fix_markers:
        return []
    key = os.environ.get("ANTHROPIC_API_KEY")
    if key and segments:
        try:
            picks = _refine_with_claude(fix_markers, segments, guidance, key)
            if picks:
                return picks
        except Exception as exc:  # noqa: BLE001 - never break the pipeline
            print(f"[cuts] Claude refine failed, using sentence snap: {exc}", flush=True)
    return fallback_cuts(fix_markers, segments)
