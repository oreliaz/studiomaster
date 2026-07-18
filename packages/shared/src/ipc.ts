import type { ObsConnectionParams, ObsConnectionState, ObsRecordState } from './obs.js'

/**
 * Contract for the Electron IPC bridge exposed on `window.studiomaster`.
 * Both the preload script and the renderer import this so the surface stays
 * typed end to end.
 */

/** Channel names for main → renderer push events. */
export const IPC_EVENTS = {
  obsConnection: 'obs:connection-state',
  obsRecord: 'obs:record-state',
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
    /** Last connection params persisted by the store, if any. */
    getSavedConnection(): Promise<ObsConnectionParams | null>
  }
  /** Subscribe to a push event; returns an unsubscribe function. */
  onConnectionState(cb: (state: ObsConnectionState) => void): () => void
  onRecordState(cb: (state: ObsRecordState) => void): () => void
}
