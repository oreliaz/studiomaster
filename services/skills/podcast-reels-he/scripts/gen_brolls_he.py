# -*- coding: utf-8 -*-
"""
gen_brolls_he.py  —  generate per-clip b-roll with Qwen-Image and write the manifest
that render_premium.py consumes. This is the ONE b-roll step; render_premium then
auto-discovers the manifest, so no config hand-authoring is needed.

You author a small `broll_prompts.json` (token-lean — a few lines per clip):
{
  "aspect": "9:16",                       # optional, default 9:16
  "base_style": "<override BROLL_BASE>",  # optional
  "clips": {
    "03": [
      {"prompt": "wide cinematic Tel Aviv skyline at dusk, warm light",
       "at": 8.0, "dur": 4.0, "transition": "fade", "tag": "", "headline": ""},
      {"prompt": "close-up hands counting shekel banknotes on a desk", "at": 34, "dur": 4}
    ],
    "07": [ {"prompt": "a lone runner on an empty road at sunrise", "at": 6, "dur": 4} ]
  }
}
Only `prompt` + `at` (start seconds) are required per b-roll; `dur` defaults to 4.0,
`transition` to "fade" (safest full-frame cut), `tag`/`headline` are optional chips.

For each b-roll it renders a 9:16 Qwen still to <WORK>/broll/<NN>_<i>.png, then writes
<WORK>/broll/<NN>.brolls.json = [{img, start, dur, transition, tag, headline}, ...]
(absolute img paths). render_premium.py picks these up automatically.

Usage:
  python gen_brolls_he.py <WORK> <broll_prompts.json> [--env PATH] [--only 03 07]

Notes:
  * B-roll cutaways cover the presenter's face for their window — place them over
    setup/transition lines, never over the punchline. build_reel auto-drops any b-roll
    that would run past the clip end.
  * Cheap + local-ish: one Qwen call per image, staggered to respect the quota.
"""
import argparse, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from qwen_broll import generate, BROLL_BASE, ASPECTS  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("work")
    ap.add_argument("prompts")
    ap.add_argument("--env", default="")
    ap.add_argument("--only", nargs="*", default=[])
    a = ap.parse_args()

    work = os.path.abspath(a.work)
    spec = json.load(open(a.prompts, encoding="utf-8"))
    aspect = spec.get("aspect", "9:16")
    base = spec.get("base_style", BROLL_BASE)
    size = ASPECTS.get(aspect, ASPECTS["9:16"])
    env = a.env or None

    broll_dir = os.path.join(work, "broll")
    os.makedirs(broll_dir, exist_ok=True)

    clips = spec.get("clips", {})
    total_ok = 0
    for nn, brolls in clips.items():
        if a.only and nn not in a.only:
            continue
        manifest = []
        for i, b in enumerate(brolls, 1):
            prompt = b.get("prompt", "").strip()
            if not prompt:
                continue
            img = os.path.join(broll_dir, f"{nn}_{i}.png")
            if os.path.exists(img) and os.path.getsize(img) > 10000:
                print(f"#{nn}.{i} SKIP (exists)", flush=True)
            else:
                print(f"#{nn}.{i} generating...", flush=True)
                if not generate(base + prompt, img, size=size, env_path=env):
                    print(f"#{nn}.{i} FAIL", flush=True)
                    continue
                print(f"#{nn}.{i} OK {os.path.getsize(img)//1024}KB", flush=True)
            manifest.append({
                "img": os.path.abspath(img),
                "start": float(b.get("at", b.get("start", 0.0))),
                "dur": float(b.get("dur", 4.0)),
                "transition": b.get("transition", "fade"),
                "tag": b.get("tag", ""),
                "headline": b.get("headline", ""),
            })
            total_ok += 1
        if manifest:
            mpath = os.path.join(broll_dir, f"{nn}.brolls.json")
            json.dump(manifest, open(mpath, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
            print(f"#{nn} manifest -> {mpath}  ({len(manifest)} b-roll)", flush=True)
    print(f"DONE {total_ok} b-roll image(s) across {len(clips)} clip(s) -> {broll_dir}", flush=True)


if __name__ == "__main__":
    main()
