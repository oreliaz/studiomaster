"""Pilot orchestrator (docs §6.4) — drives the vendored editing skills.

    python -m ai_workers.pilot <session_dir> [--dry-run]

Reads `<session_dir>/job.json` (the questionnaire + capture path) and
`markers.json` (review markers), prepares the skill inputs (cuts.txt from the
'fix' markers, config.json from the questionnaire), then runs the selected
skills:

  - editType basic/both  → basic-editing-he: extract audio → transcribe →
    plan_edits (merges cuts.txt) → render_final → final.mp4
  - editType reels/both  → podcast-reels-he: transcribe → propose clips (from
    highlight markers) → cut → captions → render simple previews

Works in Hebrew and English (language flows into config). Every step is
independent and its status reported, so a missing dependency (ffmpeg / the
ivrit.ai Whisper model / node) degrades gracefully instead of crashing.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
from pathlib import Path

from .cuts import markers_to_cuts_txt
from .metadata import fallback_metadata, generate_metadata
from .models import Marker
from .reels_plan import propose_specs, spec_to_arg
from .reels_select import ClipPick, load_transcript, select_clips
from .thumbnail import extract_thumbnails

SKILLS_DIR = Path(__file__).resolve().parents[2] / "skills"
BASIC_SKILL = SKILLS_DIR / "basic-editing-he"
REELS_SKILL = SKILLS_DIR / "podcast-reels-he"


def emit(phase: str, frac: float, detail: str = "") -> None:
    """Stream a progress event the desktop app renders as a live bar.

    The `@@SM@@` sentinel lets the Node side tell progress lines apart from the
    final JSON summary printed on stdout.
    """
    payload = {"phase": phase, "frac": round(max(0.0, min(1.0, frac)), 3), "detail": detail}
    print("@@SM@@" + json.dumps(payload, ensure_ascii=False), flush=True)


def _run(cmd: list[str], cwd: Path | None = None, env: dict | None = None) -> dict:
    """Run a command, capturing status; never raises."""
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(cwd) if cwd else None,
            env={**os.environ, **(env or {})},
            capture_output=True,
            text=True,
        )
        return {
            "cmd": " ".join(cmd[:3]) + (" …" if len(cmd) > 3 else ""),
            "ok": proc.returncode == 0,
            "code": proc.returncode,
            "error": (proc.stderr or "").strip()[-400:] if proc.returncode else None,
        }
    except FileNotFoundError as exc:
        return {"cmd": cmd[0], "ok": False, "code": -1, "error": f"not found: {exc}"}


def _probe_duration_ms(media: Path) -> int:
    if shutil.which("ffprobe") is None:
        return 0
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(media)],
            check=True, capture_output=True, text=True,
        )
        return int(float(out.stdout.strip()) * 1000)
    except Exception:
        return 0


def _write_config(work: Path, job: dict) -> None:
    d = job.get("deliverables", {})
    config = {
        "source": job.get("capturePath", ""),
        "intro": d.get("intro") or None,
        "outro": d.get("outro") or None,
        "target_lufs": d.get("targetLufs", -16.0),
        "language": d.get("language", "he"),
        "auto_detect": True,
        "notes": job.get("notes", ""),
        "podcast_guidelines": job.get("podcastGuidelines", ""),
    }
    (work / "config.json").write_text(json.dumps(config, ensure_ascii=False, indent=2), "utf-8")


def run_basic(work: Path, capture: Path, dry_run: bool, base: float = 0.0, span: float = 1.0) -> dict:
    steps: list[dict] = []
    inner = work / "work"
    inner.mkdir(exist_ok=True)
    audio = inner / "raw_audio_16k.wav"
    transcript = inner / "transcript.txt"
    env = {"CT2_FORCE_CPU_ISA": "GENERIC"}

    if dry_run:
        return {"skill": "basic-editing-he", "dry_run": True, "steps": [], "output": None}

    emit("basic-audio", base + span * 0.05, "מחלץ שמע מהוידאו")
    steps.append(
        _run(["ffmpeg", "-y", "-vn", "-i", str(capture), "-ac", "1", "-ar", "16000",
              "-c:a", "pcm_s16le", str(audio)])
    )
    emit("basic-transcribe", base + span * 0.15, "מתמלל את הפרק (עשוי לקחת מספר דקות)")
    steps.append(
        _run(["python", str(BASIC_SKILL / "scripts" / "transcribe_full.py"),
              str(audio), str(transcript)], env=env)
    )
    emit("basic-plan", base + span * 0.6, "מתכנן חיתוכים לפי הסימונים")
    steps.append(_run(["python", str(BASIC_SKILL / "scripts" / "plan_edits.py"), str(inner)]))
    emit("basic-render", base + span * 0.75, "מרנדר את הפרק הערוך")
    steps.append(_run(["python", str(BASIC_SKILL / "scripts" / "render_final.py"), str(inner)]))

    final = inner / "final.mp4"
    emit("basic-done", base + span, "הפרק המלא מוכן")
    return {
        "skill": "basic-editing-he",
        "steps": steps,
        "output": str(final) if final.exists() else None,
    }


def _hook_for(markers: list[Marker], start_s: float, end_s: float) -> str:
    """Best hook line for a clip window: a highlight marker's note, else any note."""
    fallback = ""
    for m in markers:
        tc = m.tc_ms / 1000.0
        note = (m.note or "").strip()
        if start_s <= tc <= end_s and note:
            if m.category == "highlight":
                return note
            fallback = fallback or note
    return fallback


def _ensure_transcript(work: Path, capture: Path) -> dict | None:
    """Transcribe the full episode once (shared by reels + metadata). Returns the
    step dict if it ran, or None if the transcript already exists."""
    out = work / "transcript.txt"
    if out.exists() and (work / "transcript.json").exists():
        return None
    return _run(
        ["python", str(REELS_SKILL / "scripts" / "transcribe_full.py"), str(capture), str(out)],
        env={"CT2_FORCE_CPU_ISA": "GENERIC"},
    )


def run_metadata(work: Path, capture: Path, job: dict, want_title: bool, want_desc: bool,
                 dry_run: bool, base: float = 0.0, span: float = 1.0) -> dict:
    """Generate the episode title + description from the transcript."""
    if dry_run:
        return {"skill": "metadata", "dry_run": True}
    steps: list[dict] = []
    emit("metadata-transcribe", base + span * 0.1, "מתמלל לכותרת/תיאור")
    tr = _ensure_transcript(work, capture)
    if tr:
        steps.append(tr)
    transcript_text = ""
    tp = work / "transcript.txt"
    if tp.exists():
        transcript_text = tp.read_text("utf-8", errors="ignore")

    emit("metadata-generate", base + span * 0.6, "מייצר כותרת ותיאור")
    d = job.get("deliverables", {})
    guidance = " ".join(x for x in (job.get("notes", ""), job.get("podcastGuidelines", "")) if x)
    meta = generate_metadata(transcript_text, d.get("language", "he"), guidance) or fallback_metadata(
        transcript_text
    )
    if want_title:
        (work / "title.txt").write_text(meta.get("title", ""), "utf-8")
    if want_desc:
        (work / "description.txt").write_text(meta.get("description", ""), "utf-8")
    (work / "metadata.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), "utf-8")
    emit("metadata-done", base + span, "כותרת ותיאור מוכנים")
    return {
        "skill": "metadata",
        "steps": steps,
        "title": meta.get("title") if want_title else None,
        "description": meta.get("description") if want_desc else None,
    }


def run_thumbnail(work: Path, capture: Path, markers: list[Marker], duration_ms: int,
                  dry_run: bool, base: float = 0.0, span: float = 1.0) -> dict:
    """Extract candidate thumbnail frames at highlights / evenly spaced."""
    if dry_run:
        return {"skill": "thumbnail", "dry_run": True}
    emit("thumbnail", base + span * 0.3, "מחלץ תמונות לתמבנייל")
    files = extract_thumbnails(str(capture), markers, duration_ms, work / "thumbnails")
    emit("thumbnail-done", base + span, f"{len(files)} תמונות תמבנייל")
    return {"skill": "thumbnail", "count": len(files), "files": files}


def _plan_clips(
    work: Path, markers: list[Marker], duration_ms: int, count: int, min_s: int, max_s: int,
    deliverables: dict, guidance: str = "",
) -> tuple[list[tuple[int, float, float, str]], dict[int, str], str]:
    """Choose clip windows: model-based from the transcript, else marker-driven.

    Returns (specs, hooks_by_index, selection_mode). The model reads the timed
    transcript for hook-first, self-contained boundaries; on any miss it falls
    back to the deterministic marker+uniform planner so cutting never blocks.
    """
    transcript_json = work / "transcript.json"
    if transcript_json.exists():
        try:
            segments, dur_s = load_transcript(str(transcript_json))
            picks: list[ClipPick] | None = select_clips(
                segments, dur_s or duration_ms / 1000, count, min_s, max_s,
                deliverables.get("language", "he"), guidance,
            )
        except Exception as exc:  # noqa: BLE001
            print(f"[reels] transcript-based selection failed: {exc}", flush=True)
            picks = None
        if picks:
            specs = [(i, p.start_s, p.end_s, p.slug or f"clip{i:02d}")
                     for i, p in enumerate(picks, start=1)]
            hooks = {i: p.hook for i, p in enumerate(picks, start=1)}
            return specs, hooks, "model"

    specs = propose_specs(markers, duration_ms, count, min_s, max_s)
    hooks = {s[0]: _hook_for(markers, s[1], s[2]) for s in specs}
    return specs, hooks, "markers"


def _render_clip(clip: Path, captions: Path, out: Path, hook: str, premium: bool) -> dict:
    """Render one reel with captions + graphics. Premium falls back to simple."""
    if premium:
        args = ["python", str(REELS_SKILL / "scripts" / "render_premium.py"),
                str(clip), str(out), "--captions", str(captions), "--premium"]
        if hook:
            args += ["--hook", hook]
        result = _run(args)
        if result.get("ok"):
            result["style"] = "premium"
            return result
        # Premium needs puppeteer/Chrome; if it fails, still deliver captioned reels.
        fallback = _run(["python", str(REELS_SKILL / "scripts" / "render_simple.py"),
                         str(clip), str(captions), str(out)] + (["--hook", hook] if hook else []))
        fallback["style"] = "simple(fallback)"
        fallback["premium_error"] = result.get("error")
        return fallback
    result = _run(["python", str(REELS_SKILL / "scripts" / "render_simple.py"),
                   str(clip), str(captions), str(out)] + (["--hook", hook] if hook else []))
    result["style"] = "simple"
    return result


def run_reels(work: Path, capture: Path, job: dict, markers: list[Marker], dry_run: bool,
              base: float = 0.0, span: float = 1.0) -> dict:
    d = job.get("deliverables", {})
    count = int(d.get("reelsCount", 15))
    style = d.get("reelStyle", "simple")
    premium = style == "premium"
    min_s = int(d.get("reelMinSec", 40))
    max_s = int(d.get("reelMaxSec", 70))
    duration = _probe_duration_ms(capture) or (max((m.tc_ms for m in markers), default=0) + 60_000)

    if dry_run:
        specs = propose_specs(markers, duration, count, min_s, max_s)
        (work / "reel_specs.txt").write_text(
            "\n".join(spec_to_arg(s) for s in specs) + ("\n" if specs else ""), "utf-8"
        )
        return {"skill": "podcast-reels-he", "dry_run": True, "style": style,
                "planned_clips": len(specs), "selection": "markers", "steps": [], "outputs": []}

    steps: list[dict] = []
    clips_dir = work / "clips"
    words_dir = work / "words"
    captions_dir = work / "captions"
    out_dir = work / "out_final"
    out_dir.mkdir(exist_ok=True)
    whisper_env = {"CT2_FORCE_CPU_ISA": "GENERIC"}

    # 1) full-episode transcript (drives smart clip selection; shared w/ metadata).
    emit("reels-transcribe", base + span * 0.05, "מתמלל את הפרק")
    tr = _ensure_transcript(work, capture)
    if tr:
        steps.append(tr)

    # 2) choose clip windows: model-based from the transcript, else marker-driven.
    #    Human correction notes + the podcast's KB guidelines steer the model.
    guidance = " ".join(x for x in (job.get("notes", ""), job.get("podcastGuidelines", "")) if x)
    emit("reels-select", base + span * 0.32, "בוחר קליפים חכמים לפי התמלול")
    specs, hooks, selection = _plan_clips(work, markers, duration, count, min_s, max_s, d, guidance)
    (work / "reel_specs.txt").write_text(
        "\n".join(spec_to_arg(s) for s in specs) + ("\n" if specs else ""), "utf-8"
    )

    # 3) cut the selected clips.
    emit("reels-cut", base + span * 0.38, f"חותך {len(specs)} קליפים")
    steps.append(
        _run(["python", str(REELS_SKILL / "scripts" / "cut_clips.py"), str(capture),
              str(clips_dir)] + [spec_to_arg(s) for s in specs])
    )

    clip_files = sorted(clips_dir.glob("*.mp4")) if clips_dir.exists() else []

    # 4) word-level transcription of the SHORT clips (input for captions).
    emit("reels-words", base + span * 0.45, "מתמלל מילים לכתוביות")
    if clip_files:
        steps.append(
            _run(["python", str(REELS_SKILL / "scripts" / "transcribe_words.py"),
                  str(words_dir)] + [str(c) for c in clip_files], env=whisper_env)
        )
    # 5) group words into caption files (captions/<NN>.json).
    emit("reels-captions", base + span * 0.55, "בונה כתוביות")
    steps.append(
        _run(["python", str(REELS_SKILL / "scripts" / "build_captions.py"), "build", str(work),
              str(REELS_SKILL / "fixes" / "fixes_he.json")])
    )

    # 6) render each clip WITH captions + graphics, in the chosen style.
    style_label = "כריסלייט" if premium else "פשוט"
    renders: list[dict] = []
    for i, clip in enumerate(clip_files):
        nn = clip.name[:2]
        captions = captions_dir / f"{nn}.json"
        out = out_dir / f"{nn}.mp4"
        hook = hooks.get(int(nn), "") if nn.isdigit() else ""
        frac = base + span * (0.6 + 0.38 * ((i + 1) / max(1, len(clip_files))))
        emit("reels-render", frac, f"מרנדר רילס {i + 1} מתוך {len(clip_files)} ({style_label})")
        if captions.exists():
            renders.append(_render_clip(clip, captions, out, hook, premium))
        else:
            renders.append({"cmd": "render", "ok": False, "error": f"no captions for {nn}"})
    steps.extend(renders)

    outputs = sorted(str(p) for p in out_dir.glob("*.mp4"))

    # Diagnose the common "planned clips but nothing rendered" case so the app
    # can tell the user WHY no teasers came out, instead of failing silently.
    note = ""
    if specs and not outputs:
        transcript_ok = (work / "transcript.txt").exists() and (
            work / "transcript.txt"
        ).stat().st_size > 0
        words_ok = any(words_dir.glob("*_words.json")) if words_dir.exists() else False
        caps_ok = any(captions_dir.glob("*.json")) if captions_dir.exists() else False
        clips_ok = bool(clip_files)
        if not clips_ok:
            note = "החיתוך נכשל — בדוק ש-ffmpeg זמין ושהקובץ תקין"
        elif not transcript_ok or not words_ok:
            note = ("התמלול נכשל — התקן פעם אחת את מנוע התמלול: "
                    "services/skills/podcast-reels-he/install.ps1 (Python + מודל Whisper)")
        elif not caps_ok:
            note = "לא נוצרו כתוביות מהתמלול"
        else:
            note = ("הרינדור נכשל — לסגנון כריסלייט צריך Node + Chrome "
                    "(install.ps1 של הסקיל). נסה סגנון 'פשוט' לבדיקה")

    emit("reels-done", base + span, f"{len(outputs)} רילסים מוכנים")
    return {"skill": "podcast-reels-he", "style": style, "premium": premium,
            "selection": selection, "planned_clips": len(specs), "rendered": len(outputs),
            "note": note, "steps": steps, "outputs": outputs}


def process(session_dir: Path, dry_run: bool) -> dict:
    job = json.loads((session_dir / "job.json").read_text("utf-8")) if (session_dir / "job.json").exists() else {}
    markers = [
        Marker.from_dict(m)
        for m in (json.loads((session_dir / "markers.json").read_text("utf-8"))
                  if (session_dir / "markers.json").exists() else [])
    ]
    deliverables = job.get("deliverables", {})
    edit_type = deliverables.get("editType", "basic")
    req = _resolve_requested(job, deliverables, edit_type)

    # Prepare skill inputs regardless of which skill runs.
    (session_dir / "cuts.txt").write_text(markers_to_cuts_txt(markers), "utf-8")
    _write_config(session_dir, job)

    capture = Path(job.get("capturePath", ""))
    capture_ok = capture.exists()
    duration = _probe_duration_ms(capture) or (max((m.tc_ms for m in markers), default=0) + 60_000)

    result: dict = {
        "session_dir": str(session_dir),
        "edit_type": edit_type,
        "requested": req,
        "language": deliverables.get("language", "he"),
        "capture": str(capture),
        "capture_found": capture_ok,
        "markers": len(markers),
        "fix_markers": sum(1 for m in markers if m.category == "fix"),
        "highlight_markers": sum(1 for m in markers if m.category == "highlight"),
        "dry_run": dry_run,
        "basic": None,
        "reels": None,
        "metadata": None,
        "thumbnail": None,
    }
    if not capture_ok and not dry_run:
        result["error"] = "capture file not found — set capturePath in job.json"
        emit("error", 1.0, "קובץ ההקלטה לא נמצא")
        return result

    emit("start", 0.02, "מכין קלט לעריכה")
    # Allocate the progress bar across the enabled stages, weighted by cost.
    weights = {"basic": 3.0, "reels": 4.0, "metadata": 1.0, "thumbnail": 1.0}
    stages = [
        name
        for name in ("basic", "reels", "metadata", "thumbnail")
        if (name == "metadata" and (req["title"] or req["description"])) or req.get(name)
    ]
    total_w = sum(weights[s] for s in stages) or 1.0
    cursor = 0.02
    for name in stages:
        span = 0.96 * (weights[name] / total_w)
        base = cursor
        cursor += span
        if name == "basic":
            result["basic"] = run_basic(session_dir, capture, dry_run, base, span)
        elif name == "reels":
            result["reels"] = run_reels(session_dir, capture, job, markers, dry_run, base, span)
        elif name == "metadata":
            result["metadata"] = run_metadata(session_dir, capture, job, req["title"],
                                              req["description"], dry_run, base, span)
        elif name == "thumbnail":
            result["thumbnail"] = run_thumbnail(session_dir, capture, markers, duration,
                                               dry_run, base, span)
    emit("done", 1.0, "העריכה הושלמה")
    return result


def _resolve_requested(job: dict, deliverables: dict, edit_type: str) -> dict:
    """Which deliverables to produce: explicit `requested` wins, else derive
    from the editType + metadata flags on the template."""
    r = job.get("requested")
    if isinstance(r, dict):
        return {k: bool(r.get(k, False)) for k in ("basic", "reels", "title", "description", "thumbnail")}
    return {
        "basic": edit_type in ("basic", "both"),
        "reels": edit_type in ("reels", "both"),
        "title": bool(deliverables.get("title")),
        "description": bool(deliverables.get("description")),
        "thumbnail": bool(deliverables.get("thumbnail")),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="StudioMaster pilot editing orchestrator")
    parser.add_argument("session_dir", type=Path)
    parser.add_argument("--dry-run", action="store_true", help="prepare inputs + plan, no heavy render")
    args = parser.parse_args()
    print(json.dumps(process(args.session_dir, args.dry_run), ensure_ascii=False))


if __name__ == "__main__":
    main()
