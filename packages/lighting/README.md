# @studiomaster/lighting

בקרת תאורה מאחורי interface אחיד (docs/ARCHITECTURE.md §6.1, ADR-005). המימוש הראשון:
**FreeStyler**.

## API
- `LightingAdapter` — `setCue(command)` / `test()`.
- `FreeStylerAdapter(host, port)` — שולח HTTP ל-webserver המובנה של FreeStyler (פורט 3332).
  ערך ה-cue מפרופיל האולפן משמש כנתיב הבקשה (או URL מלא) — כך המיפוי נשאר ניתן-להגדרה
  לכל אולפן. פורמט פקודת ה-button המדויק יאומת מול הוויקי הרשמי.
- `createLightingAdapter(config)` — בונה adapter מ-`StudioProfile.lighting`, או `null` אם לא מוגדר.

אדפטרים נוספים (Art-Net / sACN / OSC / DMX-USB) יתווספו מאחורי אותו interface.
