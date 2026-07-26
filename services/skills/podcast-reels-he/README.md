# podcast-reels-he

Self-contained Claude Code **skill**: one full Hebrew podcast MP4 → 15 vertical 9:16 reels
with hooks, transcribed and captioned **locally** in Hebrew, in two user-picked styles
(**פרימיום** — hyperframes look with optional Qwen b-roll cutaways; **פשוט** — popping
Aduma-Bold captions). Two-phase, human-in-the-loop.

## Transfer to another machine / Claude Code
1. Copy this whole folder to `%USERPROFILE%\.claude\skills\podcast-reels-he`.
2. `powershell -ExecutionPolicy Bypass -File .\install.ps1`
3. (Optional, for premium b-roll) copy `.env.example` → `.env` and fill the Qwen creds.
4. Point Claude Code at a folder with a Hebrew podcast and ask for reels.

The premium engine is **vendored** in `engine/` — no sibling skill required. What is NOT
shipped (installed by `install.ps1`): the `faster-whisper` pip package, ffmpeg, the
ivrit.ai model (auto-downloads on first run, ~1.6 GB), and `premium-engine/node_modules`
(puppeteer + Chrome, ~150 MB).

## Layout
```
SKILL.md              the workflow (this is what the model reads)
scripts/              all pipeline steps (transcribe, cut, caption, b-roll, render, upload)
engine/               vendored premium overlay engine (build_reel.py + assets)
premium-engine/       package.json for puppeteer (node_modules installed by install.ps1)
assets/fonts/         Aduma-Bold + Assistant (simple style)
fixes/fixes_he.json   accumulated Hebrew transcription corrections
.env.example          Qwen-Image creds template (premium b-roll only)
install.ps1           one-shot setup
```

See `SKILL.md` for the full pipeline and `INSTALL.md` for setup detail.
