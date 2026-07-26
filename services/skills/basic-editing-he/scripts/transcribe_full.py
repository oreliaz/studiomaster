"""
Transcribe a full Hebrew podcast LOCALLY with the best Hebrew Whisper model, in RAM-safe
time-chunks so long episodes don't blow up on a low-RAM / 4-core box.

Default model: ivrit-ai/whisper-large-v3-turbo-ct2 (ivrit.ai, CTranslate2 build for
faster-whisper) — the most accurate Hebrew transcription that runs on CPU. Override with
the MODEL env var (MODEL=ivrit-ai/whisper-large-v3-ct2 for full-large accuracy,
MODEL=medium for a faster multilingual fallback).

WHY CHUNKED: faster-whisper's feature extractor computes the STFT over the WHOLE audio at
once; for a 75-min episode that's a >1 GiB float array that won't fit in free RAM here.
We decode the audio once and feed model.transcribe() overlapping time-chunks, offsetting
each chunk's timestamps back onto the global timeline. Output shape is identical to the
old whole-file path: <out.txt> ("[m:ss -> m:ss] text") + sibling <out>.json.

First run downloads the model (~1.6 GB) into the HF cache — once. Run in the BACKGROUND.

Usage:  python transcribe_full.py <audio_or_video> <out.txt> [model]
Env:    MODEL, LANG_CODE (he), CHUNK_SEC (600), OVERLAP_SEC (2), CT2_FORCE_CPU_ISA=GENERIC
        (set GENERIC to avoid the MKL malloc crash on some CPUs).
"""
import json, os, sys

SRC = sys.argv[1]
OUT = sys.argv[2]
MODEL = sys.argv[3] if len(sys.argv) > 3 else os.environ.get(
    "MODEL", "ivrit-ai/whisper-large-v3-turbo-ct2")
LANG = os.environ.get("LANG_CODE", "he")
SR = 16000
CHUNK = int(os.environ.get("CHUNK_SEC", "600"))
OVERLAP = int(os.environ.get("OVERLAP_SEC", "2"))


def fmt(t):
    m, s = divmod(float(t), 60)
    return f"{int(m)}:{s:05.2f}"


def main():
    from faster_whisper import WhisperModel
    from faster_whisper.audio import decode_audio
    print(f"[transcribe] model={MODEL} lang={LANG} loading...", flush=True)
    threads = int(os.environ.get("CPU_THREADS", str(min(8, (os.cpu_count() or 4)))))
    model = WhisperModel(MODEL, device="cpu", compute_type="int8", cpu_threads=threads)
    print("[transcribe] decoding audio...", flush=True)
    audio = decode_audio(SRC, sampling_rate=SR)
    total = len(audio) / SR
    print(f"[transcribe] duration {fmt(total)}; chunk={CHUNK}s overlap={OVERLAP}s", flush=True)

    segs = []
    last_end = 0.0
    start_s = 0.0
    while start_s < total:
        a = max(0.0, start_s - (OVERLAP if start_s > 0 else 0))
        b = min(total, start_s + CHUNK)
        clip = audio[int(a * SR):int(b * SR)]
        seg_iter, _info = model.transcribe(
            clip, language=LANG, beam_size=int(os.environ.get("BEAM", "5")),
            vad_filter=True, vad_parameters=dict(min_silence_duration_ms=500),
            condition_on_previous_text=False,
        )
        for s in seg_iter:
            gs, ge = a + s.start, a + s.end
            if ge <= last_end + 0.05:      # drop pieces inside the previous overlap window
                continue
            txt = s.text.strip()
            if not txt:
                continue
            segs.append({"start": round(gs, 3), "end": round(ge, 3), "text": txt})
            last_end = max(last_end, ge)
        print(f"[transcribe] {fmt(b)} / {fmt(total)}  ({len(segs)} segs)", flush=True)
        start_s += CHUNK

    segs.sort(key=lambda x: x["start"])
    lines = [f"[{fmt(s['start'])} -> {fmt(s['end'])}] {s['text']}" for s in segs]
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    js = os.path.splitext(OUT)[0] + ".json"
    with open(js, "w", encoding="utf-8") as f:
        json.dump({"language": LANG, "duration": round(total, 2),
                   "model": MODEL, "segments": segs}, f, ensure_ascii=False, indent=1)
    print(f"[transcribe] DONE -> {OUT}  ({len(segs)} segments, {fmt(total)})", flush=True)


if __name__ == "__main__":
    main()
