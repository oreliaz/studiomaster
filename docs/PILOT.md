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
| **ffmpeg + ffprobe** | חיתוך/רינדור וידאו | gyan.dev/ffmpeg (הוסף ל-PATH) |

### 1. התקנת StudioMaster

```powershell
git clone <repo-url> studiomaster
cd studiomaster
git checkout claude/obs-studio-management-system-ql7jfj
npm install
npm run rebuild --workspace @studiomaster/desktop   # מקמפל better-sqlite3 ל-Electron
npm run dev                                          # פותח את האפליקציה
```
לגרסת `.exe` להתקנה רגילה: `npm run dist:win` → הקובץ ב-`apps/desktop/release/`.

### 2. הפעלת obs-websocket (זה מה שמחבר אותנו ל-OBS)
ב-OBS: **Tools → WebSocket Server Settings** → סמן **Enable**, פורט **4455**, העתק סיסמה אם יש.
ב-StudioMaster בלשונית **"הקלטה"** הזן את הכתובת/סיסמה ולחץ **התחבר**.

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

### 5. בניית אולפן (השאלון שנשמר וחוזר)
בלשונית **"אולפנים"** → **+ אולפן חדש**:
- **תוכנות לפתיחה (לפי סדר)** — OBS, FreeStyler, מיקסר… בסדר שתבחר.
- **תאורה (FreeStyler)** — כתובת `127.0.0.1`, פורט `3332`, cues של standby/record.
- **מצלמות PTZ** (אם יש) — VISCA-over-IP, פורט 52381.
- **שאלון תוצרים** — סוג עריכה (בסיסית / רילסים / שניהם), **שפת התוכן (עברית/English)**,
  פתיח/סגיר, כמה רילסים, סגנון רילס, והאם להעלות לסושיאל.
לחץ **שמור**. הפרופיל חוזר בכל הקלטה — לא ממלאים שוב.

### 6. זרימת עבודה יומית
1. לשונית **"פתיחת אולפן"** → בחר אולפן → **▶ התחל אולפן** (פותח תוכנות + תאורה + checklist).
2. עבור ל-**"הקלטה"** (או השתמש בפאנל בתוך OBS) → **● התחל הקלטה**.
3. תוך כדי: לחץ **Ctrl+Shift+1** (תיקון) / **2** (הדגשה) / **3** (פרק) / **4** (הערה) —
   כל לחיצה נכנסת למסמך התיקונים ומהבהב חיווי על מסך ה-OBS.
   *(כדי לראות את החיווי: צור ב-OBS מקור טקסט/תמונה בשם המדויק `StudioMaster Marker`.)*
4. **■ עצור הקלטה**.
5. לשונית **"ענן ועריכה"** → בחר **מתי להריץ עורך אוטומטי**:
   - **מיד** — העריכה רצה בסיום ההקלטה.
   - **ידני** — לחץ **ערוך אוטומטית** על ההקלטה כשתרצה.
   - **אוטומטי בלילה (00:00–08:00)** — כל ההקלטות של היום נערכות אוטומטית בלילה.

### 7. איפה התוצרים
בתוך תיקיית ה-session (תחת `%APPDATA%/@studiomaster/desktop/recordings/<תאריך>/`):
- `review.md` / `cuts.txt` — מסמך התיקונים והחיתוכים.
- `work/final.mp4` — הפרק הערוך (עריכה בסיסית).
- `out_preview/*.mp4` — הרילסים.
אם חיברת Google בלשונית "ענן ועריכה" — אפשר להעלות הכל ל-Drive בלחיצה.

### 8. עברית ואנגלית
שפת התוכן נבחרת **פר-אולפן** בשאלון. עברית משתמשת ב-Whisper העברי (ivrit.ai); אנגלית
ב-Whisper הרגיל. שפת הממשק מתחלפת בכפתור **EN/עב** בסרגל הצד.

---

## English — running the pilot

Same flow, in short:
1. Install **OBS 28+, Node 20+, Python 3.11+, ffmpeg**.
2. `git clone` → `npm install` → `npm run rebuild -w @studiomaster/desktop` → `npm run dev`.
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

## מגבלות ידועות בפיילוט · Known pilot limits
- הצעת 15 הקליפים לרילס: כרגע נגזרת מסמני ההדגשה + פיזור אחיד (הבחירה החכמה עם מודל —
  שלב הבא). *(Reel clip selection is marker-driven for now; model-picked clips are next.)*
- סגנון **פרימיום** דורש את מנוע ה-Node של הסקיל מותקן. *(Premium reels need the skill's Node engine.)*
- פורמט פקודת FreeStyler לאימות בשטח. *(FreeStyler command format to verify on-site.)*
