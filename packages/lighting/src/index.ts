import { get as httpGet } from 'node:http'
import { createConnection } from 'node:net'
import type { LightingConfig } from '@studiomaster/shared'

/**
 * Lighting control (docs/ARCHITECTURE.md §6.1, ADR-005). A generic adapter
 * interface with a FreeStyler implementation as the first backend. Additional
 * backends (Art-Net / sACN / OSC / DMX-USB) can be added behind the same
 * interface without touching the rest of the system.
 */
export interface LightingAdapter {
  readonly name: string
  /** Trigger a named cue (the value comes from StudioProfile.lighting.cues). */
  setCue(command: string): Promise<void>
  /** True if the controller appears reachable. */
  test(): Promise<boolean>
}

/**
 * FreeStyler exposes a built-in webserver on port 3332 for external control.
 * The exact button/cue request path is verified against the official wiki
 * during rollout; until then the cue command is treated as the request path
 * (or a full URL), which keeps the mapping configurable per studio profile.
 */
export class FreeStylerAdapter implements LightingAdapter {
  readonly name = 'freestyler'

  constructor(
    private readonly host: string,
    private readonly port: number,
  ) {}

  setCue(command: string): Promise<void> {
    const url = command.startsWith('http')
      ? command
      : `http://${this.host}:${this.port}/${command.replace(/^\//, '')}`
    return new Promise((resolve, reject) => {
      const req = httpGet(url, (res) => {
        res.resume() // drain
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`FreeStyler responded ${res.statusCode}`))
        } else {
          resolve()
        }
      })
      req.setTimeout(3000, () => req.destroy(new Error('FreeStyler request timed out')))
      req.once('error', reject)
    })
  }

  test(): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = createConnection({ host: this.host, port: this.port })
      const done = (ok: boolean) => {
        socket.destroy()
        resolve(ok)
      }
      socket.setTimeout(1500)
      socket.once('connect', () => done(true))
      socket.once('timeout', () => done(false))
      socket.once('error', () => done(false))
    })
  }
}

/** Build the adapter for a profile's lighting config, or null if unconfigured. */
export function createLightingAdapter(config: LightingConfig | undefined): LightingAdapter | null {
  if (!config) return null
  switch (config.adapter) {
    case 'freestyler':
      if (config.transport === 'midi') {
        throw new Error('FreeStyler MIDI transport is not implemented yet (use http)')
      }
      return new FreeStylerAdapter(config.host, config.port)
    default:
      // Art-Net / sACN / OSC / DMX-USB are planned; not yet implemented.
      return null
  }
}
