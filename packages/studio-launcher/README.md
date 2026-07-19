# @studiomaster/studio-launcher

פותח את תוכנות האולפן **לפי הסדר** וממתין שכל אחת תהיה מוכנה לפני הבאה (docs/ARCHITECTURE.md §6.1).

## API
- `StudioLauncher(effects).launch(programs, onStep, options)` — מריץ את הרצף, מדווח כל שלב
  דרך `onStep`, ומחזיר `{ ok, steps }`. תוכנה **חיונית** שנכשלת עוצרת את הרצף ומדלגת על השאר.
- `defaultEffects` — מימוש אמיתי מול מערכת ההפעלה (spawn / TCP port / tasklist / delay).
- `parseWaitFor(waitFor)` — פירוק מחרוזת ה-`waitFor` של תוכנה.

## אופני המתנה (`waitFor`)
`spawn` (מיד) · `websocket` (OBS 4455) · `delay:<ms>` · `port:<n>` · `window:<name>`.

הלוגיקה (סדר, המתנה, עצירה-על-חיוני) מבודדת מ-side effects דרך `LauncherEffects` → נבדקת
ביחידה (`test/launcher.test.ts`, `npm test`).
