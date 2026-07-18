# החלטות ארכיטקטוניות (ADRs) והחלטות פתוחות

## החלטות שנסגרו

### ADR-001: פלטפורמת יעד — Windows בלבד
רוב אולפני ההקלטה על Windows. מאפשר שליטה עמוקה בחומרה (DMX/USB/תאורה), אוטומציית
תוכנות, ואינטגרציית מערכת מלאה.

### ADR-002: שליטה ב-OBS דרך obs-websocket (Companion App)
**החלטה:** אפליקציית לוויין מעל `obs-websocket` 5.x, לא fork ולא שינוי ליבת C++.
**נימוק:** תחזוקתיות (שורדים עדכוני OBS), מהירות פיתוח (TS במקום C++), בידוד קריסות,
כיסוי כמעט-מלא של הפרוטוקול. הרחבות נקודתיות דרך Vendor API/פלאגין רק היכן שחובה.

### ADR-003: סקופ MVP — אשף פתיחה + הקלטה מרובת-ערוצים
מתחילים בדרישות 1+2 (הערך המיידי באולפן), ואז ענן (3) ואז סוכני AI (4).

### ADR-004: מחסנית — Electron + React + TypeScript, Python ל-AI
Electron בגלל ecosystem של Node (obs-websocket-js, googleapis, שליטת תהליכי Windows)
ומהירות פיתוח; Python ל-workers של AI (ffmpeg, whisper). Claude ל-החלטות תוכן/EDL.

### ADR-005: תאורה — FreeStyler DMX, האדפטר הראשון
התאורה באולפן מופעלת ע"י **FreeStyler**. שליטה חיצונית: webserver/TCP מובנה על **פורט
3332** (ראשי) ו/או **MIDI** דרך virtual MIDI (LoopBe1/MIDI Yoke). מממשים `FreeStylerAdapter`
מאחורי ה-interface הכללי `LightingAdapter`; אדפטרים אחרים (Art-Net/OSC/DMX-USB) יתווספו
בעתיד ללא שינוי בשאר המערכת. פורמט פקודת ה-button/cue המדויק יאומת מול הוויקי הרשמי ב-Phase 1.

### ADR-006: שליטת מצלמות PTZ — VISCA-over-IP
מצלמות ה-PTZ (Minrray / OBSBOT Tail Air) נשלטות מהממשק דרך **VISCA-over-IP** (UDP, פורט
**52381**) — המכנה המשותף לשני המותגים (OBSBOT Tail Air תומך רק VISCA-over-IP + NDI).
מממשים `PtzController` עם `ViscaIpBackend` ישיר (ברירת מחדל, שליטה מלאה מה-UI) ו-backend
חלופי שמנתב דרך תוסף `obs-ptz` הקיים. **אילוץ:** VISCA-over-IP מאפשר בעל-חיבור יחיד למצלמה
בו-זמנית — או StudioMaster או obs-ptz, לא שניהם על אותו host.

---

## החלטות פתוחות — צריך קלט ממך

### ~~OD-1: פרוטוקול/דגם התאורה~~ → נסגר, ראה ADR-005

### OD-2: אילו תוכנות נוספות לפתוח בתחילת אולפן
רשימת ה-.exe והסדר (מעבר ל-OBS): בקרת תאורה, מיקסר, teleprompter, וכו'.

### OD-3: "החומרים המוסכמים" — תבנית התוצרים
מה בדיוק צריך לצאת מכל הקלטה? (עריכה מלאה? כמה highlights? shorts אנכיים? פודקאסט שמע?
פרקים? כתוביות?) — מגדיר את Deliverable Templates ל-Phase 4.

### OD-4: ערוצי וידאו נפרדים — רמת דיוק
האם מספיק קובץ-לכל-מצלמה דרך Source Record filter, או שצריך יכולת שדורשת פלאגין נקודתי?
