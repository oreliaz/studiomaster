import { z } from 'zod'

/**
 * Core data model for StudioMaster (docs/ARCHITECTURE.md §7).
 *
 * The zod schemas are the source of truth: the TypeScript types are inferred
 * from them so validation and typing never drift apart. Studio profiles are
 * user-authored JSON, so they are validated on load.
 */

// ─── Studio Launcher (requirement 1) ────────────────────────────────────────

/** An external program the launcher starts when the studio opens. */
export const programSchema = z.object({
  name: z.string(),
  path: z.string(),
  args: z.array(z.string()).optional(),
  /** How to know the program is ready before moving on. */
  waitFor: z
    .union([
      z.literal('spawn'), // resolve once the process is spawned
      z.literal('websocket'), // OBS obs-websocket reachable (port 4455)
      z.string().regex(/^delay:\d+$/), // fixed wait, e.g. "delay:3000" (ms)
      z.string().regex(/^port:\d+$/), // TCP port reachable, e.g. "port:3332"
      z.string().regex(/^window:.+/), // process/window present, e.g. "window:FreeStyler"
    ])
    .default('spawn'),
  required: z.boolean().default(false),
})
export type Program = z.infer<typeof programSchema>

/** FreeStyler is the first lighting adapter (docs ADR-005). */
export const lightingConfigSchema = z.object({
  adapter: z.enum(['freestyler', 'artnet', 'sacn', 'osc', 'dmx-usb']).default('freestyler'),
  transport: z.enum(['http', 'midi']).default('http'),
  host: z.string().default('127.0.0.1'),
  port: z.number().int().positive().default(3332),
  /** Named cues → adapter-specific command (e.g. "button:12"). */
  cues: z.record(z.string(), z.string()).default({}),
})
export type LightingConfig = z.infer<typeof lightingConfigSchema>

export const obsConfigSchema = z.object({
  sceneCollection: z.string().optional(),
  startScene: z.string().optional(),
  /** Audio track index (1–6) → source name, for multi-track recording. */
  audioTracks: z.record(z.string(), z.string()).default({}),
})
export type ObsConfig = z.infer<typeof obsConfigSchema>

/** PTZ camera over IP — Minrray / OBSBOT (docs ADR-006). */
export const cameraSchema = z.object({
  id: z.string(),
  label: z.string(),
  brand: z.enum(['minrray', 'obsbot', 'generic']).default('generic'),
  control: z.enum(['visca-ip', 'obs-ptz-bridge', 'onvif']).default('visca-ip'),
  host: z.string(),
  port: z.number().int().positive().default(52381),
  /** Named preset → camera preset index. */
  presets: z.record(z.string(), z.number().int().nonnegative()).default({}),
})
export type Camera = z.infer<typeof cameraSchema>

/** UI/output language for a profile's deliverables (Hebrew + English). */
export const languageSchema = z.enum(['he', 'en'])
export type Language = z.infer<typeof languageSchema>

/**
 * The pre-recording "questionnaire" (שאלון) — what the studio wants produced
 * from an episode. Saved on the profile so it repeats every recording
 * (docs §6.4). Drives the vendored editing skills (basic-editing-he +
 * podcast-reels-he). `reelStyle`: 'simple' = פשוט, 'premium' = כריסלייט.
 */
export const deliverableTemplateSchema = z.object({
  editType: z.enum(['none', 'basic', 'reels', 'both']).default('basic'),
  language: languageSchema.default('he'),
  // Basic editing (full episode).
  intro: z.string().optional(),
  outro: z.string().optional(),
  targetLufs: z.number().default(-16),
  // Reels.
  reelsCount: z.number().int().nonnegative().default(15),
  reelStyle: z.enum(['simple', 'premium']).default('simple'),
  reelMinSec: z.number().int().positive().default(40),
  reelMaxSec: z.number().int().positive().default(70),
  /** How aggressively to trim internal silence/pauses in the basic edit. */
  trimSilence: z.enum(['off', 'light', 'medium', 'aggressive']).default('medium'),
  // Metadata deliverables (independent of the edit type above).
  title: z.boolean().default(false),
  description: z.boolean().default(false),
  thumbnail: z.boolean().default(false),
  // Delivery.
  socialUpload: z.boolean().default(false),
})
export type DeliverableTemplate = z.infer<typeof deliverableTemplateSchema>

/** A fully-defaulted deliverables template (schema defaults applied). */
export function defaultDeliverables(): DeliverableTemplate {
  return deliverableTemplateSchema.parse({})
}

/** Recording/routing options — an equipment property of the studio. */
export const captureConfigSchema = z.object({
  /** Record each microphone to its own OBS audio track and split after stop. */
  multitrack: z.boolean().default(false),
  separateChannels: z.boolean().default(false),
  routed: z.boolean().default(true),
})
export type CaptureConfig = z.infer<typeof captureConfigSchema>

/** When the autonomous editor runs after a recording (mirrors cloud.RunMode). */
export const runModeSchema = z.enum(['ask', 'now', 'nightly'])

/**
 * A **Studio** = a physical room and its equipment + startup sequence
 * (requirement 1). What programs to open and in what order, lighting, PTZ
 * cameras, and how audio is captured. Equipment-level only — *what* gets
 * produced from a recording lives on the Podcast, so one studio can host many
 * different shows. `deliverables` is retained for migration of old profiles.
 */
export const studioProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  programs: z.array(programSchema).default([]),
  lighting: lightingConfigSchema.optional(),
  obs: obsConfigSchema.default({ audioTracks: {} }),
  cameras: z.array(cameraSchema).default([]),
  capture: captureConfigSchema.default({}),
  /** @deprecated moved to Podcast; kept so existing profiles migrate cleanly. */
  deliverables: deliverableTemplateSchema.optional(),
  /** Guided wizard steps that need a human eye. */
  checklist: z.array(z.string()).default([]),
})
export type StudioProfile = z.infer<typeof studioProfileSchema>

/**
 * A **Podcast** (show) = a reusable deliverables profile: content language,
 * intro/outro, edit type, reels, and *when* the autonomous editor runs. Chosen
 * at record time, independent of which studio the episode is recorded in, so
 * the same show produces the same outputs wherever it's shot.
 */
export const podcastSchema = z.object({
  id: z.string(),
  name: z.string(),
  deliverables: deliverableTemplateSchema.default({}),
  /** Post-recording treatment timing for this show. */
  runMode: runModeSchema.default('ask'),
})
export type Podcast = z.infer<typeof podcastSchema>

// ─── Session & media ─────────────────────────────────────────────────────────

export type SessionStatus = 'idle' | 'preparing' | 'ready' | 'recording' | 'ended'

export interface Session {
  id: string
  profileId: string
  calendarEventId?: string
  title: string
  guests: string[]
  startedAt?: string // ISO 8601
  endedAt?: string
  status: SessionStatus
  storagePath?: string
}

export type MediaAssetType = 'mix' | 'cam' | 'track' | 'transcript' | 'review-doc' | 'deliverable'

export interface MediaAsset {
  id: string
  sessionId: string
  type: MediaAssetType
  path: string
  driveFileId?: string
  durationMs?: number
  meta?: Record<string, unknown>
}

// ─── Timeline & review markers (requirement 2++) ─────────────────────────────

export type TimelineEventKind = 'scene' | 'speaker' | 'record' | 'marker' | 'camera'

export interface TimelineEvent {
  id: string
  sessionId: string
  tMs: number // offset from recording start
  kind: TimelineEventKind
  data?: Record<string, unknown>
}

export type ReviewMarkerCategory = 'fix' | 'highlight' | 'chapter' | 'note' | 'intro'

/** A timecode marker dropped by the review hotkey (docs §6.2.2). */
export interface ReviewMarker {
  id: string
  sessionId: string
  tcMs: number // OBS record timecode in ms
  category: ReviewMarkerCategory
  note?: string
  createdAt: string // ISO 8601
}
