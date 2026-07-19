"""Transcription via faster-whisper (docs §6.4).

Guarded so the pipeline still runs (without a transcript) when faster-whisper is
not installed — useful for CI and for the marker-only heuristic path.
"""

from __future__ import annotations

from .models import TranscriptSegment


def whisper_available() -> bool:
    try:
        import faster_whisper  # noqa: F401
    except ImportError:
        return False
    return True


def transcribe(media_path: str, model_size: str = "small") -> list[TranscriptSegment]:
    """Transcribe local media to timed segments. Returns [] if whisper is absent."""
    if not whisper_available():
        return []

    from faster_whisper import WhisperModel  # type: ignore

    model = WhisperModel(model_size, device="auto", compute_type="int8")
    segments, _info = model.transcribe(media_path, word_timestamps=False)
    return [
        TranscriptSegment(
            start_ms=int(seg.start * 1000),
            end_ms=int(seg.end * 1000),
            text=seg.text.strip(),
        )
        for seg in segments
    ]


def transcript_text(segments: list[TranscriptSegment]) -> str:
    return "\n".join(f"[{s.start_ms}] {s.text}" for s in segments)
