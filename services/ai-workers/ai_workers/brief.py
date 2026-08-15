"""Edit brief (docs §6.4) — one Markdown handoff document per episode.

It bundles the full timed transcript, the review markers/timecodes, the cuts
that were applied, the editor notes, and the produced outputs. The point is to
hand it to Claude / Claude Code *together with the episode video* so the model
has everything it needs to make further corrections to the cut or to plan more
reels in one session. Pure of network; the pilot writes the file.
"""

from __future__ import annotations

from pathlib import Path

from .models import Marker

CAT = {"fix": "תיקון", "highlight": "הדגשה", "chapter": "פרק", "note": "הערה"}


def _fmt(ms: int) -> str:
    total = max(0, ms) // 1000
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def _read(path: Path) -> str:
    try:
        return path.read_text("utf-8", errors="ignore")
    except Exception:
        return ""


def build_brief(session_dir: Path, job: dict, markers: list[Marker], result: dict) -> str:
    d = job.get("deliverables", {})
    basic = result.get("basic") or {}
    reels = result.get("reels") or {}
    meta = result.get("metadata") or {}
    out: list[str] = []
    add = out.append

    add("# מסמך עריכה לפרק (Edit Brief)")
    add("")
    add("## איך להשתמש (עבור Claude / Claude Code)")
    add("מסמך זה מסכם את הפרק: התמלול המלא, הסימונים והטיימקודים, החיתוכים שבוצעו, וההערות.")
    add("הזן אותו **יחד עם קובץ הווידאו** של הפרק כדי לבקש תיקונים נוספים בעריכה, או חיתוך")
    add("רילסים נוספים. כל הטיימקודים בפורמט H:MM:SS (או M:SS).")
    add("")

    add("## פרטי הפרק")
    add(f"- שפת תוכן: {d.get('language', 'he')}")
    add(f"- קובץ מקור: {job.get('capturePath', '')}")
    if basic.get("output"):
        add(f"- פרק ערוך (עריכה בסיסית): {basic['output']}")
    if reels.get("outputs"):
        add(f"- רילסים שהופקו: {len(reels['outputs'])} (בתיקיית out_final/)")
    if meta.get("title"):
        add(f"- כותרת מוצעת: {meta['title']}")
    if meta.get("description"):
        add(f"- תיאור מוצע: {meta['description']}")
    add("")

    notes = (job.get("notes") or "").strip()
    guide = (job.get("podcastGuidelines") or "").strip()
    if notes or guide:
        add("## הערות עריכה")
        if notes:
            add(f"- הערות לפרק זה: {notes}")
        if guide:
            add(f"- הנחיות הפודקאסט: {guide}")
        add("")

    add("## סימונים (טיימקודים)")
    if markers:
        add("| # | טיימקוד | קטגוריה | הערה |")
        add("|---|---------|----------|------|")
        for i, m in enumerate(sorted(markers, key=lambda x: x.tc_ms), start=1):
            add(f"| {i} | {_fmt(m.tc_ms)} | {CAT.get(m.category, m.category)} | {(m.note or '').strip()} |")
    else:
        add("(אין סימונים בפרק זה)")
    add("")

    cuts = _read(session_dir / "cuts.txt").strip()
    add("## חיתוכים שבוצעו (עריכה בסיסית)")
    add("שורות בפורמט `START-END סיבה` — הקטעים שסומנו לתיקון/הסרה:")
    add("```")
    add(cuts or "(לא בוצעו חיתוכים)")
    add("```")
    add("")

    transcript = _read(session_dir / "transcript.txt") or _read(session_dir / "work" / "transcript.txt")
    add("## תמלול מלא (עם טיימקודים)")
    add("```")
    add(transcript.strip() or "(תמלול לא זמין — ודא שמנוע התמלול מותקן)")
    add("```")
    return "\n".join(out) + "\n"
