# packages/ptz-control

שליטת מצלמות PTZ מהממשק — Minrray ו-OBSBOT (Tail Air) מעל **VISCA-over-IP** (UDP :52381).

## API מתוכנן
- `PtzController.move(camId, {pan, tilt, speed})` — pan/tilt רציף כל עוד לחוץ.
- `PtzController.zoom(camId, dir)` / `stop(camId)`.
- `PtzController.recallPreset(camId, n)` / `storePreset(camId, n)`.

## Backends (מאחורי interface אחיד)
- **`ViscaIpBackend`** (ברירת מחדל) — client VISCA-over-IP ישיר, StudioMaster בעל החיבור.
- **`ObsPtzBridgeBackend`** (חלופי) — ניתוב דרך תוסף `obs-ptz` הקיים (obs-websocket vendor),
  למניעת קונפליקט החיבור-היחיד של VISCA-over-IP.

מיושם ב-Phase 2. ראה [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) §6.2.1.
