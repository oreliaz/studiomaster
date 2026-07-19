/** Audio mixer + recording types (docs/ARCHITECTURE.md §6.2). */

export interface ObsInput {
  name: string
  kind: string
  muted: boolean
  /** Volume in dB (OBS reports -inf..0..+26). */
  volumeDb: number
}

/** Per-input peak levels (0..1), pushed from OBS InputVolumeMeters. */
export interface InputLevel {
  name: string
  /** Peak magnitude per channel, 0..1. */
  peak: number[]
}

export interface ObsScene {
  name: string
  index: number
}
