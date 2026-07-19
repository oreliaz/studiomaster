/** PTZ camera control types (docs/ARCHITECTURE.md §6.2.1, ADR-006). */

export type PanDir = 'left' | 'right' | 'stop'
export type TiltDir = 'up' | 'down' | 'stop'
export type ZoomDir = 'in' | 'out' | 'stop'

export interface PtzMoveCommand {
  cameraId: string
  pan: PanDir
  tilt: TiltDir
  /** 0x01–0x18 for VISCA; clamped by the backend. */
  panSpeed?: number
  tiltSpeed?: number
}

export interface PtzZoomCommand {
  cameraId: string
  zoom: ZoomDir
  speed?: number
}

export interface PtzPresetCommand {
  cameraId: string
  preset: number
}
