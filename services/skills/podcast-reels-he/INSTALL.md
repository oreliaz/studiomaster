# Install

## One command
From inside this folder (ideally already at `%USERPROFILE%\.claude\skills\podcast-reels-he`):
```
powershell -ExecutionPolicy Bypass -File .\install.ps1
```
It: seeds `.env` from `.env.example`, `pip install faster-whisper`, ensures ffmpeg (winget),
installs the premium Node engine (`npm install` in `premium-engine/` → puppeteer + a matching
Chrome), and runs `scripts\setup_check.py`. Re-runnable. Flags: `-SkipPython`, `-SkipFfmpeg`,
`-SkipPremium`.

## What each style needs
- **פשוט (simple)** — ffmpeg + `faster-whisper` only. Nothing else.
- **פרימיום (premium)** — also Node.js + `premium-engine/node_modules` (puppeteer + Chrome).
  The overlay engine itself is vendored in `engine/`.
- **Qwen b-roll (premium cutaways)** — `QWEN_API_KEY` + `QWEN_DASHSCOPE_BASE` in `.env`
  (a DEFAULT-workspace key). Optional; premium works without b-roll.

## Manual fallback
```
pip install faster-whisper
winget install Gyan.FFmpeg
winget install OpenJS.NodeJS.LTS          # then open a NEW terminal
cd premium-engine && npm install          # pulls puppeteer + Chrome
npx puppeteer browsers install chrome      # if setup_check says Chrome is missing
copy .env.example .env                     # then edit in the Qwen creds
python scripts\setup_check.py
```

## Notes
- The ivrit.ai Whisper model downloads on first transcription (~1.6 GB, once).
- If `render_overlay_he.js` can't find puppeteer/Chrome, set `PUPPETEER_EXECUTABLE_PATH`
  or re-run the `npm install` step; it also falls back to a system Chrome.
- Central render queue is optional: renders serialize through it if present, run directly
  if not. Point at a custom queue with `RENDER_QUEUE_DIR`.
- On some CPUs faster-whisper crashes in MKL; set `CT2_FORCE_CPU_ISA=GENERIC`.
