# StudioMaster — ארכיטקטורה ותכנית מקיפה

> מערכת אוטונומית לניהול אולפן הקלטה, בנויה כשכבת שליטה (Companion) מעל OBS Studio.
> פלטפורמת יעד: **Windows**. שליטה ב-OBS: **obs-websocket 5.x** (מובנה ב-OBS 28+).

---

## 1. תמצית מנהלים (Executive Summary)

StudioMaster היא תוכנת שולחן עבודה ל-Windows שמנהלת את מחזור החיים המלא של הקלטת אולפן:
מהרגע שמפעילים את האולפן, דרך ההקלטה מרובת-הערוצים, ההעלאה לענן, ועד עריכה אוטונומית של
התוצרים על-ידי סוכני AI.

**ההחלטה הארכיטקטונית המרכזית:** לא נוגעים בקוד ה-C++ של OBS. במקום זאת בונים
אפליקציית לוויין (Companion App) שמנצחת על OBS דרך `obs-websocket` (פרוטוקול WebSocket
מובנה, פורט 4455). היתרונות:

- **תחזוקתיות** — שורדים כל עדכון של OBS ללא merge conflicts בקוד ליבה.
- **מהירות פיתוח** — TypeScript/Node במקום C++ בליבת וידאו.
- **בידוד** — קריסה של הלוגיקה שלנו לא מפילה את מנוע ההקלטה.
- **הרחבה** — obs-websocket 5.x חושף כמעט כל פעולה שאפשר לעשות ידנית ב-OBS: החלפת סצנות,
  הצגת/הסתרת מקורות, התחלת/עצירת הקלטה, שליטת שמע, פילטרים, ו-Vendor API לתוספים.

היכן ש-obs-websocket לא מספיק (למשל שליטה עמוקה במיקסר או Custom UI בתוך OBS) — נבנה
**תוסף (plugin) נקודתי** ל-OBS שמרחיב את ה-Vendor API. זו הרחבה, לא fork.

---

## 2. סקירת ארכיטקטורת OBS — מה מקבלים בחינם ומה בונים מעל

OBS Studio בנוי בשכבות:

| שכבה | תפקיד | מה זה נותן לנו |
|------|-------|----------------|
| **libobs** | ליבת המנוע: pipeline וידאו/שמע, ניהול מקורות/פלטים/מקודדים | מנוע ההקלטה עצמו — לא בונים אותו מחדש |
| **Sources** | לכידת מסך/מצלמה/שמע, וידאו, תמונות, פילטרים | מצלמות, מיקרופונים, capture — מוגדרים כמקורות |
| **Outputs** | פלט מקודד/גולמי: streaming, recording | הקלטה מרובת-track יושבת כאן |
| **Encoders / Services** | קידוד x264/NVENC, יעדי streaming | קידוד איכותי מובנה |
| **Frontend (Qt)** | ה-UI, סצנות, פרופילים, scene collections | ה-UI שהמשתמש מכיר — נשאר |
| **obs-websocket 5.x** | RPC over WebSocket, פורט 4455, כולל Vendor API | **נקודת החיבור שלנו** |

**עובדות מפתח שמעצבות את התכנית:**

1. **הקלטה מרובת-track מובנית ב-OBS** — עד 6 tracks נפרדים. אפשר לנתב כל מקור שמע
   ל-track משלו (Advanced Audio Properties → Tracks), ולהקליט קובץ (MKV/MP4) עם
   ערוצי שמע נפרדים. זה בדיוק דרישה 2 (ערוצי סאונד נפרדים).
2. **הפרדת וידאו** — OBS מקליט קומפוזיציה אחת של וידאו. ל"ערוצי וידאו נפרדים" (למשל
   כל מצלמה בנפרד + התמהיל) נשתמש ב-**Source Record filter** (תוסף קהילתי) או ב-outputs
   מרובים דרך פלאגין, כדי לקבל קובץ-לכל-מצלמה במקביל לתמהיל.
3. **obs-websocket חושף**: `StartRecord`/`StopRecord`, `SetCurrentProgramScene`,
   `SetInputMute`/`SetInputVolume`, `GetInputList`, `SetSceneItemEnabled`, אירועי
   `RecordStateChanged`, ועוד — כיסוי מלא לניתוב, עוצמות מיקרופון ושליטת הקלטה.
4. **Vendor API** — תוספי צד-שלישי יכולים לחשוף requests/events דרך אותו WebSocket.
   כאן ניכנס אם נצטרך יכולת שאין ב-core.

---

## 3. ארכיטקטורת המערכת (High-Level)

```
┌──────────────────────────────────────────────────────────────────────┐
│                      StudioMaster Desktop (Electron)                   │
│                                                                        │
│  ┌────────────────┐   ┌─────────────────┐   ┌─────────────────────┐   │
│  │  Renderer (UI) │   │  Main Process   │   │   Local Store        │   │
│  │  React + TS    │◄─►│  Orchestrator   │◄─►│  SQLite + files      │   │
│  │  - אשף פתיחה    │   │  (Node/TS)      │   │  (state, jobs, prefs)│   │
│  │  - Dashboard   │   └────────┬────────┘   └─────────────────────┘   │
│  │  - Mixer view  │            │                                       │
│  └────────────────┘            │                                       │
└────────────────────────────────┼───────────────────────────────────────┘
                                  │
     ┌────────────────────────────┼───────────────────────────────┐
     │                            │                                │
┌────▼─────────┐        ┌─────────▼──────────┐        ┌────────────▼────────────┐
│ OBS Studio   │        │ Studio Launcher    │        │ Cloud + AI Services      │
│ obs-websocket│        │ - הפעלת תוכנות      │        │ - Google Drive           │
│  :4455       │        │ - DMX/תאורה (OSC/  │        │ - Google Calendar        │
│ (+ plugin)   │        │   Art-Net/Serial)  │        │ - AI Editing Workers     │
└──────────────┘        │ - בקרת חלונות      │        │   (Python: ffmpeg/whisper│
                        └────────────────────┘        │    + Claude LLM)         │
                                                       └──────────────────────────┘
```

**עקרון:** ה-Main Process הוא ה-orchestrator. הוא לא עושה עבודה כבדה בעצמו אלא מנהל
מכונת-מצבים (State Machine) של "פגישת אולפן" (Session) ומדבר עם ארבעה תת-מערכות:
OBS, ה-Launcher, הענן, וה-AI workers.

---

## 4. מפת רכיבים לפי הדרישות

| # | דרישה | רכיב אחראי | מנגנון |
|---|-------|------------|--------|
| 1 | פתיחת תוכנות + אשף הפעלה | **Studio Launcher** + **Onboarding Wizard** | פרופילי אולפן (JSON), הפעלת תהליכים, בקרת תאורה, checklist מודרך |
| 2 | הקלטה + ניתוב + ערוצים נפרדים | **Recording Controller** | obs-websocket: multi-track audio, source-record per camera, בקרת עוצמות |
| 3 | העלאה + Drive + Calendar + זיהוי | **Cloud Sync** + **Session Recognizer** | googleapis, התאמת session ל-Calendar event, מטא-דאטה |
| 4 | סוכני עריכה אוטונומיים | **AI Editing Agents** | תור עבודות → Python workers → ffmpeg/whisper/Claude → EDL → render |

---

## 5. מחסנית טכנולוגית (Tech Stack)

**מדוע Electron ולא Tauri:** מחשב אולפן חזק, ואנחנו צריכים ecosystem עשיר של Node
(`obs-websocket-js`, `googleapis`, שליטת תהליכים ב-Windows). Electron מקצר משמעותית זמן
פיתוח וה-overhead זניח על חומרת אולפן.

| שכבה | טכנולוגיה | נימוק |
|------|-----------|-------|
| Desktop shell | **Electron + TypeScript** | ecosystem, Windows APIs, מהירות פיתוח |
| UI | **React + Vite + Tailwind** | אשף, dashboard, mixer view |
| Orchestrator | **Node.js (Main process)** | state machine, ניהול תת-מערכות |
| OBS control | **obs-websocket-js v5** | client רשמי לפרוטוקול 5.x |
| מצב מקומי | **SQLite (better-sqlite3)** | sessions, jobs, prefs — ללא שרת |
| תור עבודות | **תור מבוסס-SQLite** (או BullMQ אם נדרש Redis) | פשטות, ללא תלות חיצונית ל-MVP |
| Google | **googleapis (Node)** + OAuth2 (loopback) | Drive + Calendar רשמי |
| AI workers | **Python 3.11+** microservice | ffmpeg, faster-whisper, ניתוח וידאו |
| קידוד/עריכה | **ffmpeg** | חיתוך, render, מיזוג ערוצים |
| תמלול | **faster-whisper** (מקומי) | תמלול + timestamps ללא עלות ענן |
| החלטות תוכן | **Claude API (claude-opus-4-8 / sonnet)** | הבנת תוכן, EDL, כותרות, פרקים |
| תקשורת workers↔desktop | HTTP מקומי / gRPC / קבצי job | פשוט וניתן לבדיקה |

---

## 6. עיצוב מודולים מפורט

### 6.1 Studio Launcher + Onboarding Wizard (דרישה 1)

**מטרה:** בלחיצה אחת ("התחל אולפן") — להעלות את כל הסביבה הפיזית והתוכנתית, ולהדריך את
המשתמש שלב-אחר-שלב עד תחילת הקלטה.

**Studio Profile (פרופיל אולפן)** — קובץ JSON לכל אולפן/setup:

```jsonc
{
  "id": "studio-a",
  "name": "אולפן ראשי",
  "programs": [                     // תוכנות להפעלה
    { "name": "OBS", "path": "C:/.../obs64.exe", "waitFor": "websocket", "required": true },
    { "name": "Lighting Control", "path": "C:/.../QLC.exe", "waitFor": "window:QLC+" }
  ],
  "lighting": {                     // בקרת תאורה
    "protocol": "artnet",           // artnet | sacn | osc | serial | dmx-usb
    "host": "192.168.1.50",
    "scenes": { "record": "cue-1", "standby": "cue-0" }
  },
  "obs": {
    "sceneCollection": "StudioA",
    "startScene": "Standby",
    "audioTracks": { "1": "mix", "2": "host-mic", "3": "guest-mic", "4": "system" }
  },
  "checklist": [                    // צעדי אשף מודרכים
    "ודא שהמצלמות דולקות",
    "בדוק סימון עוצמה על מיקרופון מארח (-12dB)",
    "ודא תאורה במצב 'record'"
  ]
}
```

**זרימת האשף (State Machine):**

```
IDLE → LAUNCHING_PROGRAMS → CONNECTING_OBS → LIGHTING_ON →
GUIDED_CHECKLIST → AUDIO_LEVEL_CHECK → READY → (המשתמש מאשר) → RECORDING
```

- **הפעלת תוכנות**: `child_process.spawn` ב-Windows, המתנה עד שהתוכנה מוכנה
  (`waitFor`: קיום חלון / זמינות port / process handle).
- **בקרת תאורה**: שכבת אדפטרים (Adapter pattern) — כל פרוטוקול מאחורי אותו interface
  `LightingAdapter.setScene(name)`. תמיכה ב-Art-Net/sACN (רשת), OSC (תוכנות כמו QLC+),
  ו-DMX-USB (serial). מתחילים ב-OSC + Art-Net (הכי נפוצים).
- **הדרכה מודרכת**: כל שלב מוצג ב-UI עם הסבר, בדיקה אוטומטית היכן שאפשר (למשל אימות
  שערוץ המיקרופון קיים ב-OBS ולא mute), ואישור ידני היכן שצריך עין אנושית.

### 6.2 Recording Controller (דרישה 2)

**ניתוב וערוצים נפרדים** — כאן מנצלים את OBS למקסימום:

- **שמע מרובה-track**: מגדירים ב-OBS assignment של מקורות שמע ל-tracks (1–6). StudioMaster
  מאמת דרך obs-websocket שכל מיקרופון ממופה ל-track שלו, ומקליט קובץ עם ערוצי שמע נפרדים
  → קל לעריכה (מארח / אורח / מערכת / תמהיל בנפרד).
- **בקרת עוצמות מיקרופון**: `SetInputVolume` / `SetInputMute`, קריאת peak meters
  (אירועי `InputVolumeMeters`) להצגת LED-meters ב-UI ולניתוב/ducking אוטומטי (מי מדבר).
- **ערוצי וידאו נפרדים**: כל מצלמה כ-source; שימוש ב-**Source Record filter** או outputs
  מרובים (דרך הפלאגין הנקודתי) → קובץ נפרד לכל מצלמה + קובץ תמהיל, במקביל.
- **שליטת הקלטה**: `StartRecord`/`StopRecord`, מעקב אחרי `RecordStateChanged`, שמירת
  metadata (זמנים, סצנות, מי דיבר מתי) ל-SQLite כ-"סרגל אירועים" של הפגישה — קלט חיוני
  לסוכני העריכה.
- **Scene automation**: מעברי סצנות מתוזמנים/מבוססי-אודיו (מיקוד בדובר הפעיל) דרך
  `SetCurrentProgramScene` ו-batch requests המסונכרנים לקומפוזיציה.

### 6.3 Cloud Sync + Session Recognizer (דרישה 3)

- **Google Calendar**: בתחילת session, StudioMaster שולף אירועי היום מהיומן, ומתאים את
  ההקלטה לאירוע הקרוב (שם, משתתפים, תיאור) → כך "מזהה מה הולך באולפן" (סוג התוכן, אורחים).
  אם אין אירוע — האשף שואל את המשתמש metadata בסיסי.
- **Google Drive**: העלאה אוטומטית של כל התוצרים (raw multi-track, קבצי מצלמה, תמהיל,
  תמלול, תוצרי עריכה) למבנה תיקיות לפי תאריך/שם-פגישה. Resumable uploads לקבצים גדולים,
  מעקב התקדמות ב-UI, retry עם backoff.
- **Session Recognizer**: משלב מקורות — שם אירוע ביומן, מספר דוברים (מ-diarization),
  תמלול, ומטא-דאטה — לכדי "פרופיל תוכן" שמזין את סוכני העריכה (מה סוג הפרק, מי האורח,
  אילו תוצרים מוסכמים).
- **אבטחת גישה**: OAuth2 עם loopback redirect, אחסון refresh token מוצפן במערכת
  ה-credential של Windows (DPAPI / keytar). Scopes מינימליים: `drive.file`,
  `calendar.readonly`.

### 6.4 AI Editing Agents (דרישה 4)

**מטרה:** אחרי ההקלטה, סוכנים אוטונומיים מפיקים את "החומרים המוסכמים" (clips, פרקים,
גרסה מלאה ערוכה, גרסאות סושיאל) ללא התערבות.

**Pipeline:**

```
Recording done → Ingest job → [Transcribe] → [Analyze] → [Plan (EDL)] →
[Render] → [QA] → Upload results → Notify
```

1. **Ingest** — איסוף כל קבצי הפגישה + סרגל האירועים מ-SQLite.
2. **Transcribe** — faster-whisper: תמלול + word-level timestamps + speaker diarization.
3. **Analyze** — זיהוי שתיקות/מילות-מילוי, "רגעי שיא" (סנטימנט/אנרגיה), chapters.
4. **Plan (Edit Decision List)** — **Claude** מקבל תמלול + מטא-דאטה + "פרופיל תוצרים
   מוסכמים" ומחזיר EDL מובנה: אילו קטעים לחתוך, סדר, כותרות, chapters, ומאילו clips
   לסושיאל (עם reframing אנכי 9:16).
5. **Render** — ffmpeg מבצע את ה-EDL: חיתוכים, מיזוג ערוצי שמע, כתוביות מוטבעות, כותרות.
6. **QA** — בדיקות אוטומטיות (אורך, שמע לא-שקט, אין חיתוך באמצע מילה) + סף לאישור אנושי.
7. **Deliver** — העלאה ל-Drive; אופציונלית תזמון לרשתות (יש MCP: OneUp/Nuelink).

**"החומרים המוסכמים"** מוגדרים ב-**Deliverable Templates** (פר-אולפן/סוג-תוכן):
`{ full_edit, highlights[3-5], social_shorts[9:16], audio_podcast, chapters, transcript }`.
כל template מגדיר יעד, פורמט, אורך, וסגנון — וזה ההסכם שהסוכנים ממלאים.

**אוטונומיה בטוחה:** הסוכנים רצים ב-workers מבודדים, כל job idempotent וניתן ל-retry,
עם gate של "אישור אנושי" ניתן-להגדרה לפני פרסום חיצוני (ברירת מחדל: on).

---

## 7. מודל נתונים (ליבה)

```
StudioProfile      (id, name, programs[], lighting, obs, checklist[])
Session            (id, profileId, calendarEventId?, title, guests[],
                    startedAt, endedAt, status, storagePath)
MediaAsset         (id, sessionId, type[mix|cam|track|transcript|deliverable],
                    path, driveFileId?, durationMs, meta)
Timeline Event     (id, sessionId, tMs, kind[scene|speaker|record|marker], data)
EditJob            (id, sessionId, stage, status, workerId, attempts, result)
DeliverableTemplate(id, name, items[], style)
```

---

## 8. אבטחה ופרטיות

- Tokens של Google מוצפנים ב-Windows DPAPI (via `keytar`), scopes מינימליים.
- כל המדיה נשארת מקומית עד העלאה מפורשת; המשתמש שולט מה עולה ומה מתפרסם.
- מפתחות API (Claude וכו') ב-`.env` מקומי / credential store — לא ב-repo.
- פרסום חיצוני (סושיאל) תמיד מאחורי gate אישור בברירת מחדל.

---

## 9. סיכונים והפחתה

| סיכון | הפחתה |
|-------|-------|
| שינויי פרוטוקול OBS בין גרסאות | client רשמי + version negotiation; e2e tests מול OBS |
| ערוצי וידאו נפרדים לא ב-core | Source Record filter / plugin נקודתי, מתועד כתלות |
| מגוון פרוטוקולי תאורה | Adapter pattern; מתחילים ב-OSC+Art-Net, מרחיבים לפי צורך |
| עלות/זמן של AI על וידאו ארוך | תמלול מקומי (whisper), LLM רק על טקסט/EDL, לא על פיקסלים |
| כשל העלאה בקבצים גדולים | resumable uploads + retry/backoff + תור עמיד |

---

## 10. החלטות פתוחות (Open Decisions)

ראה `docs/DECISIONS.md`. עיקריות שנסגרו: Windows-only, Companion-over-websocket,
MVP = Wizard+Recording. נותרו: פרוטוקול/דגם התאורה הספציפי באולפן, ותבנית "החומרים
המוסכמים" המדויקת לתוצרים.
