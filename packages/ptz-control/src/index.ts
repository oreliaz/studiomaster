import { createSocket, type Socket } from 'node:dgram'
import type { Camera, PtzMoveCommand, PtzPresetCommand, PtzZoomCommand } from '@studiomaster/shared'
import {
  panTiltCommand,
  presetRecallCommand,
  presetStoreCommand,
  viscaOverIp,
  zoomCommand,
} from './visca.js'

export * from './visca.js'

/**
 * PtzController — drives IP PTZ cameras from the app (docs §6.2.1). Phase 2
 * ships the VISCA-over-IP backend (the common protocol for Minrray + OBSBOT).
 * An obs-ptz bridge backend can be added later behind the same interface.
 */
export interface PtzController {
  move(cmd: PtzMoveCommand): Promise<void>
  stopMove(cameraId: string): Promise<void>
  zoom(cmd: PtzZoomCommand): Promise<void>
  recallPreset(cmd: PtzPresetCommand): Promise<void>
  storePreset(cmd: PtzPresetCommand): Promise<void>
  cameras(): { id: string; label: string }[]
  dispose(): void
}

interface CameraLink {
  id: string
  label: string
  host: string
  port: number
  seq: number
}

export class ViscaIpController implements PtzController {
  private readonly links = new Map<string, CameraLink>()
  private socket: Socket | null = null

  constructor(cameras: Camera[]) {
    for (const cam of cameras) {
      if (cam.control !== 'visca-ip') continue // other backends not yet implemented
      this.links.set(cam.id, {
        id: cam.id,
        label: cam.label,
        host: cam.host,
        port: cam.port,
        seq: 1,
      })
    }
  }

  cameras(): { id: string; label: string }[] {
    return [...this.links.values()].map((l) => ({ id: l.id, label: l.label }))
  }

  move(cmd: PtzMoveCommand): Promise<void> {
    return this.send(cmd.cameraId, panTiltCommand(cmd.pan, cmd.tilt, cmd.panSpeed, cmd.tiltSpeed))
  }

  stopMove(cameraId: string): Promise<void> {
    return this.send(cameraId, panTiltCommand('stop', 'stop'))
  }

  zoom(cmd: PtzZoomCommand): Promise<void> {
    return this.send(cmd.cameraId, zoomCommand(cmd.zoom, cmd.speed))
  }

  recallPreset(cmd: PtzPresetCommand): Promise<void> {
    return this.send(cmd.cameraId, presetRecallCommand(cmd.preset))
  }

  storePreset(cmd: PtzPresetCommand): Promise<void> {
    return this.send(cmd.cameraId, presetStoreCommand(cmd.preset))
  }

  dispose(): void {
    this.socket?.close()
    this.socket = null
  }

  private ensureSocket(): Socket {
    if (!this.socket) this.socket = createSocket('udp4')
    return this.socket
  }

  private send(cameraId: string, payload: Uint8Array): Promise<void> {
    const link = this.links.get(cameraId)
    if (!link) return Promise.reject(new Error(`unknown camera: ${cameraId}`))
    const packet = viscaOverIp(payload, link.seq)
    link.seq = (link.seq + 1) >>> 0
    return new Promise((resolve, reject) => {
      this.ensureSocket().send(packet, link.port, link.host, (err) =>
        err ? reject(err) : resolve(),
      )
    })
  }
}

/** Build a PTZ controller for a profile's cameras, or null if none are controllable. */
export function createPtzController(cameras: Camera[]): PtzController | null {
  const controllable = cameras.filter((c) => c.control === 'visca-ip')
  if (controllable.length === 0) return null
  return new ViscaIpController(cameras)
}
