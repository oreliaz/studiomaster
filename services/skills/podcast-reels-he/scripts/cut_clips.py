"""
Frame-accurate clip cutter. Re-encodes (not stream-copy) so the start/end are exact.

Usage:
  python cut_clips.py <SRC> <OUT_DIR> "01:12.3:71.8:slug" "02:130.0:198.4:slug" ...

Each spec is  NN:start_sec:end_sec:slug  -> writes <OUT_DIR>/<NN>_<slug>.mp4
"""
import os, subprocess, sys

SRC = sys.argv[1]
OUT_DIR = sys.argv[2]
os.makedirs(OUT_DIR, exist_ok=True)

for spec in sys.argv[3:]:
    nn, start, end, slug = spec.split(":", 3)
    out = os.path.join(OUT_DIR, f"{nn}_{slug}.mp4")
    cmd = ["ffmpeg", "-y", "-ss", start, "-to", end, "-i", SRC, "-sn",
           "-map", "0:v:0", "-map", "0:a:0",
           "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
           "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out]
    print(f"[cut] {nn} {start}->{end} -> {out}", flush=True)
    subprocess.run(cmd, check=True)
print("[cut] done", flush=True)
