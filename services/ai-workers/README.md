# services/ai-workers

סוכני העריכה האוטונומיים (Python). צורכים תיקיית session ומריצים את ה-pipeline:

```
ingest → transcribe → analyze → plan (EDL) → render → deliver
```

## הרצה
```bash
python -m ai_workers.worker <session_dir> [--dry-run] [--highlights N]
```
ה-worker קורא `markers.json` + מדיה מהתיקייה, וכותב תוצרים ל-`<session_dir>/edited/`:
`edl.json`, `transcript.txt`, `chapters.txt`, `full_edit.mp4`, `highlight_N.mp4`, `short_N.mp4`.

האפליקציה מריצה אותו אוטומטית מלשונית "ענן" (כפתור **ערוך אוטומטית**), לאחר שהיא
מייצאת את `markers.json` ו-`session.json` לתיקיית ה-session.

## עמידות (graceful degradation)
- **בלי `faster-whisper`** → מדלג על תמלול (עריכה לפי סמנים בלבד).
- **בלי `ANTHROPIC_API_KEY`/`anthropic`** → EDL דטרמיניסטי מהסמנים (`edl.build_edl`).
- **בלי `ffmpeg`** → כותב `edl.json` בלבד (ללא render).

## ליבה טהורה ונבדקת
`edl.py` (מתמטיקת חיתוכים/highlights/פרקים) ו-`render.py` (בניית פקודות ffmpeg) הם
פונקציות טהורות עם בדיקות יחידה:
```bash
python -m unittest discover -s tests
```

## תלויות
`requirements.txt` (whisper, anthropic — אופציונליים) + `ffmpeg`/`ffprobe` במערכת.
