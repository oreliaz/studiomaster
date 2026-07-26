"""
Auto-discover the podcast video + context documents in a work folder.

Picks the largest video file as the episode, collects any text/PDF/Word docs
the client dropped in, and looks for a logo image.

Usage:
  python discover.py <FOLDER>

Prints a JSON report to stdout.
"""
import json, os, subprocess, sys

VIDEO_EXT = {".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".flv", ".wmv", ".m4a", ".mp3", ".wav"}
DOC_EXT   = {".txt", ".md", ".pdf", ".docx", ".doc", ".rtf", ".csv", ".xlsx"}
IMG_EXT   = {".png", ".jpg", ".jpeg", ".webp"}


def ffprobe(path):
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=width,height,r_frame_rate",
             "-show_entries", "format=duration",
             "-of", "json", path],
            capture_output=True, text=True, timeout=120)
        d = json.loads(out.stdout or "{}")
        st = (d.get("streams") or [{}])[0]
        fr = st.get("r_frame_rate", "0/1")
        try:
            num, den = fr.split("/"); fps = round(float(num) / float(den), 3) if float(den) else 0
        except Exception:
            fps = 0
        return {
            "w": st.get("width"), "h": st.get("height"),
            "dur": round(float(d.get("format", {}).get("duration", 0) or 0), 2),
            "fps": fps,
        }
    except Exception as e:
        return {"error": str(e)}


def main():
    folder = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else ".")
    videos, docs, images = [], [], []
    for name in os.listdir(folder):
        p = os.path.join(folder, name)
        if not os.path.isfile(p):
            continue
        ext = os.path.splitext(name)[1].lower()
        if ext in VIDEO_EXT:
            videos.append((os.path.getsize(p), p))
        elif ext in DOC_EXT:
            docs.append(p)
        elif ext in IMG_EXT:
            images.append(p)

    videos.sort(reverse=True)  # largest first
    episode = videos[0][1] if videos else None

    # logo = image whose name hints "logo"/"brand"/"watermark", else smallest image
    logo = None
    hint = [p for p in images if any(k in os.path.basename(p).lower()
            for k in ("logo", "brand", "watermark", "סמל", "לוגו"))]
    if hint:
        logo = hint[0]
    elif images:
        logo = min(images, key=os.path.getsize)

    report = {
        "folder": folder,
        "video": episode,
        "video_meta": ffprobe(episode) if episode else None,
        "extra_videos": [p for _, p in videos[1:]],
        "docs": sorted(docs),
        "logo": logo,
        "images": sorted(images),
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
