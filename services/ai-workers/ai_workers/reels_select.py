"""Model-based reel clip selection (docs §6.4).

Reads the timestamped episode transcript and asks Claude to choose the strongest
hook-first, self-contained clips. This replaces the mechanical marker+uniform
planner (reels_plan.propose_specs) when an ANTHROPIC_API_KEY and a transcript are
available. Everything the model returns is re-validated here (length, bounds,
overlap) so a bad response can never produce broken cuts; on any failure the
caller falls back to the deterministic planner.

The pure normalisation (`normalize_clips`) is unit-tested without the network.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass

CLAUDE_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-opus-4-8")


@dataclass(frozen=True)
class ClipPick:
    start_s: float
    end_s: float
    hook: str
    slug: str


def load_transcript(json_path: str) -> tuple[list[dict], float]:
    """Load transcribe_full's sidecar JSON → (segments, duration_seconds)."""
    with open(json_path, encoding="utf-8") as f:
        data = json.load(f)
    segments = data.get("segments", [])
    duration = float(data.get("duration", 0.0)) or (
        max((float(s.get("end", 0)) for s in segments), default=0.0)
    )
    return segments, duration


def _slugify(title: str, idx: int) -> str:
    ascii_slug = re.sub(r"[^A-Za-z0-9]+", "-", title or "").strip("-").lower()
    return ascii_slug[:32] or f"clip{idx:02d}"


def normalize_clips(
    raw: list[dict],
    duration_s: float,
    count: int,
    min_s: int,
    max_s: int,
) -> list[ClipPick]:
    """Clamp, length-fix, de-overlap and cap the model's raw clip list.

    Pure and defensive: unknown/zero values are dropped, lengths are pulled into
    [min_s, max_s], and clips that still overlap an already-kept one are skipped.
    """
    candidates: list[tuple[float, float, str, str]] = []
    for i, c in enumerate(raw, start=1):
        try:
            start = max(0.0, float(c["start"]))
            end = float(c["end"])
        except (KeyError, TypeError, ValueError):
            continue
        if end <= start:
            continue
        # Pull the length into [min_s, max_s], then clamp to the episode bounds.
        length = end - start
        if length < min_s:
            end = start + min_s
        elif length > max_s:
            end = start + max_s
        if duration_s > 0:
            end = min(end, duration_s)
            start = max(0.0, min(start, max(0.0, duration_s - 1)))
        if end - start < min(min_s, 5):
            continue
        hook = str(c.get("hook", "")).strip()
        slug = _slugify(str(c.get("title", "")), i)
        candidates.append((round(start, 1), round(end, 1), hook, slug))

    candidates.sort(key=lambda t: t[0])
    kept: list[ClipPick] = []
    for start, end, hook, slug in candidates:
        if any(start < k.end_s and end > k.start_s for k in kept):
            continue  # overlaps an already-kept clip
        kept.append(ClipPick(start, end, hook, slug))
        if len(kept) >= count:
            break
    return kept


def _build_prompt(segments: list[dict], duration_s: float, count: int, min_s: int, max_s: int) -> str:
    lines = [f"{float(s.get('start', 0)):.1f}-{float(s.get('end', 0)):.1f} {s.get('text', '')}"
             for s in segments]
    transcript = "\n".join(lines)
    return (
        f"Episode duration: {duration_s:.0f} seconds.\n"
        f"Pick the {count} strongest social-reel clips.\n\n"
        f"Timestamped transcript (start-end seconds, then text):\n{transcript}"
    )


def select_clips(
    segments: list[dict],
    duration_s: float,
    count: int,
    min_s: int = 40,
    max_s: int = 70,
    language: str = "he",
    guidance: str = "",
) -> list[ClipPick] | None:
    """Ask Claude to pick the best clips. Returns None if unavailable/failed.

    `guidance` carries free-text editor corrections + the podcast's accumulated
    knowledge-base notes, so human feedback steers the selection.
    """
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key or not segments:
        return None
    system = (
        "You are a senior short-form editor for a podcast studio. From a "
        "timestamped transcript, choose the strongest standalone clips for "
        "social reels. HARD RULES: "
        "(1) Every clip STARTS on a hook — a curiosity-provoking or bold line "
        "in the first 1-3 seconds. "
        "(2) Every clip is SELF-CONTAINED — it opens and resolves one idea and "
        "NEVER starts or ends mid-sentence; align boundaries to the transcript's "
        "segment start/end times. "
        f"(3) Length between {min_s} and {max_s} seconds. "
        "(4) Prefer emotional peaks, contrarian claims, concrete numbers or "
        "stories, and punchy takeaways. "
        "(5) Clips must NOT overlap and should spread across the episode. "
        f"(6) The hook text must be written in the episode's language ({language}). "
        'Return ONLY a JSON object: {"clips":[{"start":<sec>,"end":<sec>,'
        '"hook":"<short hook line>","title":"<3-5 word english slug>"}]}'
    )
    if guidance.strip():
        system += (
            "\n\nEDITOR GUIDANCE (human corrections + this show's conventions — "
            f"follow these closely): {guidance.strip()}"
        )
    try:
        import anthropic  # type: ignore

        client = anthropic.Anthropic(api_key=key)
        message = client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=4000,
            system=system,
            messages=[{"role": "user",
                       "content": _build_prompt(segments, duration_s, count, min_s, max_s)}],
        )
        text = "".join(b.text for b in message.content if b.type == "text")
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end < start:
            return None
        data = json.loads(text[start:end + 1])
        picks = normalize_clips(data.get("clips", []), duration_s, count, min_s, max_s)
        return picks or None
    except Exception as exc:  # noqa: BLE001 - the LLM path must never break the pipeline
        print(f"[reels-select] Claude selection failed, using markers: {exc}", flush=True)
        return None
