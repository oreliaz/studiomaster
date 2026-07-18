# apps/desktop

אפליקציית ה-Electron: ה-UI (React) וה-orchestrator (Main process).

## אחריות
- **Renderer (React)**: Dashboard, ובהמשך אשף פתיחת אולפן ו-Mixer View.
- **Main (Node/TS)**: ניהול חיבור OBS (`@studiomaster/obs-controller`), גשר IPC ל-renderer,
  ושכבת אחסון מקומית (`src/main/store.ts`, SQLite).

## מבנה
```
src/main/       תהליך ה-Main: index.ts (חלון + IPC), store.ts (SQLite)
src/preload/    גשר contextBridge → window.studiomaster (טיפוסי StudioMasterApi)
src/renderer/   React (Vite): App.tsx (Dashboard), styles.css
```

## הרצה (Windows)

מהשורש של המונוריפו:

```bash
npm install
```

> **הערה על Electron:** אם `npm install` רץ בסביבה חסומת-רשת, הורדת ה-binary של Electron
> עלולה להיכשל. במחשב פיתוח רגיל היא מתבצעת אוטומטית. לדילוג יזום: `set ELECTRON_SKIP_BINARY_DOWNLOAD=1`.

> **מודול native (better-sqlite3):** אם ה-DB לא נטען תחת Electron, הרץ rebuild ל-ABI של Electron:
> ```bash
> npm run rebuild --workspace @studiomaster/desktop
> ```
> אם ה-rebuild נכשל, האפליקציה נופלת אוטומטית ל-store בזיכרון וממשיכה לעבוד (ראה `store.ts`).

### פיתוח
```bash
npm run dev           # מריץ את האפליקציה עם hot-reload (electron-vite dev)
```

### בנייה ובדיקות
```bash
npm run build         # bundling של main/preload/renderer ל-out/
npm run typecheck     # בדיקת טיפוסים (node + web)
```

## דרישות קדם באולפן
- OBS Studio 28+ עם obs-websocket מופעל (Tools → WebSocket Server Settings), פורט 4455.
- אם מוגדרת סיסמה ב-OBS — הזן אותה ב-Dashboard.

מיושם ב-Phase 0. ראה [`docs/ROADMAP.md`](../../docs/ROADMAP.md).
