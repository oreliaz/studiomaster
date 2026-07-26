---
name: podcast-reels-he
description: >-
  Turn ONE full Hebrew podcast MP4 (plus any client documents in the same folder)
  into 15 vertical 9:16 reels with strong hooks, transcribed and captioned LOCALLY
  in Hebrew. Two-phase, human-in-the-loop: phase 1 transcribes with the best Hebrew
  Whisper (ivrit.ai), proposes + cuts 15 hook-first clips (40–70s), renders captioned
  previews, and uploads them to Google Drive WITH an editable subtitle text file;
  the user then returns which reels to keep/drop and picks an edit style PER reel —
  "פרימיום" (the Chris/hyperframes look, RTL, optional Qwen b-roll cutaways) or
  "פשוט" (popping Aduma-Bold captions, white with black outline) — and phase 2 applies
  subtitle fixes, renders the chosen styles, and re-uploads. Use when the user points at
  a folder with a full Hebrew podcast episode and asks for reels/clips/shorts, says
  "תפיק רילסים מהפודקאסט", "podcast-reels-he", "15 קטעים עם הוקים", or similar. Hebrew/RTL.
---

# podcast-reels-he — Hebrew podcast → 15 hook reels (local transcription, 2 styles)

A full Hebrew podcast goes in; 15 captioned vertical reels come out on Google Drive, in
the style the user picks per reel. Everything heavy (transcription, cutting, b-roll,
rendering) runs in **scripts** — the model's only real job is picking the 15 clips and
talking to the user. See **Token-lean mode** at the bottom.

Scripts live in `scripts/`, referenced by absolute path
`<SKILL>\scripts\<name>` where `<SKILL>` is this folder.

## Inputs / outputs
- **Input**: a folder with the full episode (`.mp4/.mov/…` or audio) and, optionally,
  client docs (`.txt/.md/.pdf/.docx`) + a logo. That folder is the **work dir**; all
  artifacts land inside it.
- **Output**: `out_preview/` (phase-1 previews), `out_final/` (phase-2 finals),
  `subs_review.txt` (editable captions), uploaded to one Drive folder.

## The caption rule (BOTH styles — non-negotiable, enforced by `build_captions.py`)
≤4 words/caption; a new caption starts at every new sentence (never mix two sentences);
if one more word lets the whole sentence fit in one caption, do it (≤5-word sentence → one
5-word caption); no lonely 1-word tail. One line, no wrapping.

## The two styles
- **פרימיום** → `render_premium.py`: full-frame presenter, HIGH face-safe hook that stays
  the whole clip, navy 2–4-word caption chips with **amber number highlights**, optional
  stat/headline cards + full-screen **Qwen b-roll cutaways**, ducked music. RTL.
- **פשוט** → `render_simple.py`: popping **Aduma Bold** captions, white + black outline,
  optional top hook. Fast (pure ffmpeg/ASS).

Both: 1080×1920, presenter scaled-to-cover + centre-cropped, RTL end-to-end.

---

# Setup (once)
Run `install.ps1` from this folder (installs faster-whisper, ensures ffmpeg, sets up the
premium Node engine, seeds `.env`). `python scripts\setup_check.py` reports what's ready.
First transcription downloads `ivrit-ai/whisper-large-v3-turbo-ct2` (~1.6 GB) once. The
premium engine is **vendored** in `engine/` — no external skill needed. Simple style needs
only ffmpeg + faster-whisper. Qwen b-roll needs creds in `.env` (see `.env.example`).

---

# PHASE 1 — transcribe, propose, cut, caption, preview, upload

**1. Discover inputs.** `python <SKILL>\scripts\discover.py "<WORK>"` — read the JSON;
read any docs (must-include moments, tone, banned topics); note the logo.

**2. Transcribe the full episode (background).**
`python <SKILL>\scripts\transcribe_full.py "<WORK>\<episode>" "<WORK>\transcript.txt"`
CPU-only, RAM-safe chunked — launch with `run_in_background: true` and poll the output
file. Writes `transcript.txt` + `.json`. (Override: `MODEL=ivrit-ai/whisper-large-v3-ct2`
for max accuracy, `MODEL=medium` to go faster.)

**3. Propose 15 hook-first clips (the one model-heavy step).** Read `transcript.txt` once,
pick **15** clips of **40–70s** each. Each needs a sharp hook in the first 1–3s
(contrarian claim / open loop / surprising number / high stakes / "you"-framed problem);
self-contained (setup→payoff, never cut mid-sentence); diverse across the 15; honoring the
docs. If the best line is mid-clip, start a touch earlier. Present for approval:
`| # | hook (כותרת) | תיאור | start | end | משך | משפט פותח |` (default: all 15).

**4. Cut.** Turn each row into `NN:start:end:slug`:
`python <SKILL>\scripts\cut_clips.py "<WORK>\<episode>" "<WORK>\clips" "01:12.3:71.8:slug" ...`

**5. Word-level transcription of the clips (cheap).**
`python <SKILL>\scripts\transcribe_words.py "<WORK>\words" "<WORK>\clips\01_*.mp4" ...`

**6. Build captions + review file.**
`python <SKILL>\scripts\build_captions.py build "<WORK>" "<SKILL>\fixes\fixes_he.json"`
Writes `captions/NN.json` (both renderers) + `subs_review.txt`.

**7. Render captioned PREVIEWS (simple, fast) for all 15.** One per clip, hook = the
table's "כותרת":
`python <SKILL>\scripts\render_simple.py "<WORK>\clips\01_*.mp4" "<WORK>\captions\01.json" "<WORK>\out_preview\01.mp4" --hook "ההוק"`
(Auto-serialized via the render queue. Previews double as the deliverable if a clip ends up "פשוט".)

**8. Upload previews + `subs_review.txt`** to one Drive folder (see **Drive upload**). Tell
the user: watch the 15, say which to keep/drop, pick **פרימיום**/**פשוט** per reel, and fix
any wrong Hebrew straight in `subs_review.txt` (edit only text after the last `|`).

**→ STOP. Wait for the user.**

---

# PHASE 2 — corrections, chosen styles, final upload

**9. Apply subtitle fixes** (if the user edited `subs_review.txt`):
`python <SKILL>\scripts\build_captions.py apply "<WORK>"`

**10. (פרימיום only, optional) Generate Qwen b-roll.** For clips that want cutaways, author
a small `broll_prompts.json` (see the header of `gen_brolls_he.py`) — a few lines per clip:
each b-roll a `prompt` + `at` (start s) + optional `dur`/`tag`/`headline`. Place cutaways
over setup/transition lines, **never over the punchline**. Then:
`python <SKILL>\scripts\gen_brolls_he.py "<WORK>" "<WORK>\broll_prompts.json"`
It renders 9:16 stills to `<WORK>\broll\` and writes a manifest **render_premium picks up
automatically** (no extra flags).

**11. Render each KEPT reel in its chosen style** → `out_final/NN.mp4`:
- **פשוט**: `render_simple.py` (as step 7).
- **פרימיום**:
  `python <SKILL>\scripts\render_premium.py "<WORK>\clips\03_*.mp4" "<WORK>\out_final\03.mp4" --captions "<WORK>\captions\03.json" --hook "ההוק" --watermark "שם הברנד" --premium`
  B-roll from step 10 is auto-applied; number-highlight is automatic. For full control
  (stat/headline cards), author a reels-pro-schema `config.json` and pass `--config`.

**12. Upload `out_final/*.mp4`** to the Drive folder. Further fixes: edit `subs_review.txt`
→ `build_captions.py apply` → re-render only the affected clips → re-upload.

---

# Drive upload (proven — no token blowup)
Never base64 large MP4s through a tool call. Serve locally + inject via Chrome MCP:
1. Create a Drive folder (Drive MCP `create_file`, `application/vnd.google-apps.folder`).
2. `python <SKILL>\scripts\serve_clips.py "<WORK>\out_preview" 8770` (background).
3. In a Chrome tab on the folder URL, eval `scripts\drive_inject.js`, then
   `window.__drive_inject({"01.mp4":"http://127.0.0.1:8770/01.mp4", ...})`.
4. Poll `window.__fetch_status` until all "done", `window.__drive_dedupe()`, then
   **New → Upload files** (the patched input injects the fetched files).
Drive's CSP only allows connect-src to Google + localhost — hence `127.0.0.1`.
(Same flow for `out_final` and `subs_review.txt`.)

# Render queue
Every render script calls `ensure_queued("PODCAST-REELS-HE")` itself, so heavy encodes
serialize through the central queue if present (dashboard http://localhost:8787), and run
directly if absent. Never launch a raw ffmpeg/puppeteer render outside these scripts.

# Token-lean mode
Steps 1,2,4,5,6,7,9,10,11 are plain script calls — no model reasoning. Only **step 3**
(read transcript → pick 15) needs the model, and it reads `transcript.txt` just once. To go
leaner, hand-write the `NN:start:end:slug` specs and jump to `cut_clips.py`. Grow
`fixes/fixes_he.json` with every correction — fewer manual edits next episode.

# Notes
- Fonts: Aduma Bold (`assets/fonts/Aduma-Bold.ttf`, family **"Aduma"**) for simple; premium
  uses the vendored Heebo/Rubik (both carry Hebrew). Swap simple font with `--font`.
- Clip length **40–70s** (the brief wants reels that hold to the end).
- The premium renderer (`render_overlay_he.js`) renders the overlay to a PNG sequence on
  disk + a **two-pass** ffmpeg mux (video-only, then clean audio) — this is the fix for the
  b-roll audio clicks / dropped-word artifacts. Don't "simplify" it back to a single pass.
