"""
Render the ~1-minute review clips for every proposed cut.

For each removal [a,b] writes into <work>/review/:
  preview_NN.mp4  - the SEAM: CTX sec before the cut  +  CTX sec after it, joined,
                    i.e. exactly how the cut will sound/look once applied.
  removed_NN.mp4  - what is being deleted (capped at RMAX sec) so the editor can confirm
                    it really is a mistake / prep / dead air.

Low-res + fast preset: this is only for the single human review round.

Usage:  python render_previews.py <work_dir> [ctx_sec=12] [rmax_sec=40]
"""
import os, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import load_json, fmt_tc

def sh(cmd):
    subprocess.run(cmd, check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def main():
    work = sys.argv[1]
    CTX = float(sys.argv[2]) if len(sys.argv) > 2 else 12.0
    RMAX = float(sys.argv[3]) if len(sys.argv) > 3 else 40.0
    plan = load_json(os.path.join(work, "edit_plan.json"))
    src = plan["source"]
    total = plan["total_sec"]
    rev = os.path.join(work, "review")
    os.makedirs(rev, exist_ok=True)

    VF = "scale=640:-2,setsar=1"
    for i, r in enumerate(plan["removals"], 1):
        a, b = r["start"], r["end"]
        lo = max(0.0, a - CTX); hi = min(total, b + CTX)
        left = a - lo; right = hi - b
        prev = os.path.join(rev, f"preview_{i:02d}.mp4")
        if left > 0.1 and right > 0.1:
            # two FAST input-seeks (-ss before -i) joined -> no full-file decode
            fc = (
                f"[0:v]setpts=PTS-STARTPTS,{VF}[lv];[0:a]asetpts=PTS-STARTPTS[la];"
                f"[1:v]setpts=PTS-STARTPTS,{VF}[rv];[1:a]asetpts=PTS-STARTPTS[ra];"
                f"[lv][la][rv][ra]concat=n=2:v=1:a=1[v][a]"
            )
            sh(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                "-ss", str(lo), "-t", str(left), "-i", src,
                "-ss", str(b), "-t", str(right), "-i", src,
                "-filter_complex", fc, "-map", "[v]", "-map", "[a]",
                "-c:v", "libx264", "-crf", "28", "-preset", "veryfast",
                "-c:a", "aac", "-b:a", "128k", prev])
        else:  # head or tail: just show context around the surviving boundary
            s0 = b if left <= 0.1 else lo
            e0 = min(total, s0 + 2 * CTX)
            sh(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", str(s0),
                "-i", src, "-t", str(e0 - s0), "-vf", VF,
                "-c:v", "libx264", "-crf", "28", "-preset", "veryfast",
                "-c:a", "aac", "-b:a", "128k", prev])
        # removed clip (capped)
        rem = os.path.join(rev, f"removed_{i:02d}.mp4")
        rdur = min(RMAX, b - a)
        sh(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", str(a),
            "-i", src, "-t", str(rdur), "-vf", VF,
            "-c:v", "libx264", "-crf", "30", "-preset", "veryfast",
            "-c:a", "aac", "-b:a", "96k", rem])
        print(f"[preview] {i:02d}  seam {fmt_tc(a)}|{fmt_tc(b)}  "
              f"removed {b-a:.1f}s  -> preview_{i:02d}.mp4", flush=True)

    print(f"[preview] done: {len(plan['removals'])} cuts -> {rev}")

if __name__ == "__main__":
    main()
