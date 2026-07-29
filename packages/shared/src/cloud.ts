/** Google Drive + Calendar + session recognition types (docs §6.3). */

export interface GoogleAuthStatus {
  connected: boolean
  email?: string
  /** True when a client id/secret has been configured. */
  configured: boolean
  error?: string
}

export interface CalendarEvent {
  id: string
  title: string
  start: string // ISO 8601
  end: string
  attendees: string[]
  description?: string
}

export type EditStatus = 'idle' | 'pending' | 'running' | 'done' | 'error'

export interface SessionSummary {
  id: string
  title?: string
  startedAt: string
  endedAt?: string
  storagePath: string
  profileId?: string
  /** The Podcast (show) this episode belongs to — drives editing deliverables. */
  podcastId?: string
  calendarEventId?: string
  guests: string[]
  uploaded: boolean
  driveFolderId?: string
  /** The OBS recording file, captured on record stop (input for editing). */
  capturePath?: string
  editStatus?: EditStatus
  /** Short human summary of the last edit run. */
  editSummary?: string
}

/** When the autonomous editor runs after a recording (docs §6.4, transcript). */
export type RunMode = 'ask' | 'now' | 'nightly'

export type UploadState = 'idle' | 'uploading' | 'done' | 'error'

export interface UploadProgress {
  sessionId: string
  file: string
  fileIndex: number
  fileCount: number
  state: UploadState
  error?: string
}
