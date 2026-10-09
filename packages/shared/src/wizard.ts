/**
 * Studio opening wizard (docs/ARCHITECTURE.md §6.1) — the home screen's
 * "start everything" button. The launcher opens the profile's programs in
 * order, connects to OBS, optionally sets the lighting standby cue, then the
 * guided checklist runs before the studio is declared ready.
 */

export type LaunchStepStatus = 'pending' | 'running' | 'ok' | 'failed' | 'skipped'

/**
 * What a step starts: one of the studio's programs, or one of StudioMaster's
 * own components (the renderer shows those with a translated label).
 */
export type LaunchStepKind = 'program' | 'obs' | 'lighting'

/** A single step in the opening sequence (usually one program). */
export interface LaunchStep {
  id: string
  label: string
  status: LaunchStepStatus
  required: boolean
  detail?: string
  /** Defaults to 'program'. */
  kind?: LaunchStepKind
  /** The program was already open, so it was not started a second time. */
  alreadyRunning?: boolean
}

export type WizardPhase =
  | 'idle'
  | 'launching' // opening programs in order
  | 'connecting' // connecting to OBS (obs-websocket)
  | 'lighting' // setting the standby cue
  | 'checklist' // guided human checks
  | 'ready' // studio is ready to record
  | 'failed'

export interface ChecklistItemState {
  text: string
  done: boolean
}

export interface WizardState {
  phase: WizardPhase
  profileId?: string
  steps: LaunchStep[]
  checklist: ChecklistItemState[]
  error?: string
}

/** Home-screen preferences for the "start everything" button. */
export interface WizardPrefs {
  /** Run the whole sequence automatically every time StudioMaster opens. */
  autoStart: boolean
  /** The studio that was started last (pre-selected on the home screen). */
  profileId: string | null
}

export const initialWizardState: WizardState = {
  phase: 'idle',
  steps: [],
  checklist: [],
}
