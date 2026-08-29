/**
 * Types for the timeline editor (docs — "Premiere-like" review). A project is
 * a structured, read/write view over the on-disk edit artifacts of one session:
 *
 *   basic edit  -> <session>/work/edit_plan.json (kept ranges) + config.json +
 *                  audio_channels.json + transcript.json
 *   reel        -> <session>/reel_specs.txt (one clip window) + captions/<NN>.json
 *
 * The renderer edits these to millisecond precision and asks the main process to
 * write them back and re-render — so the graphical editor drives the very same
 * pipeline the automatic editor uses.
 */

/** A [start,end) span in SECONDS (float — ms precision is start*1000 rounded). */
export interface EditorRange {
  start: number
  end: number
}

export interface EditorTranscriptSeg {
  start: number
  end: number
  text: string
}

/** One shared post-mix processing effect (highpass, denoise, level, compress). */
export interface EditorAudioEffect {
  id: 'highpass' | 'denoise' | 'dynaudnorm' | 'acompressor'
  label: string
  enabled: boolean
  /** Human-readable summary of the effect's parameters (e.g. "80 Hz"). */
  detail: string
}

/** One source audio track (OBS stream): the mixdown or a single microphone. */
export interface EditorAudioChannel {
  index: number
  label: string
  /** Kept in the edit (true) or dropped — the mixdown and unused mics are off. */
  active: boolean
  /** Static balance gain applied to this channel, in dB. */
  gainDb: number
  /** Measured average / peak level (dBFS), if analysed. */
  meanDb?: number | null
  maxDb?: number | null
  /** True for the mixed-down track (stream 0) — normally dropped. */
  isMixdown: boolean
}

export interface EditorConfig {
  targetLufs: number
  trimSilence: 'off' | 'light' | 'medium' | 'aggressive'
  intro?: string
  outro?: string
}

/** A caption line (reel), in CLIP-relative seconds. */
export interface EditorCaption {
  start: number
  end: number
  text: string
}

export type EditorMode = 'basic' | 'reel'

/** The full editable project for one session + target. */
export interface EditorProject {
  sessionId: string
  mode: EditorMode
  /** For a reel: its two-digit id (e.g. "01") and rendered/clip files. */
  reelId?: string
  reelSlug?: string
  title: string
  /** Source recording path (basic) or the clip source. */
  source: string
  /** sm-media:// URL the <video> preview loads (source for basic, clip for reel). */
  mediaUrl?: string
  /** sm-media:// URL of the rendered output, if one exists. */
  outputUrl?: string
  hasOutput: boolean
  fps: number
  /** Full source duration in seconds. */
  durationSec: number
  /** Basic: kept ranges (removed = the gaps between them). */
  kept: EditorRange[]
  /** Reel: the single clip window in source time. */
  window?: EditorRange
  /** Reel hook line (overlaid at the top of the reel). */
  hook?: string
  transcript: EditorTranscriptSeg[]
  captions?: EditorCaption[]
  channels: EditorAudioChannel[]
  effects: EditorAudioEffect[]
  config: EditorConfig
  /** Warnings surfaced while loading (missing transcript, not yet edited, …). */
  notes: string[]
}

/** The subset the editor writes back before a re-render. */
export interface EditorSave {
  sessionId: string
  mode: EditorMode
  reelId?: string
  kept?: EditorRange[]
  window?: EditorRange
  hook?: string
  channels?: { index: number; active: boolean; gainDb: number }[]
  effects?: { id: EditorAudioEffect['id']; enabled: boolean }[]
  config?: Partial<EditorConfig>
}

/** One entry in a session's "advanced edit" menu (basic + each rendered reel). */
export interface EditorTarget {
  mode: EditorMode
  reelId?: string
  label: string
  /** True when the artifacts to open this target already exist on disk. */
  ready: boolean
}
