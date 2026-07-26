"""
Word-level Hebrew transcription of the SELECTED clips only (cheap — short clips).

Uses the same ivrit.ai model as transcribe_full.py, with word_timestamps=True so we
get per-word start/end for caption timing.

Usage:
  python transcribe_words.py <OUT_DIR> <clip01.mp4> [<clip02.mp4> ...]

Writes <OUT_DIR>/<NN>_words.json per clip, where NN is the clip's filename prefix.
"""
import json, os, re, sys

OUT_DIR = sys.argv[1]
CLIPS = sys.argv[2:]
MODEL = os.environ.get("MODEL", "ivrit-ai/whisper-large-v3-turbo-ct2")
LANG = os.environ.get("LANG_CODE", "he")
os.makedirs(OUT_DIR, exist_ok=True)


def main():
    from faster_whisper import WhisperModel
    print(f"[words] model={MODEL} loading...", flush=True)
    model = WhisperModel(MODEL, device="cpu", compute_type="int8")
    for clip in CLIPS:
        base = os.path.basename(clip)
        m = re.match(r"^(\d{2})", base)
        nn = m.group(1) if m else os.path.splitext(base)[0]
        segments, info = model.transcribe(
            clip, language=LANG, beam_size=5, word_timestamps=True,
            vad_filter=True, vad_parameters=dict(min_silence_duration_ms=300),
            condition_on_previous_text=False,
        )
        segs = []
        for s in segments:
            words = [{"start": round(w.start, 3), "end": round(w.end, 3),
                      "word": w.word.strip()} for w in (s.words or []) if w.word.strip()]
            segs.append({"start": round(s.start, 3), "end": round(s.end, 3),
                         "text": s.text.strip(), "words": words})
        out = os.path.join(OUT_DIR, f"{nn}_words.json")
        with open(out, "w", encoding="utf-8") as f:
            json.dump({"clip": nn, "language": info.language,
                       "duration": round(info.duration, 2), "segments": segs},
                      f, ensure_ascii=False, indent=1)
        print(f"[words] {nn} -> {out}  ({sum(len(s['words']) for s in segs)} words)", flush=True)
    print("[words] done", flush=True)


if __name__ == "__main__":
    main()
