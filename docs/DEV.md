# StudioMaster — מדריך פיתוח והרצה

## דרישות

- **Node.js 20+** ו-**npm**.
- **OBS Studio 28+** עם obs-websocket מופעל (Tools → WebSocket Server Settings, פורט 4455).
- ל-Phase 4 (עריכת AI): **Python 3.11+**, ו-**ffmpeg/ffprobe** ב-PATH לרינדור.

## התקנה

```bash
npm install
```

> אם הורדת ה-binary של Electron נחסמת ברשת: `set ELECTRON_SKIP_BINARY_DOWNLOAD=1` (הרצה ידנית תוריד בהמשך).
> אין תלות native — האחסון הוא קובץ JSON תחת userData, כך ש-`npm install` לא דורש כלי build.

## פיתוח

```bash
npm run dev            # מריץ את אפליקציית הדסקטופ (electron-vite dev)
```

## בדיקות

```bash
npm run typecheck      # בדיקת טיפוסים בכל ה-workspaces
npm test               # בדיקות יחידה של TS (studio-launcher + ptz-control)
npm run test:py        # בדיקות Python (edl + render)
```

## בנייה ואריזה (Windows)

```bash
npm run build          # bundling של כל ה-workspaces
npm run dist:win       # מייצר installer (NSIS) ל-Windows עם electron-builder
```

האריזה כוללת את `services/ai-workers` כ-`extraResources` (תחת `resources/ai-workers`),
כך שסוכני העריכה זמינים גם באפליקציה הארוזה (נדרש Python + ffmpeg במחשב היעד).

## Google (Phase 3)

צור OAuth client מסוג "Desktop app" ב-Google Cloud Console, והזן Client ID/Secret בלשונית
"ענן". ה-refresh token נשמר מוצפן ב-`safeStorage` (DPAPI ב-Windows). Scopes: `drive.file`,
`calendar.readonly`, `userinfo.email`.

## AI (Phase 4)

```bash
pip install -r services/ai-workers/requirements.txt   # whisper + anthropic (אופציונליים)
export ANTHROPIC_API_KEY=...                           # לתכנון EDL + בחירת קליפים חכמה לרילסים
```

עם `ANTHROPIC_API_KEY` מוגדר, בחירת הקליפים לרילס נעשית ע"י Claude שקורא את התמלול המתוזמן
ובוחר קליפים שמתחילים בהוק, עצמאיים, וממוקמים על גבולות משפטים. בלי המפתח — נפילה אוטומטית
לבחירה לפי סמני ההדגשה + פיזור אחיד (ראה `ai_workers/reels_select.py`).

## מבנה

ראה `README.md` ו-`docs/ARCHITECTURE.md`.
