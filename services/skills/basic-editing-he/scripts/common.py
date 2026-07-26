"""Shared helpers for the basic-editing pipeline (ffprobe, silence detection, time fmt)."""
import json, os, re, subprocess, sys

def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")

def ffprobe_duration(path):
    r = run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", path])
    try:
        return float(r.stdout.strip())
    except ValueError:
        return -1.0  # unreadable/partial file

def ffprobe_json(path):
    r = run(["ffprobe", "-v", "error", "-print_format", "json",
             "-show_format", "-show_streams", path])
    return json.loads(r.stdout)

def measure_loudness(path):
    """Two-pass loudnorm measurement -> dict(input_i, input_tp, input_lra, input_thresh)."""
    r = run(["ffmpeg", "-hide_banner", "-nostats", "-vn", "-i", path,
             "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=summary",
             "-f", "null", "-"])
    out = r.stderr + r.stdout
    def grab(label):
        m = re.search(label + r":\s*([-\d.]+)", out)
        return float(m.group(1)) if m else None
    return {"input_i": grab("Input Integrated"), "input_tp": grab("Input True Peak"),
            "input_lra": grab("Input LRA"), "input_thresh": grab("Input Threshold")}

def detect_silences(path, noise_db=-45.0, min_dur=0.35):
    """Return list of (start, end) silent intervals via ffmpeg silencedetect."""
    r = run(["ffmpeg", "-hide_banner", "-nostats", "-i", path,
             "-af", f"silencedetect=noise={noise_db}dB:d={min_dur}", "-f", "null", "-"])
    txt = r.stderr
    starts = [float(m) for m in re.findall(r"silence_start:\s*([-\d.]+)", txt)]
    ends = [float(m) for m in re.findall(r"silence_end:\s*([-\d.]+)", txt)]
    sils = []
    for i, s in enumerate(starts):
        e = ends[i] if i < len(ends) else None
        if e is not None:
            sils.append((max(0.0, s), e))
    return sils

def fmt_tc(t):
    t = max(0.0, float(t))
    h = int(t // 3600); m = int((t % 3600) // 60); s = t % 60
    if h:
        return f"{h}:{m:02d}:{s:05.2f}"
    return f"{m}:{s:05.2f}"

def parse_tc(s):
    """Parse '90', '1:30', '1:02:03.5' (h:m:s / m:s / s) -> seconds."""
    s = s.strip().replace(",", ".")
    if not s:
        return None
    parts = s.split(":")
    parts = [float(p) for p in parts]
    if len(parts) == 1:
        return parts[0]
    if len(parts) == 2:
        return parts[0] * 60 + parts[1]
    return parts[0] * 3600 + parts[1] * 60 + parts[2]

def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)

def save_json(path, obj):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
