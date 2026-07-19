import type { StudioProfile } from './model.js'
import type { ObsConnectionParams, ObsConnectionState, ObsRecordState } from './obs.js'
import type { WizardState } from './wizard.js'

/**
 * Contract for the Electron IPC bridge exposed on `window.studiomaster`.
 * Both the preload script and the renderer import this so the surface stays
 * typed end to end.
 */

/** Channel names for main → renderer push events. */
export const IPC_EVENTS = {
  obsConnection: 'obs:connection-state',
  obsRecord: 'obs:record-state',
  wizard: 'wizard:state',
} as const

export interface StudioMasterApi {
  obs: {
    connect(params: ObsConnectionParams): Promise<ObsConnectionState>
    disconnect(): Promise<void>
    getConnectionState(): Promise<ObsConnectionState>
    startRecord(): Promise<ObsRecordState>
    stopRecord(): Promise<ObsRecordState>
    toggleRecord(): Promise<ObsRecordState>
    getRecordState(): Promise<ObsRecordState>
    getSavedConnection(): Promise<ObsConnectionParams | null>
  }
  profiles: {
    list(): Promise<StudioProfile[]>
    get(id: string): Promise<StudioProfile | null>
    /** Create or update a profile; returns the stored (validated) profile. */
    save(profile: StudioProfile): Promise<StudioProfile>
    remove(id: string): Promise<void>
  }
  wizard: {
    /** Run the opening sequence for a profile (opens programs in order). */
    start(profileId: string): Promise<WizardState>
    getState(): Promise<WizardState>
    setChecklistItem(index: number, done: boolean): Promise<WizardState>
    /** Advance from the checklist phase to "ready". */
    finishChecklist(): Promise<WizardState>
    reset(): Promise<WizardState>
  }
  /** Subscribe to a push event; returns an unsubscribe function. */
  onConnectionState(cb: (state: ObsConnectionState) => void): () => void
  onRecordState(cb: (state: ObsRecordState) => void): () => void
  onWizardState(cb: (state: WizardState) => void): () => void
}
