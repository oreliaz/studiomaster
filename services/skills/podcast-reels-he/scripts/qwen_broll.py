# -*- coding: utf-8 -*-
"""
qwen_broll.py  —  portable b-roll / image generator on Qwen-Image (Alibaba Model Studio).
Stdlib only (no pip installs). Self-contained; no secrets baked in.

SETUP (once): put the creds in the environment, or in a `.env` at the SKILL ROOT
(one level above this scripts/ folder) — copy `.env.example` to `.env` and fill in:
    QWEN_API_KEY         = sk-...                            (a DEFAULT-workspace key)
    QWEN_DASHSCOPE_BASE  = https://<host>.<region>.maas.aliyuncs.com/api/v1
A Default-Workspace key is required; a sub-workspace key fails with
AccessDenied.Unpurchased unless the root admin authorizes each model.

LIBRARY:
    from qwen_broll import generate, generate_batch, BROLL_BASE
    generate("a red apple on a table, studio photo", "apple.png", aspect="1:1")
    generate_batch({"skyline": "Tel Aviv skyline at golden dusk"}, out_dir="broll", aspect="9:16")

CLI:
    python qwen_broll.py "a luxury infinity pool at sunset" -o pool.png --aspect 9:16 --style
"""
import argparse, json, os, sys, time, urllib.request, urllib.error

# ---------------------------------------------------------------- config ----
MODEL = os.environ.get("QWEN_IMAGE_MODEL", "qwen-image-2.0-pro")  # or qwen-image-2.0 / -max

# House style prepended to every batch prompt (cinematic vertical editorial look).
BROLL_BASE = ("Vertical 9:16 cinematic editorial photograph, photorealistic, ultra detailed, "
              "shallow depth of field, no text, no logos, no watermark. ")

# aspect ratio -> Qwen "W*H" size (~1.5 MP).
ASPECTS = {
    "16:9": "1664*928", "9:16": "928*1664", "1:1": "1328*1328",
    "4:3": "1472*1140", "3:4": "1140*1472", "3:2": "1584*1056", "2:3": "1056*1584",
}

# skill root = one level above scripts/
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# ------------------------------------------------------------ credentials ---
def _load_creds(env_path=None):
    """Key/base from env vars, else from a .env (given path, skill root, or next to this file)."""
    key = os.getenv("QWEN_API_KEY")
    base = os.getenv("QWEN_DASHSCOPE_BASE")
    candidates = [env_path] if env_path else []
    candidates += [os.path.join(_ROOT, ".env"),
                   os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")]
    for path in candidates:
        if (key and base) or not path or not os.path.exists(path):
            continue
        for line in open(path, encoding="utf-8"):
            line = line.strip()
            if line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k, v = k.strip(), v.strip().strip('"').strip("'")
            if k == "QWEN_API_KEY":
                key = key or v
            elif k == "QWEN_DASHSCOPE_BASE":
                base = base or v
    if not (key and base):
        sys.exit("qwen_broll: missing creds. Set QWEN_API_KEY and QWEN_DASHSCOPE_BASE "
                 "(env or a .env at the skill root — see .env.example).")
    return key, base


# --------------------------------------------------------------- core API ---
def _request_url(prompt, size, key, base, retries=4):
    """One synchronous Qwen-Image call -> result URL. Retries on 429 rate-limit."""
    url = base.rstrip("/") + "/services/aigc/multimodal-generation/generation"
    body = {
        "model": MODEL,
        "input": {"messages": [{"role": "user", "content": [{"text": prompt}]}]},
        "parameters": {"size": size, "n": 1, "watermark": False, "prompt_extend": False},
    }
    req = urllib.request.Request(
        url, data=json.dumps(body).encode("utf-8"),
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
        method="POST")
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                data = json.load(r)
            content = data["output"]["choices"][0]["message"]["content"]
            return next(c["image"] for c in content if "image" in c)
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < retries - 1:
                wait = 20 * (attempt + 1)
                print(f"  rate-limited, retry in {wait}s...", flush=True)
                time.sleep(wait)
                continue
            print("qwen_broll HTTP", e.code, e.read().decode("utf-8", "replace")[:200], flush=True)
            return None
        except Exception as e:
            print("qwen_broll error:", e, flush=True)
            return None
    return None


def generate(prompt, out_path, aspect="9:16", size=None, env_path=None):
    """Generate ONE image from a full prompt -> out_path. Returns path or None."""
    key, base = _load_creds(env_path)
    size = size or ASPECTS.get(aspect, ASPECTS["9:16"])
    img_url = _request_url(prompt, size, key, base)
    if not img_url:
        return None
    urllib.request.urlretrieve(img_url, out_path)
    return out_path


def generate_batch(jobs, out_dir="broll", aspect="9:16", base_style=BROLL_BASE,
                   stagger=8, env_path=None):
    """
    jobs: {filename_without_ext: scene_prompt}. base_style is prepended to each.
    Saves <out_dir>/<name>.png; staggers calls to respect the per-minute quota.
    """
    os.makedirs(out_dir, exist_ok=True)
    saved = []
    for name, scene in jobs.items():
        dest = os.path.join(out_dir, name + ".png")
        if os.path.exists(dest) and os.path.getsize(dest) > 10000:
            print(name, "SKIP (exists)", flush=True); saved.append(dest); continue
        path = generate(base_style + scene, dest, aspect=aspect, env_path=env_path)
        if path:
            print(name, "OK", os.path.getsize(path) // 1024, "KB", flush=True)
            saved.append(path)
        else:
            print(name, "FAIL", flush=True)
        time.sleep(stagger)
    print(f"DONE {len(saved)}/{len(jobs)} -> {out_dir}", flush=True)
    return saved


# ------------------------------------------------------------------- CLI ----
def _main():
    ap = argparse.ArgumentParser(description="Generate a b-roll image with Qwen-Image.")
    ap.add_argument("prompt", help="full prompt")
    ap.add_argument("-o", "--out", default="qwen_broll.png")
    ap.add_argument("--aspect", choices=list(ASPECTS), default="9:16")
    ap.add_argument("--style", action="store_true", help="prepend the BROLL_BASE house style")
    ap.add_argument("--env", help="path to a .env with the Qwen creds")
    a = ap.parse_args()
    prompt = (BROLL_BASE + a.prompt) if a.style else a.prompt
    out = generate(prompt, a.out, aspect=a.aspect, env_path=a.env)
    print("saved:", out) if out else sys.exit("generation failed")


if __name__ == "__main__":
    _main()
