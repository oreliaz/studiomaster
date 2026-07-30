import type { Podcast, ReviewMarker, ReviewMarkerCategory, StudioProfile } from './model.js'
import type { ObsInput, ObsScene, InputLevel } from './mixer.js'
import type { ObsConnectionParams, ObsConnectionState, ObsRecordState } from './obs.js'
import type { PtzMoveCommand, PtzPresetCommand, PtzZoomCommand } from './ptz.js'
import type {
  CalendarEvent,
  GoogleAuthStatus,
  RunMode,
  SessionEditPatch,
  SessionSummary,
  UploadProgress,
} from './cloud.js'
import type { AiJobResult, AiProgress } from './ai.js'
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
  mixerLevels: 'mixer:levels',
  markerAdded: 'markers:added',
  uploadProgress: 'cloud:upload-progress',
  aiProgress: 'ai:progress',
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
    /** Configure OBS for separate-audio-per-mic recording. Returns routed mics. */
    configureSeparateAudio(): Promise<{ mics: string[]; tracks: number }>
  }
  profiles: {
    list(): Promise<StudioProfile[]>
    get(id: string): Promise<StudioProfile | null>
    save(profile: StudioProfile): Promise<StudioProfile>
    remove(id: string): Promise<void>
  }
  podcasts: {
    list(): Promise<Podcast[]>
    get(id: string): Promise<Podcast | null>
    save(podcast: Podcast): Promise<Podcast>
    remove(id: string): Promise<void>
    /** The show currently selected for recording (persisted). */
    getActive(): Promise<string | null>
    setActive(id: string): Promise<void>
  }
  wizard: {
    start(profileId: string): Promise<WizardState>
    getState(): Promise<WizardState>
    setChecklistItem(index: number, done: boolean): Promise<WizardState>
    finishChecklist(): Promise<WizardState>
    reset(): Promise<WizardState>
  }
  mixer: {
    listInputs(): Promise<ObsInput[]>
    setMute(inputName: string, muted: boolean): Promise<void>
    setVolumeDb(inputName: string, db: number): Promise<void>
    listScenes(): Promise<{ scenes: ObsScene[]; current: string | null }>
    setScene(name: string): Promise<void>
  }
  ptz: {
    move(cmd: PtzMoveCommand): Promise<void>
    stop(cameraId: string): Promise<void>
    zoom(cmd: PtzZoomCommand): Promise<void>
    recallPreset(cmd: PtzPresetCommand): Promise<void>
    storePreset(cmd: PtzPresetCommand): Promise<void>
    listCameras(): Promise<{ id: string; label: string }[]>
  }
  markers: {
    /** Drop a review marker at the current OBS record timecode. */
    add(category: ReviewMarkerCategory, note?: string): Promise<ReviewMarker | null>
    list(): Promise<ReviewMarker[]>
    /** All markers for a specific (finished) session — for the post-edit review. */
    listForSession(sessionId: string): Promise<ReviewMarker[]>
    updateNote(id: string, note: string): Promise<void>
  }
  sessions: {
    /** Update per-episode review fields (notes, intro/outro overrides). */
    updateEdit(sessionId: string, patch: SessionEditPatch): Promise<SessionSummary | null>
    /** Open the recording's folder in the OS file manager. Returns '' on success. */
    openFolder(sessionId: string): Promise<string>
  }
  cloud: {
    getAuthStatus(): Promise<GoogleAuthStatus>
    setCredentials(clientId: string, clientSecret: string): Promise<GoogleAuthStatus>
    connect(): Promise<GoogleAuthStatus>
    disconnect(): Promise<void>
    listTodayEvents(): Promise<CalendarEvent[]>
    listSessions(): Promise<SessionSummary[]>
    /** Match a session to an overlapping calendar event and store metadata. */
    recognizeSession(sessionId: string): Promise<SessionSummary | null>
    /** Upload all files in a session's folder to Drive (progress via event). */
    uploadSession(sessionId: string): Promise<SessionSummary | null>
  }
  ai: {
    /** Run the autonomous editing pipeline over a recording session. */
    processSession(sessionId: string): Promise<AiJobResult>
    getRunMode(): Promise<RunMode>
    setRunMode(mode: RunMode): Promise<void>
  }
  onAiProgress(cb: (progress: AiProgress) => void): () => void
  onConnectionState(cb: (state: ObsConnectionState) => void): () => void
  onRecordState(cb: (state: ObsRecordState) => void): () => void
  onWizardState(cb: (state: WizardState) => void): () => void
  onMixerLevels(cb: (levels: InputLevel[]) => void): () => void
  onMarkerAdded(cb: (marker: ReviewMarker) => void): () => void
  onUploadProgress(cb: (progress: UploadProgress) => void): () => void
}
