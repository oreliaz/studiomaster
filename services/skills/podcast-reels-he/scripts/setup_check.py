"""
Verify this machine can run podcast-reels-he. Reports what's ready and what's missing.

  python setup_check.py

Exit 0 if the SIMPLE-style pipeline (transcribe + cut + simple render) is ready, 1 if a
hard requirement is missing. Premium-style + Qwen b-roll extras are reported as warnings.
"""
import os, shutil, subprocess, sys  # noqa: F401

OK, WARN, BAD = "[ OK ]", "[WARN]", "[FAIL]"
hard_ok = True


def check(label, cond, hint="", hard=True):
    global hard_ok
    tag = OK if cond else (BAD if hard else WARN)
    if not cond and hard:
        hard_ok = False
    print(f"{tag} {label}" + ("" if cond or not hint else f"  -> {hint}"))


SKILL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKILLS_DIR = os.path.dirname(SKILL)

print("== podcast-reels-he setup check ==\n-- hard requirements (simple style) --")
check("ffmpeg on PATH", shutil.which("ffmpeg"), "install ffmpeg + add to PATH")
check("ffprobe on PATH", shutil.which("ffprobe"), "ships with ffmpeg")
check(f"python {sys.version_info.major}.{sys.version_info.minor}", sys.version_info >= (3, 9))
try:
    import faster_whisper  # noqa
    check("faster-whisper importable", True)
except Exception:
    check("faster-whisper importable", False, "pip install faster-whisper")
check("Aduma-Bold.ttf bundled", os.path.exists(os.path.join(SKILL, "assets", "fonts", "Aduma-Bold.ttf")))

print("\n-- premium style extras (optional) --")
# Self-contained vendored engine ships in engine/; sibling reels-pro is only an override.
engine = os.environ.get("REELS_PRO_REELKIT") or os.path.join(SKILL, "engine")
check("premium engine (engine/build_reel.py)", os.path.exists(os.path.join(engine, "build_reel.py")),
      "should ship with the skill; or set REELS_PRO_REELKIT to a reels-pro/reelkit", hard=False)
check("node on PATH", shutil.which("node"), "install Node.js (install.ps1 tries winget)", hard=False)
pup = os.path.join(SKILL, "premium-engine", "node_modules", "puppeteer")
if not os.path.isdir(pup):
    pup = os.path.join(SKILL, "premium-engine", "node_modules", "puppeteer-core")
check("puppeteer installed in premium-engine", os.path.isdir(pup),
      "run install.ps1, or: cd premium-engine && npm install", hard=False)
chrome_cache = os.path.join(os.path.expanduser("~"), ".cache", "puppeteer", "chrome")
has_chrome = False
if os.path.isdir(chrome_cache):
    for d in os.listdir(chrome_cache):
        if os.path.exists(os.path.join(chrome_cache, d, "chrome-win64", "chrome.exe")):
            has_chrome = True; break
for p in (r"C:\Program Files\Google\Chrome\Application\chrome.exe",
          r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"):
    has_chrome = has_chrome or os.path.exists(p)
check("Chrome available for puppeteer", has_chrome,
      "npm install in premium-engine downloads one automatically", hard=False)

print("\n-- Qwen b-roll (optional, premium cutaways) --")
have_key = bool(os.getenv("QWEN_API_KEY")) and bool(os.getenv("QWEN_DASHSCOPE_BASE"))
if not have_key and os.path.exists(os.path.join(SKILL, ".env")):
    txt = open(os.path.join(SKILL, ".env"), encoding="utf-8").read()
    have_key = "QWEN_API_KEY" in txt and "QWEN_DASHSCOPE_BASE" in txt
check("Qwen-Image creds present", have_key,
      "copy .env.example -> .env and fill QWEN_API_KEY + QWEN_DASHSCOPE_BASE", hard=False)

print("\n-- optional: central render queue --")
rq = os.environ.get("RENDER_QUEUE_DIR") or r"C:\Users\OR\Desktop\claude-code\render-queue"
check("render queue present", os.path.isdir(rq),
      "not required — renders run directly if absent", hard=False)

print("\nivrit.ai model downloads automatically on first transcription (~1.6 GB).")
print("RESULT:", "simple-style pipeline READY" if hard_ok else "MISSING hard requirements above")
sys.exit(0 if hard_ok else 1)
