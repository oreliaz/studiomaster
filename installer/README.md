# StudioMaster — אשף התקנה (Windows)

התקנה בלחיצה של StudioMaster + כל מה שצריך, למחשב אולפן אחד (פיילוט).

## איך מריצים
1. הורד/שכפל את הפרויקט למחשב ה-Windows של האולפן.
2. פתח את תיקיית `installer`.
3. **לחץ דאבל-קליק על `StudioMaster-Setup.cmd`**.

זהו. האשף יבצע:

| שלב | מה קורה |
|-----|---------|
| 1 | מתקין (דרך winget) את **Node.js, Python 3.11, ffmpeg, OBS Studio** — מדלג על מה שכבר קיים |
| 2 | `npm install` + בניית `better-sqlite3` ל-Electron |
| 3 | מתקין את סוכני העריכה + **מודל התמלול העברי** (ivrit.ai Whisper, ~1.6GB) |
| 4 | בונה את האפליקציה |
| 5 | רושם אוטומטית את פאנל StudioMaster **בתוך OBS** (Custom Browser Dock) |
| 6 | יוצר קיצור דרך **StudioMaster** על שולחן העבודה |

## אפשרויות
```powershell
# גם לייצר קובץ התקנה .exe:
powershell -ExecutionPolicy Bypass -File install.ps1 -Build

# לדלג על התקנת התוכנות הבסיסיות (אם כבר מותקנות):
powershell -ExecutionPolicy Bypass -File install.ps1 -SkipPrereqs
```

## הערות
- **סגור את OBS** לפני ההתקנה כדי שרישום ה-Dock יישמר (OBS דורס את ההגדרות ביציאה).
- אם אין **winget** במחשב: התקן "App Installer" מ-Microsoft Store, או התקן ידנית את הכלים
  מטבלת השלב הראשון — שאר האשף ימשיך לעבוד.
- אחרי ההתקנה: הפעל StudioMaster מהקיצור, וב-OBS הפעל
  **Tools → WebSocket Server Settings → Enable** (פורט 4455).
- מדריך העבודה המלא: [`../docs/PILOT.md`](../docs/PILOT.md).

## What it does (English)
One-click installer for a single studio PC: installs Node/Python/ffmpeg/OBS via
winget, installs app + Python editing deps + the Hebrew Whisper model, registers
the StudioMaster panel as an OBS Custom Browser Dock, and creates a desktop
shortcut. Run `StudioMaster-Setup.cmd`. Close OBS first.
