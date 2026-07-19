# @studiomaster/ptz-control

שליטת מצלמות PTZ מהממשק — Minrray ו-OBSBOT (Tail Air) מעל **VISCA-over-IP** (UDP :52381).

## API
- `createPtzController(cameras)` → `PtzController` (או `null` אם אין מצלמות VISCA-over-IP).
- `PtzController`: `move()` / `stopMove()` / `zoom()` / `recallPreset()` / `storePreset()` / `cameras()`.
- `ViscaIpController` — מימוש UDP; מנהל sequence number לכל מצלמה.
- בוני פקודות VISCA טהורים (`visca.ts`): `panTiltCommand`, `zoomCommand`,
  `presetRecallCommand`, `presetStoreCommand`, `viscaOverIp` — נבדקים ביחידה (`npm test`).

## אילוץ (ADR-006)
VISCA-over-IP מאפשר **בעל-חיבור יחיד** למצלמה בו-זמנית. אם תוסף `obs-ptz` מחובר לאותה
מצלמה מאותו host — StudioMaster לא יתחבר במקביל. גשר `obs-ptz` יתווסף מאחורי אותו interface.
