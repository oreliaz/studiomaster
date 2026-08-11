# StudioMaster — מדריך פיילוט על מחשב אחד · One-Computer Pilot Guide

> עברית למטה בהמשך יש גרסת English. הפיילוט רץ על מחשב Windows אחד עם OBS.

---

## עברית — הרצת פיילוט מלא

### 0. דרישות מוקדמות (מתקינים פעם אחת)

| כלי | למה | קישור |
|-----|-----|-------|
| **OBS Studio 28+** | מנוע ההקלטה | obsproject.com |
| **Node.js 20+** | להריץ את StudioMaster | nodejs.org |
| **Python 3.11+** | סוכני העריכה | python.org (סמן "Add to PATH") |
| **ffmpeg + ffprobe** | חיתוך/רינדור וידאו | **מובנה** ב-StudioMaster (יורד ב-`npm install`) — לא צריך להתקין |

### 1. התקנת StudioMaster

```powershell
git clone <repo-url> studiomaster
cd studiomaster
git checkout claude/obs-studio-management-system-ql7jfj
npm install
npm run dev                                          # פותח את האפליקציה
```
לגרסת `.exe` להתקנה רגילה: `npm run dist:win` → הקובץ ב-`apps/desktop/release/`.

### 2. חיבור ל-OBS (מוגדר אוטומטית ע"י האשף)
אשף ההתקנה כבר הפעיל את שרת ה-WebSocket של OBS (פורט **4455**, ללא סיסמה). פשוט פתח את
StudioMaster, עבור ללשונית **"הקלטה"** ולחץ **התחבר** (הכתובת מוגדרת, שדה הסיסמה נשאר ריק).
*(אם הרצת OBS בפעם הראשונה רק אחרי ההתקנה — הרץ את האשף שוב, או הפעל ידנית:
Tools → WebSocket Server Settings → Enable.)*

### 3. "התוסף" בתוך OBS (Browser Dock)
StudioMaster אינו תוסף C++ — הוא רץ לצד OBS, אבל אפשר להטמיע את פאנל השליטה **בתוך OBS**:
1. ודא ש-StudioMaster רץ.
2. ב-OBS: **Docks → Custom Browser Docks…**
3. שם: `StudioMaster`, כתובת: `http://127.0.0.1:3939/dock` → **Apply**.
פאנל קטן יופיע בתוך OBS: חיבור, טיימקוד, התחל/עצור הקלטה, וכפתורי סימון (תיקון/הדגשה/פרק).

### 4. התקנת תלויות העריכה (סקילים)
סוכני העריכה מבוססים על שני הסקילים שב-`services/skills/`:
- **basic-editing-he** — עריכה בסיסית מלאה (חיתוכים + סאונד + פתיח/סגיר).
- **podcast-reels-he** — 15 רילסים עם hook וכתוביות, בסגנון **פשוט** או **פרימיום (כריסלייט)**.

מתקינים פעם אחת (בתוך תיקיית הרילס — מוריד את מודל Whisper העברי של ivrit.ai, ~1.6GB):
```powershell
cd services\skills\podcast-reels-he
powershell -ExecutionPolicy Bypass -File install.ps1
python scripts\setup_check.py     # מדווח מה מוכן
```
> לרילסים בסגנון **פרימיום** צריך גם Node (למנוע ה-overlay). **פשוט** צריך רק ffmpeg+whisper.

### 5. אולפנים ופודקאסטים — שתי הגדרות נפרדות
המבנה מפריד בין **ציוד** (אולפן) לבין **תוצרים** (פודקאסט), כך שאותו פודקאסט אפשר להקליט
בכל אולפן, ובכל אולפן אפשר להקליט כמה פודקאסטים.

**לשונית "אולפנים"** (ציוד + רצף הפעלה — פר-חדר) → **+ אולפן חדש**:
- **תוכנות לפתיחה (לפי סדר)** — OBS, FreeStyler, מיקסר… בסדר שתבחר (לכל אולפן רצף משלו).
- **תאורה (FreeStyler)** — כתובת `127.0.0.1`, פורט `3332`, cues של standby/record.
- **מצלמות PTZ** (אם יש) — VISCA-over-IP, פורט 52381.
- **הקלטת שמע** — *הקלטה מרובת-ערוצים* (ערוץ נפרד לכל מיקרופון) + ניתוב שמע.

**לשונית "פודקאסטים"** (תוצרים — פר-תוכנית) → **+ פודקאסט חדש**:
- סוג עריכה (בסיסית / רילסים / שניהם), **שפת התוכן (עברית/English)**, פתיח/סגיר,
  כמה רילסים, סגנון רילס, העלאה לסושיאל, ו**מתי לערוך** (מיד / ידני / בלילה).

לפני הקלטה: בלשונית **"הקלטה"** בוחרים מהתפריט **איזה פודקאסט מקליטים עכשיו** — והתוצרים
של אותו פודקאסט מיושמים אוטומטית בסיום. שתי ההגדרות נשמרות וחוזרות — לא ממלאים שוב.

### 6. זרימת עבודה יומית
1. לשונית **"פתיחת אולפן"** → בחר אולפן → **▶ התחל אולפן** (פותח תוכנות + תאורה + checklist).
2. עבור ל-**"הקלטה"** (או השתמש בפאנל בתוך OBS) → **● התחל הקלטה**.
3. תוך כדי: לחץ **Ctrl+Shift+1** (תיקון) / **2** (הדגשה) / **3** (פרק) / **4** (הערה) —
   כל לחיצה נכנסת למסמך התיקונים ומהבהב חיווי על מסך ה-OBS.
   *(מקור החיווי `StudioMaster Marker` נוצר אוטומטית ב-OBS ברגע החיבור — אין צורך ליצור ידנית.
   הוא נוצר מוסתר; אפשר לגרור/לעצב אותו איפה שנוח.)*
4. **■ עצור הקלטה**.
5. לשונית **"ענן ועריכה"** → בחר **מתי להריץ עורך אוטומטי**:
   - **מיד** — העריכה רצה בסיום ההקלטה.
   - **ידני** — לחץ **ערוך אוטומטית** על ההקלטה כשתרצה.
   - **אוטומטי בלילה (00:00–08:00)** — כל ההקלטות של היום נערכות אוטומטית בלילה.

### 7. איפה התוצרים
בתוך תיקיית ה-session (תחת `%APPDATA%/@studiomaster/desktop/recordings/<תאריך>/`):
- `review.md` / `cuts.txt` — מסמך התיקונים והחיתוכים.
- `work/final.mp4` — הפרק הערוך (עריכה בסיסית).
- `out_final/*.mp4` — הרילסים המוגמרים (עם כתוביות וגרפיקה; סגנון פרימיום = כריסלייט).
- `audio/track*.wav` — ערוצי האודיו הנפרדים לכל מיקרופון.
- `title.txt` / `description.txt` / `metadata.json` — כותרת ותיאור לפרסום.
- `thumbnails/thumb*.jpg` — תמונות מועמדות לתמבנייל.

**הוספת פרק שערכת בעצמך:** בלשונית "ענן ועריכה" → **"+ הוסף פרק שערכתי"** → בחר קובץ וידאו,
פודקאסט, וסמן **אילו תוצרים** להפיק (עריכה בסיסית / רילסים / כותרת / תיאור / תמבנייל — חלק או הכל).
כך אפשר להריץ רק רילסים+כותרת+תמבנייל על פרק ערוך, בלי עריכה בסיסית מחדש.
אם חיברת Google בלשונית "ענן ועריכה" — אפשר להעלות הכל ל-Drive בלחיצה.

### 7.5 מאגר ידע משותף (מאיפה להתחיל + מאגר באגים)
לשונית **"מאגר ידע"**:
- **הערות פר-פודקאסט** — כללי עריכה, טון, החלטות קבועות. נכנסות אוטומטית להנחיית העורך
  (בחירת הרילסים), כך שהעורך הבא של אותו פודקאסט מתחיל מאותה נקודה.
- **מאגר באגים** — תיעוד תקלה + הפתרון, כדי שלא תחזור למשתמשים אחרים.
- **חשבון ושרת (Supabase)** — מומלץ: משתמש (חשבון) לכל אולפן, ו**וורקספייס משותף** שמקבץ כמה
  אולפנים לאותו מאגר ידע. הקמה חד-פעמית: [`SUPABASE.md`](./SUPABASE.md). לאחר חיבור, כפתור
  **🔄 סנכרן** מסנכרן דרך השרת (מיזוג "העדכני מנצח", עם הרשאות פר-וורקספייס).
- בלי שרת מוגדר — הסנכרון נופל חזרה ל-Google Drive (`StudioMaster/knowledge-base.json`; שתפו את
  התיקייה כדי לשתף). גם **הערות העריכה החופשיות** בסקירת פרק מוזנות להנחיית העורך בעריכה מחדש.

### 8. עברית ואנגלית
שפת התוכן נבחרת **פר-אולפן** בשאלון. עברית משתמשת ב-Whisper העברי (ivrit.ai); אנגלית
ב-Whisper הרגיל. שפת הממשק מתחלפת בכפתור **EN/עב** בסרגל הצד.

---

## English — running the pilot

Same flow, in short:
1. Install **OBS 28+, Node 20+, Python 3.11+, ffmpeg**.
2. `git clone` → `npm install` → `npm run dev`.
3. OBS **Tools → WebSocket Server Settings** → Enable (port 4455). Connect in the **Record** tab.
4. OBS **Docks → Custom Browser Docks** → `http://127.0.0.1:3939/dock` to embed the panel.
5. Install skill deps once: `services/skills/podcast-reels-he/install.ps1` (downloads the
   Hebrew Whisper model; English content uses standard Whisper).
6. **Studios** tab → create a studio: programs+order, lighting, PTZ, and the
   **Deliverables questionnaire** (edit type, content language he/en, intro/outro, reels
   count + style simple/premium, social upload). Saved and reused.
7. **Open Studio** → **Record** (or the in-OBS dock) → mark with **Ctrl+Shift+1..4** → stop.
8. **Cloud & Edit** tab → pick when the auto-editor runs (now / manual / overnight
   00:00–08:00). Outputs land in the session folder and optionally upload to Drive.

## אבטחת Windows — SmartScreen / Smart App Control

Windows חוסם קבצים לא-חתומים (אין לנו עדיין תעודת code-signing). מה עושים:

- **מומלץ:** הפעל את StudioMaster **מהקיצור** (`npm run dev`) — משתמש ב-electron.exe החתום,
  ולא נחסם. **אל** תריץ את ה-`.exe` הבנוי בפיילוט (הוא לא חתום → נחסם).
- אם קובץ `.cmd`/`.ps1` נחסם: לחיצה ימנית → **Properties → Unblock → Apply**.
- אם קופץ **SmartScreen** ("Windows protected your PC"): **More info → Run anyway**.
- אם **Smart App Control** (Win11) חוסם לגמרי: Settings → Windows Security → App & browser
  control → **Smart App Control → Off** (על מחשב אולפן ייעודי זה סביר), או הישאר ב-dev mode.
- **לטווח ארוך:** חתימת קוד (EV/OV certificate) מסירה את החסימות בהפצה. לא נדרש לפיילוט.

## מגבלות ידועות בפיילוט · Known pilot limits
- **בחירת קליפים לרילס**: עם `ANTHROPIC_API_KEY` מוגדר — Claude קורא את התמלול המתוזמן ובוחר
  קליפים שמתחילים בהוק, עצמאיים, וממוקמים על גבולות משפטים (בחירה חכמה). בלי מפתח — נפילה
  אוטומטית לבחירה לפי סמני ההדגשה + פיזור אחיד (אז סמן הדגשה ב-Ctrl+Shift+2 על רגעים חזקים
  משפר את החיתוך). *(Smart transcript-based selection with an API key; marker fallback otherwise.)*
- סגנון **פרימיום (כריסלייט)** דורש שמנוע ה-Node של הסקיל יותקן (אשף ההתקנה של הרילס עושה
  זאת: puppeteer + Chrome). אם הרינדור הפרימיום נכשל, המערכת נופלת אוטומטית לסגנון **פשוט**
  עם כתוביות, כדי שתמיד יתקבלו רילסים. *(Premium falls back to captioned simple if the Node
  engine/Chrome is missing.)*
- פורמט פקודת FreeStyler לאימות בשטח. *(FreeStyler command format to verify on-site.)*
