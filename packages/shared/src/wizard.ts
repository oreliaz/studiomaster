/**
 * Studio opening wizard (docs/ARCHITECTURE.md §6.1). The launcher opens the
 * profile's programs in order, optionally sets the lighting standby cue, then
 * the guided checklist runs before the studio is declared ready.
 */

export type LaunchStepStatus = 'pending' | 'running' | 'ok' | 'failed' | 'skipped'

/** A single step in the opening sequence (usually one program). */
export interface LaunchStep {
  id: string
  label: string
  status: LaunchStepStatus
  required: boolean
  detail?: string
}

export type WizardPhase =
  | 'idle'
  | 'launching' // opening programs in order
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

export const initialWizardState: WizardState = {
  phase: 'idle',
  steps: [],
  checklist: [],
}
