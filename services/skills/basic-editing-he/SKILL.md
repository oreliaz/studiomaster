---
name: basic-editing-he
description: >
  Turn ONE full raw Hebrew podcast capture into a finished, delivery-ready episode in a
  single full render, with exactly ONE human review round. Phase 1 (autonomous):
  transcribes the episode locally with the best Hebrew Whisper (ivrit.ai), then builds an
  Edit Decision List — head trim (prep before the episode starts), tail trim, internal
  mistakes/retakes/dead-air detected from the transcript+audio AND merged with the editor's
  pre-marked timecodes — and renders only ~1-minute preview clips around each cut plus a
  review sheet. The editor confirms/nudges/rejects cuts in one pass. Phase 2 (autonomous):
  applies the finalized cuts, runs the sound chain (noise reduction + dialogue leveling to
  even out speaker volume + loudness normalization + true-peak limiting), splices the fixed
  intro/outro, and produces the final MP4 in one render. Use when the user points at a
  folder with a raw episode ("capture ... .mp4") and asks for "עריכה בסיסית", basic editing,
  a finished full episode, "לערוך פרק שלם", cut the mistakes + add intro/outro, or similar.
  Hebrew/RTL. Replaces the manual Premiere basic-edit.
---

# basic-editing-he — full Hebrew episode → finished cut in one render

The studio's recurring **"עריכה בסיסית"** job, automated: sound cleanup + technical cuts
(head/tail + mistakes) + fixed intro/outro, delivered as one rendered MP4 with a single
human review round. Everything heavy (transcription, cut detection, previews, render) runs
in **scripts** — the model's only real job is reading the transcript once to sharpen the
mistake list before the human sees it.

`<SKILL>` = this folder. `<WORK>` = the episode folder the user points at (holds the raw
`capture ... .mp4`, optional `cuts.txt`, and `config.json`). Scripts write into `<WORK>/work/`.

## Episode folder contract

```
<WORK>/
  capture ... .mp4        the raw episode (גלם) — biggest video file, auto-detected
  config.json             intro/outro paths + loudness/sound knobs (see config.example.json)
  cuts.txt                OPTIONAL editor-marked removals, one per line:
                            1:23-1:47   שיחת חוץ
                            12:30 12:38 טעות
  work/                   (created by the scripts)
    raw_audio_16k.wav     16k mono extract (transcription + silence detection)
    transcript.txt/.json  ivrit.ai transcript, segment timecodes
    edit_plan.json        the EDL: kept segments + removals (with reasons)
    review.md             human review sheet (table of every proposed cut)
    review/               preview_NN.mp4 (the seam) + removed_NN.mp4 (what's deleted)
    body.mp4 / body_final.mp4 / final.mp4
```

The **intro/outro are fixed** (same every episode) — set their paths once in
`config.json` (or drop `intro.mp4` / `outro.mp4` in `<WORK>`); they are reused for every run.

## Setup

Reuses the local Hebrew Whisper from the reels skills (`ivrit-ai/whisper-large-v3-turbo-ct2`,
faster-whisper, CPU int8). ffmpeg/ffprobe on PATH. No cloud, no keys.

---

# PHASE 1 — transcribe → propose cuts → previews  (autonomous)

**1. Extract audio (fast).**
`ffmpeg -y -vn -i "<WORK>\capture ... .mp4" -ac 1 -ar 16000 -c:a pcm_s16le "<WORK>\work\raw_audio_16k.wav"`

**2. Transcribe the full episode (background — the long pole).**
`set CT2_FORCE_CPU_ISA=GENERIC` then
`python <SKILL>\scripts\transcribe_full.py "<WORK>\work\raw_audio_16k.wav" "<WORK>\work\transcript.txt"`
Writes `transcript.txt` + `.json`. Run in the BACKGROUND. Uses all cores by default
(`CPU_THREADS` to override); `BEAM=1` roughly halves time at a small accuracy cost.
~60–90 min for a 65-min episode on an 8-core CPU box.

**3. Build the Edit Decision List.**
`python <SKILL>\scripts\plan_edits.py "<WORK>\work"`
Detects head/tail trim + dead air + retakes + Hebrew cue words, MERGES `cuts.txt`, snaps every
boundary to the nearest silence, writes `edit_plan.json` + `review.md`.

**3b. (Model pass — the only reasoning step.)** Read `transcript.txt` once. Sanity-check the
auto-detected removals in `edit_plan.json`: drop false positives (a real repeated phrase that's
intentional), add obvious mistakes the heuristics missed (long tangents flagged by the editor,
"בוא נעשה שוב" phrased differently). Edit `edit_plan.json` `removals` directly and re-run the
kept-segment recompute if needed, or add them to `cuts.txt` and re-run step 3.

**4. Render the review clips + page.**
`python <SKILL>\scripts\render_previews.py "<WORK>\work"` then
`python <SKILL>\scripts\build_review_html.py "<WORK>\work"`
For each cut: `preview_NN.mp4` = how the seam will sound (context before + after joined),
`removed_NN.mp4` = what's being deleted. `review/index.html` is a self-contained RTL page
with inline players + a keep/nudge/drop checkbox per cut.

**5. Hand to the editor (single review round).** Give them `review/index.html` (+ `review.md`)
— locally or upload the `review/` folder to Drive. They reply per cut: **keep / nudge to m:ss /
drop**, and confirm head & tail. To finalize: write the agreed cuts to `cuts.txt`, set
`"auto_detect": false` in `config.json`, and re-run step 3 — the plan then uses ONLY the
approved cuts. (Re-run step 4 to refresh previews for any changed seam.)

---

# PHASE 2 — one full render  (autonomous)

**6. Render the finished episode.**
`python <SKILL>\scripts\render_final.py "<WORK>\work"` — run in the BACKGROUND (long).
Resumable: reuses an existing complete `body.mp4`, so a re-run only redoes the fast
normalize/assemble. The loudnorm/limiter pass runs in stream-copy **chunks** then concat
(constant-gain loudnorm → seamless), which also avoids one multi-GB pass that constrained
environments may kill partway.
Cuts+concats the kept segments (body video encoded once), applies the sound chain
(highpass → denoise → gentle dialogue leveling so both speakers sit at the same volume →
loudnorm to target LUFS → true-peak limiter), then joins **intro + body + outro**.
Prints final duration + loudness. Output: `<WORK>\work\final.mp4`.

**Intro transition.** If the intro asset ends with a black section (a "black cut" — e.g. the
KUBIZ intro is 54s = logo+music then ~8s black with the music still playing), the episode
starts AT that cut with a **FADE dissolve** from the logo into the episode, and the intro
**music keeps playing under** the opening and fades out — instead of a hard cut that would
leave dead black. Auto-detected (`blackdetect`); the episode video is reused via stream-copy
(no re-render). `intro_dissolve:false` for a plain hard cut; `dissolve_dur` sets the fade.

Deliver `final.mp4`.

---

## Sound notes (from the reference edit)

The raw capture is a **single mixed track** (both speakers blended — no per-mic ISO), so
"leveling between speakers" is done with time-based dialogue leveling (`dynaudnorm`), not true
per-speaker normalization. The studio's manual reference edit was a flat **+17 dB gain to
~−18 LUFS** with the true peak left slightly over 0 dBTP (a small clip). This pipeline targets
**−16 LUFS / −1.5 dBTP** by default (cleaner, no clipping); set `target_lufs: -18` in
`config.json` to match the house reference exactly. Keep `dialogue_level: "gentle"` to preserve
the natural dynamics of their style (their edit did not compress range).

## Why this is one render + one review

Steps 1,2,4,6 are plain script calls. Step 3 is deterministic detection. Only **3b** needs the
model, reading the transcript once. The human only ever looks at ~1-minute seam clips, never the
whole episode — then Phase 2 renders once, start to finish.
