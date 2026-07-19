# StudioMaster — מפת דרכים (Roadmap)

הסקופ נקבע: **MVP = אשף פתיחה + הקלטה מרובת-ערוצים**, ואז ענן, ואז סוכני AI.
כל שלב מסתיים ב-build שמיש שאפשר להריץ באולפן אמיתי.

---

## Phase 0 — יסודות (שבוע 1)

**מטרה:** שלד מריץ, מחובר ל-OBS.

- [x] Monorepo: Electron + React + TypeScript + Vite (npm workspaces).
- [x] `packages/obs-controller`: עטיפה ל-`obs-websocket-js` (connect, reconnect, typed requests/events).
- [x] `packages/shared`: טיפוסים משותפים + סכמות zod (StudioProfile, Session, MediaAsset...).
- [x] SQLite (better-sqlite3) + מיגרציות; שכבת store (עם fallback לזיכרון).
- [x] Dashboard בסיסי: חיבור ל-OBS, סטטוס חיבור, כפתור Start/Stop Record + טיימקוד חי.

**Deliverable:** ✅ אפליקציה שמתחברת ל-OBS ומתחילה/עוצרת הקלטה.

---

## Phase 1 — אשף פתיחת אולפן (שבועות 2–3) — _דרישה 1_

- [x] מודל `StudioProfile` + עורך פרופילים ב-UI (בחירת תוכנות, סדר פתיחה, checklist, תאורה).
- [x] Studio Launcher: הפעלת תוכנות (`spawn`) + `waitFor` (`spawn`/`websocket`/`delay`/`port`/`window`),
      עצירה על כשל תוכנה חיונית. side effects מבודדים → נבדק ביחידה (6 בדיקות עוברות).
- [x] Lighting Adapters: interface `LightingAdapter` + מימוש **FreeStyler** (HTTP ל-webserver
      פורט 3332). אדפטרים נוספים מאחורי אותו interface. _(פורמט button/cue מדויק — לאימות בשטח.)_
- [x] Onboarding orchestrator: `idle→launching→lighting→checklist→ready` (עם `failed`), state מוזרם ל-UI.
- [x] UI אשף מודרך: בחירת אולפן → רצף פתיחה עם סטטוס לכל שלב → checklist → "מוכן".

**Deliverable:** ✅ לחיצה אחת מעלה את האולפן (תוכנות לפי סדר + תאורת standby) ומדריכה עד "מוכן להקלטה".

> **פערים ל-Phase 2:** שילוב `CONNECTING_OBS` ו-`AUDIO_CHECK` לתוך הרצף (תלוי בבקרת ההקלטה),
> וזיהוי חלון אמין יותר (כרגע `window:` הוא התאמת שם-תהליך best-effort דרך tasklist).

---

## Phase 2 — הקלטה מרובת-ערוצים (שבועות 4–5) — _דרישה 2_

- [x] Mixer View: LED meters (InputVolumeMeters), בקרת עוצמה/mute per source, בורר סצנה.
- [x] **PTZ Camera Control**: `ViscaIpController` (UDP :52381) ל-Minrray/OBSBOT + בוני VISCA
      נבדקים ביחידה; לוח PTZ ב-UI (D-pad pan/tilt, zoom, 6 presets, בורר מצלמה).
- [x] **Review Markers (Hotkey)**: `globalShortcut` (Ctrl+Shift+1–4) לפי קטגוריה → מסמך
      `review.md` + `ReviewMarker` ב-SQLite, טיימקוד מ-`GetRecordStatus`; חיווי ויזואלי
      ב-OBS דרך `flashSceneItem` (`SetSceneItemEnabled` על מקור "StudioMaster Marker").
- [x] RecordingSession: נפתח אוטומטית עם תחילת ההקלטה, תיקיית per-session, cue תאורת record.
- [ ] multi-track audio: אימות מיפוי tracks דרך websocket (הגדרה ידנית ב-OBS כרגע).
- [ ] ערוצי וידאו נפרדים: אינטגרציה עם Source Record filter (או POC של plugin נקודתי).

**Deliverable:** ✅ מיקסר + שליטת PTZ מלאה + hotkey תיקונים עם חיווי ב-OBS, מהממשק.
_(נותר להעמיק: מיפוי multi-track אוטומטי וקובץ-לכל-מצלמה — תלוי הגדרות OBS/פילטר.)_

---

## Phase 3 — ענן וזיהוי (שבועות 6–7) — _דרישה 3_

- [x] Google OAuth2 (loopback) + אחסון token מוצפן ב-`safeStorage` (DPAPI ב-Windows).
- [x] Calendar: שליפת אירועי היום + התאמה אוטומטית ל-session בסיום הקלטה (title/אורחים).
- [x] Drive: `ensureFolder` (StudioMaster/<session>) + העלאת כל קבצי ה-session עם progress.
- [x] Session Recognizer: מיזוג אירוע יומן חופף → SessionSummary (title, calendarEventId, guests).
- [x] Cloud view: חיבור/ניתוק Google, אירועי היום, רשימת הקלטות + זיהוי + העלאה.

**Deliverable:** ✅ חיבור Google (OAuth loopback), זיהוי אוטומטי מול היומן בסיום הקלטה,
והעלאת ה-session ל-Drive מהממשק. _(diarization מלא — ב-Phase 4; retry/backoff — להעמקה.)_

---

## Phase 4 — סוכני עריכה אוטונומיים (שבועות 8–11) — _דרישה 4_

- [x] `services/ai-workers` (Python): pipeline runner + CLI, עמיד לחוסר תלויות.
- [x] Transcribe: עטיפת faster-whisper (guarded — מדלג אם לא מותקן).
- [x] Analyze: silences + speaking-ratio מהתמלול (פונקציות טהורות).
- [x] Plan: `edl.build_edl` דטרמיניסטי מ-**מסמך התיקונים** (ReviewMarkers) + `plan_edl` עם
      Claude (chapter titles + חיתוכי filler) ו-fallback אוטומטי. נבדק ביחידה.
- [x] Render: בוני פקודות ffmpeg טהורים (trim+concat, clip, reframe 9:16) — נבדקים ביחידה.
- [x] Bridge: `ai:process-session` מייצא markers.json + מריץ את ה-worker, מציג סיכום ב-UI.
- [ ] QA gate + אישור אנושי לפני פרסום חיצוני (מבנה קיים; gate ייחשף ב-Phase 5).
- [ ] Deliver לסושיאל (MCP OneUp/Nuelink) — אופציונלי, לאחר אישור.

**Deliverable:** ✅ כפתור "ערוך אוטומטית" → סמנים/תמלול → EDL (Claude/דטרמיניסטי) → תוצרים
(`edl.json` תמיד; קבצי וידאו כשיש ffmpeg). 17 בדיקות Python + 10 בדיקות TS עוברות.

---

## Phase 5 — הקשחה (שבוע 12+)

- [x] אינסטולר Windows: קונפיג `electron-builder.yml` (NSIS) + `npm run dist:win`;
      אריזת `services/ai-workers` כ-extraResources (עם resolve נכון של נתיב ה-worker).
- [x] טיפול בשגיאות: `uncaughtException`/`unhandledRejection` handlers; store נופל
      חלק לזיכרון; כל הנתיבים החיצוניים (OBS/ענן/AI/תאורה) עטופים ב-try/catch.
- [x] תיעוד: `docs/DEV.md` (התקנה, בדיקות, אריזה, Google, AI) + README-ים לכל חבילה.
- [x] בדיקות אוטומטיות: `npm test` (TS) + `npm run test:py` (Python) — 27 בדיקות.
- [ ] auto-update (electron-updater) — לגרסה הבאה.
- [ ] e2e מול OBS headless — לגרסה הבאה.

---

## עקרונות חוצי-שלבים

- כל שלב = build שמיש באולפן אמיתי (אין "שלב תשתית" בלי ערך גלוי).
- כל job/פעולה חיצונית: idempotent + retry/backoff.
- פרסום חיצוני תמיד מאחורי אישור בברירת מחדל.
- לא נוגעים בקוד ליבת OBS; הרחבות רק דרך Vendor API/פלאגין נקודתי.
