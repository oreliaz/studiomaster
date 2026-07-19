# StudioMaster — מפת דרכים (Roadmap)

הסקופ נקבע: **MVP = אשף פתיחה + הקלטה מרובת-ערוצים**, ואז ענן, ואז סוכני AI.
כל שלב מסתיים ב-build שמיש שאפשר להריץ באולפן אמיתי.

---

## Phase 0 — יסודות (שבוע 1)

**מטרה:** שלד מריץ, מחובר ל-OBS.

- [ ] Monorepo: Electron + React + TypeScript + Vite + Tailwind.
- [ ] `packages/obs-controller`: עטיפה ל-`obs-websocket-js` (connect, reconnect, typed requests/events).
- [ ] `packages/shared`: טיפוסים משותפים (StudioProfile, Session, MediaAsset...).
- [ ] SQLite (better-sqlite3) + מיגרציות; שכבת repository.
- [ ] Dashboard בסיסי: חיבור ל-OBS, סטטוס חיבור, כפתור Start/Stop Record דרך websocket.
- [ ] בדיקת e2e ידנית מול OBS מקומי.

**Deliverable:** אפליקציה שמתחברת ל-OBS ומתחילה/עוצרת הקלטה.

---

## Phase 1 — אשף פתיחת אולפן (שבועות 2–3) — *דרישה 1*

- [x] מודל `StudioProfile` + עורך פרופילים ב-UI (בחירת תוכנות, סדר פתיחה, checklist, תאורה).
- [x] Studio Launcher: הפעלת תוכנות (`spawn`) + `waitFor` (`spawn`/`websocket`/`delay`/`port`/`window`),
      עצירה על כשל תוכנה חיונית. side effects מבודדים → נבדק ביחידה (6 בדיקות עוברות).
- [x] Lighting Adapters: interface `LightingAdapter` + מימוש **FreeStyler** (HTTP ל-webserver
      פורט 3332). אדפטרים נוספים מאחורי אותו interface. *(פורמט button/cue מדויק — לאימות בשטח.)*
- [x] Onboarding orchestrator: `idle→launching→lighting→checklist→ready` (עם `failed`), state מוזרם ל-UI.
- [x] UI אשף מודרך: בחירת אולפן → רצף פתיחה עם סטטוס לכל שלב → checklist → "מוכן".

**Deliverable:** ✅ לחיצה אחת מעלה את האולפן (תוכנות לפי סדר + תאורת standby) ומדריכה עד "מוכן להקלטה".

> **פערים ל-Phase 2:** שילוב `CONNECTING_OBS` ו-`AUDIO_CHECK` לתוך הרצף (תלוי בבקרת ההקלטה),
> וזיהוי חלון אמין יותר (כרגע `window:` הוא התאמת שם-תהליך best-effort דרך tasklist).

---

## Phase 2 — הקלטה מרובת-ערוצים (שבועות 4–5) — *דרישה 2*

- [ ] אימות/הגדרת multi-track audio ב-OBS דרך websocket.
- [ ] Mixer View: LED meters (InputVolumeMeters), בקרת עוצמה/mute per source.
- [ ] ערוצי וידאו נפרדים: אינטגרציה עם Source Record filter (או POC של plugin נקודתי).
- [ ] Timeline recorder: תיעוד סצנות/דוברים/markers/מצלמות ל-SQLite במהלך ההקלטה.
- [ ] ניהול קבצי פלט: מבנה תיקיות עקבי per-session.
- [ ] **PTZ Camera Control**: `PtzController` + `ViscaIpBackend` (UDP :52381) ל-Minrray/OBSBOT;
      לוח PTZ ב-UI (joystick pan/tilt, zoom, presets, בורר מצלמה). גשר `obs-ptz` כחלופה.
- [ ] **Review Markers (Hotkey)**: `globalShortcut` לפי קטגוריה → מסמך טיימקודים
      (`review.md`/`csv`) + `ReviewMarker` ב-SQLite, עם טיימקוד מ-`GetRecordStatus`;
      חיווי ויזואלי ב-OBS (`SetSceneItemEnabled` overlay) בכל לחיצה.

**Deliverable:** הקלטה שמפיקה קבצי שמע נפרדים + קובץ-לכל-מצלמה + תמהיל + timeline,
עם שליטת PTZ מלאה מהממשק.

---

## Phase 3 — ענן וזיהוי (שבועות 6–7) — *דרישה 3*

- [ ] Google OAuth2 (loopback) + אחסון token מוצפן (keytar/DPAPI).
- [ ] Calendar: שליפת אירועי היום + התאמה ל-session (זיהוי תוכן/אורחים).
- [ ] Drive: העלאת תוצרים (resumable) למבנה תיקיות לפי תאריך/פגישה, עם progress + retry.
- [ ] Session Recognizer: מיזוג יומן+diarization+metadata לפרופיל תוכן.

**Deliverable:** בסיום הקלטה, הכל עולה ל-Drive ומזוהה מול אירוע היומן.

---

## Phase 4 — סוכני עריכה אוטונומיים (שבועות 8–11) — *דרישה 4*

- [ ] `services/ai-workers` (Python): תור job עמיד + runner.
- [ ] Transcribe: faster-whisper + diarization.
- [ ] Analyze: שתיקות, highlights, chapters.
- [ ] Plan: Claude → EDL מובנה מתוך "Deliverable Template" + **מסמך התיקונים** (ReviewMarkers)
      כקלט ישיר לחיתוכים/highlights/גבולות פרקים.
- [ ] Render: ffmpeg מבצע EDL (חיתוך, מיזוג שמע, כתוביות, 9:16).
- [ ] QA gate + אישור אנושי לפני פרסום.
- [ ] Deliver: העלאה ל-Drive; אופציונלית תזמון סושיאל (MCP OneUp/Nuelink).

**Deliverable:** מהקלטה גולמית → חבילת תוצרים ערוכה, אוטונומית.

---

## Phase 5 — הקשחה (שבוע 12+)

- [ ] טיפול בשגיאות מקיף, לוגים, טלמטריה מקומית.
- [ ] אינסטולר Windows (electron-builder) + auto-update.
- [ ] תיעוד משתמש + מדריך הקמת אולפן.
- [ ] בדיקות אוטומטיות (unit + e2e מול OBS headless).

---

## עקרונות חוצי-שלבים

- כל שלב = build שמיש באולפן אמיתי (אין "שלב תשתית" בלי ערך גלוי).
- כל job/פעולה חיצונית: idempotent + retry/backoff.
- פרסום חיצוני תמיד מאחורי אישור בברירת מחדל.
- לא נוגעים בקוד ליבת OBS; הרחבות רק דרך Vendor API/פלאגין נקודתי.
