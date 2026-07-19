import type { PanDir, TiltDir, ZoomDir } from '@studiomaster/shared'

/**
 * VISCA + VISCA-over-IP encoding (docs ADR-006). Pure byte builders so the wire
 * format is unit-tested without any network. Covers the subset StudioMaster
 * needs: pan/tilt drive, zoom, and preset recall/store — supported by both
 * Minrray and OBSBOT (Tail Air) over VISCA-over-IP.
 */

const PAN_SPEED_MIN = 0x01
const PAN_SPEED_MAX = 0x18
const TILT_SPEED_MIN = 0x01
const TILT_SPEED_MAX = 0x14
const ZOOM_SPEED_MAX = 0x07

const clamp = (n: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, Math.round(n)))

const panByte: Record<PanDir, number> = { left: 0x01, right: 0x02, stop: 0x03 }
const tiltByte: Record<TiltDir, number> = { up: 0x01, down: 0x02, stop: 0x03 }

/** Pan/Tilt Drive: 8x 01 06 01 VV WW PP QQ FF */
export function panTiltCommand(
  pan: PanDir,
  tilt: TiltDir,
  panSpeed = 0x0c,
  tiltSpeed = 0x0c,
): Uint8Array {
  const vv = clamp(panSpeed, PAN_SPEED_MIN, PAN_SPEED_MAX)
  const ww = clamp(tiltSpeed, TILT_SPEED_MIN, TILT_SPEED_MAX)
  return Uint8Array.from([0x81, 0x01, 0x06, 0x01, vv, ww, panByte[pan], tiltByte[tilt], 0xff])
}

/** Zoom: 8x 01 04 07 pS FF (tele=0x2S in, wide=0x3S out, stop=0x00). */
export function zoomCommand(dir: ZoomDir, speed = 0x04): Uint8Array {
  let control: number
  if (dir === 'stop') control = 0x00
  else {
    const s = clamp(speed, 0x00, ZOOM_SPEED_MAX)
    control = (dir === 'in' ? 0x20 : 0x30) | s
  }
  return Uint8Array.from([0x81, 0x01, 0x04, 0x07, control, 0xff])
}

/** Recall a stored preset: 8x 01 04 3F 02 0p FF */
export function presetRecallCommand(preset: number): Uint8Array {
  return Uint8Array.from([0x81, 0x01, 0x04, 0x3f, 0x02, clamp(preset, 0, 0x7f), 0xff])
}

/** Store the current position to a preset: 8x 01 04 3F 01 0p FF */
export function presetStoreCommand(preset: number): Uint8Array {
  return Uint8Array.from([0x81, 0x01, 0x04, 0x3f, 0x01, clamp(preset, 0, 0x7f), 0xff])
}

/**
 * Wrap a VISCA payload in the Sony VISCA-over-IP header:
 *   [type(2)] [payload length(2)] [sequence(4)] [payload...]
 * Type 0x0100 = VISCA command.
 */
export function viscaOverIp(payload: Uint8Array, sequence: number): Uint8Array {
  const len = payload.length
  const seq = sequence >>> 0
  const header = Uint8Array.from([
    0x01,
    0x00,
    (len >> 8) & 0xff,
    len & 0xff,
    (seq >> 24) & 0xff,
    (seq >> 16) & 0xff,
    (seq >> 8) & 0xff,
    seq & 0xff,
  ])
  const packet = new Uint8Array(header.length + payload.length)
  packet.set(header, 0)
  packet.set(payload, header.length)
  return packet
}
