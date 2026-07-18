/** OBS connection + recording types shared between main process and renderer. */

export interface ObsConnectionParams {
  url: string // e.g. ws://127.0.0.1:4455
  password?: string
}

export type ObsConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface ObsConnectionState {
  status: ObsConnectionStatus
  /** obs-websocket negotiated RPC version, when connected. */
  rpcVersion?: number
  obsVersion?: string
  error?: string
}

export interface ObsRecordState {
  active: boolean
  paused: boolean
  /** OBS output timecode, e.g. "00:03:12.400". */
  timecode: string
  /** Convenience: timecode parsed to milliseconds. */
  timecodeMs: number
  /** Output file path, present when recording stops. */
  outputPath?: string
}

/** Parse an OBS timecode string ("HH:MM:SS.mmm") into milliseconds. */
export function timecodeToMs(timecode: string): number {
  const match = /^(\d+):(\d{2}):(\d{2})\.(\d{1,3})$/.exec(timecode.trim())
  if (!match) return 0
  const [, h = '0', m = '0', s = '0', frac = '0'] = match
  const millis = Number(frac.padEnd(3, '0'))
  return (Number(h) * 3600 + Number(m) * 60 + Number(s)) * 1000 + millis
}

/** Format milliseconds back into "HH:MM:SS.mmm". */
export function msToTimecode(ms: number): string {
  const clamped = Math.max(0, Math.floor(ms))
  const h = Math.floor(clamped / 3_600_000)
  const m = Math.floor((clamped % 3_600_000) / 60_000)
  const s = Math.floor((clamped % 60_000) / 1000)
  const millis = clamped % 1000
  const pad = (n: number, len = 2) => n.toString().padStart(len, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(millis, 3)}`
}
