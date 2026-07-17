# services/ai-workers

סוכני העריכה האוטונומיים (Python). צורכים job מהתור ומריצים את ה-pipeline:

```
Ingest → Transcribe → Analyze → Plan(EDL) → Render → QA → Deliver
```

## תלויות עיקריות (מתוכננות)
- `ffmpeg` — חיתוך, render, מיזוג ערוצי שמע, 9:16.
- `faster-whisper` — תמלול + timestamps + diarization (מקומי).
- Claude API — הבנת תוכן והפקת Edit Decision List מתוך Deliverable Template.

מיושם ב-Phase 4. ראה [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) §6.4.
