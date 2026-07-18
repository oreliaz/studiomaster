# StudioMaster

מערכת אוטונומית לניהול אולפן הקלטה, בנויה כשכבת שליטה (Companion App) מעל
[OBS Studio](https://github.com/obsproject/obs-studio). פלטפורמת יעד: **Windows**.

StudioMaster מנהלת את מחזור החיים המלא של הקלטת אולפן:

1. **פתיחת אולפן** — לחיצה אחת מעלה את התוכנות והתאורה, ואשף מודריך עד "מוכן להקלטה".
2. **הקלטה מרובת-ערוצים** — ניתוב לפי עוצמות מיקרופון, ערוצי שמע ווידאו נפרדים.
3. **ענן וזיהוי** — העלאה אוטומטית ל-Google Drive והתאמה ל-Google Calendar.
4. **עריכה אוטונומית** — סוכני AI מפיקים את "החומרים המוסכמים" מהחומר הגולמי.

## סטטוס

שלב תכנון. הארכיטקטורה והתכנית המלאה:

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — ארכיטקטורה מלאה ועיצוב מודולים.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — מפת דרכים בשלבים.
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — החלטות ארכיטקטוניות והחלטות פתוחות.

## עקרון מרכזי

לא נוגעים בקוד הליבה של OBS. שולטים דרך `obs-websocket` 5.x (מובנה ב-OBS 28+, פורט
4455). כך שורדים כל עדכון של OBS ונשארים תחזוקתיים.

## מבנה המונוריפו (מתוכנן)

```
apps/desktop/          Electron + React + TypeScript — ה-UI וה-orchestrator
packages/obs-controller/  עטיפה ל-obs-websocket-js
packages/ptz-control/  שליטת מצלמות PTZ (VISCA-over-IP) — Minrray / OBSBOT
packages/shared/       טיפוסים ולוגיקה משותפים
services/ai-workers/   Python — סוכני עריכה (ffmpeg, whisper, Claude)
docs/                  ארכיטקטורה, roadmap, החלטות
```
