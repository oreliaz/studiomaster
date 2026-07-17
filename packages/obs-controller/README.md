# packages/obs-controller

עטיפה מעל [`obs-websocket-js`](https://github.com/obs-websocket-community-projects/obs-websocket-js)
(פרוטוקול 5.x). מספקת API עם טיפוסים לחיבור, reconnect, requests ו-events של OBS.

## פונקציונליות מתוכננת
- `connect()` / `disconnect()` / reconnect אוטומטי + version negotiation.
- שליטת הקלטה: `startRecord()`, `stopRecord()`, מעקב `RecordStateChanged`.
- סצנות/מקורות: `setScene()`, `setSourceEnabled()`, `getInputs()`.
- שמע: `setInputVolume()`, `setInputMute()`, מנוי ל-`InputVolumeMeters`.

מיושם ב-Phase 0. ראה [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) §6.2.
