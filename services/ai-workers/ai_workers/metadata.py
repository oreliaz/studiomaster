"""Episode metadata — title + description from the transcript, via Claude
(docs §6.4). Deterministic fallback when no ANTHROPIC_API_KEY is set. Pure of
side effects; the pilot writes the files.
"""

from __future__ import annotations

import json
import os
import re

CLAUDE_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-opus-4-8")


def generate_metadata(transcript_text: str, language: str = "he", guidance: str = "") -> dict | None:
    """Ask Claude for {title, description, tags}. None if unavailable/failed."""
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key or not transcript_text.strip():
        return None
    system = (
        "You write publishing metadata for a podcast episode from its transcript. "
        f"Write in the content language ({language}). Produce a punchy, curiosity-"
        "driving TITLE (<=70 chars, no clickbait lies), a DESCRIPTION (2-4 sentences "
        "summarising the value + a light call to action), and 5-10 lowercase TAGS. "
        'Return ONLY JSON: {"title":"...","description":"...","tags":["..."]}'
    )
    if guidance.strip():
        system += f"\n\nEDITOR GUIDANCE (follow closely): {guidance.strip()}"
    try:
        import anthropic  # type: ignore

        client = anthropic.Anthropic(api_key=key)
        message = client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=1200,
            system=system,
            messages=[{"role": "user", "content": transcript_text[:24000]}],
        )
        text = "".join(b.text for b in message.content if b.type == "text")
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end < start:
            return None
        data = json.loads(text[start:end + 1])
        return {
            "title": str(data.get("title", "")).strip(),
            "description": str(data.get("description", "")).strip(),
            "tags": [str(x).strip() for x in data.get("tags", []) if str(x).strip()][:12],
        }
    except Exception as exc:  # noqa: BLE001 - never break the pipeline
        print(f"[metadata] Claude failed, using fallback: {exc}", flush=True)
        return None


def fallback_metadata(transcript_text: str) -> dict:
    """Naive metadata from the transcript's opening line (no LLM)."""
    first = ""
    for line in transcript_text.splitlines():
        stripped = re.sub(r"^\[[^\]]*\]\s*", "", line).strip()
        if stripped:
            first = stripped
            break
    return {"title": first[:70] or "פרק", "description": first[:300], "tags": []}
