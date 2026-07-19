"""Edit planning (docs §6.4).

Produces the EDL. With an ANTHROPIC_API_KEY + a transcript, Claude refines the
plan (chapter titles, extra dead-air/filler cuts). Otherwise — and on any error
— it falls back to the deterministic marker-based EDL from `edl.build_edl`.
"""

from __future__ import annotations

import json
import os

from .edl import build_edl, complement, fix_windows, highlight_segments, merge_windows
from .models import Chapter, DeliverableTemplate, Edl, Marker, TranscriptSegment
from .transcribe import transcript_text

CLAUDE_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-opus-4-8")

_SYSTEM = (
    "You are a video editor assistant. Given a podcast/studio transcript with "
    "millisecond timestamps and human review markers, return STRICT JSON with "
    "keys: chapters (list of {start_ms:int, title:str}) and extra_cuts (list of "
    "{start_ms:int, end_ms:int}) for filler/dead-air to remove. Titles in the "
    "transcript's language. Return ONLY JSON."
)


def plan_edl(
    source: str,
    markers: list[Marker],
    transcript: list[TranscriptSegment],
    total_ms: int,
    template: DeliverableTemplate,
) -> Edl:
    heuristic = build_edl(source, markers, total_ms, template)
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key or not transcript:
        return heuristic
    try:
        refined = _plan_with_claude(source, markers, transcript, total_ms, template, key)
        return refined or heuristic
    except Exception as exc:  # noqa: BLE001 - LLM path must never break the pipeline
        print(f"[plan] Claude planning failed, using heuristic EDL: {exc}")
        return heuristic


def _plan_with_claude(
    source: str,
    markers: list[Marker],
    transcript: list[TranscriptSegment],
    total_ms: int,
    template: DeliverableTemplate,
    api_key: str,
) -> Edl | None:
    import anthropic  # type: ignore

    client = anthropic.Anthropic(api_key=api_key)
    marker_lines = "\n".join(f"{m.tc_ms} {m.category} {m.note or ''}".strip() for m in markers)
    prompt = (
        f"Total duration: {total_ms} ms.\n\n"
        f"Review markers:\n{marker_lines or '(none)'}\n\n"
        f"Transcript:\n{transcript_text(transcript)}"
    )
    message = client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=2000,
        system=_SYSTEM,
        messages=[{"role": "user", "content": prompt}],
    )
    text = "".join(block.text for block in message.content if block.type == "text")
    data = json.loads(_extract_json(text))

    extra_cuts = [
        (int(c["start_ms"]), int(c["end_ms"]))
        for c in data.get("extra_cuts", [])
        if c.get("end_ms", 0) > c.get("start_ms", 0)
    ]
    removes = merge_windows(fix_windows(markers, total_ms) + extra_cuts)

    edl = Edl(source=source)
    if template.full_edit:
        edl.full_edit = complement(total_ms, removes)
    if template.highlights:
        edl.highlights = highlight_segments(markers, total_ms, limit=template.highlights)
    if template.chapters:
        chapters = [
            Chapter(int(c["start_ms"]), str(c["title"]))
            for c in data.get("chapters", [])
            if "start_ms" in c and c.get("title")
        ]
        edl.chapters = chapters or build_edl(source, markers, total_ms, template).chapters
    return edl


def _extract_json(text: str) -> str:
    """Pull the first {...} JSON object out of a model response."""
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end < start:
        raise ValueError("no JSON object in response")
    return text[start : end + 1]
