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

export interface SessionSummary {
  id: string
  title?: string
  startedAt: string
  endedAt?: string
  storagePath: string
  profileId?: string
  calendarEventId?: string
  guests: string[]
  uploaded: boolean
  driveFolderId?: string
}

export type UploadState = 'idle' | 'uploading' | 'done' | 'error'

export interface UploadProgress {
  sessionId: string
  file: string
  fileIndex: number
  fileCount: number
  state: UploadState
  error?: string
}
