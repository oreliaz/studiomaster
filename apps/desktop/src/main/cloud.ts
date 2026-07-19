import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type {
  CalendarEvent,
  GoogleAuthStatus,
  SessionSummary,
  UploadProgress,
} from '@studiomaster/shared'
import type { Store } from './store.js'
import { GoogleAuthManager } from './google/auth.js'
import { CalendarClient } from './google/calendar.js'
import { DriveClient } from './google/drive.js'

/**
 * CloudService — Google Drive/Calendar orchestration + session recognition
 * (docs §6.3). Uploads a recording session's files to Drive and matches the
 * session to an overlapping calendar event (title/guests).
 */
export class CloudService {
  private readonly auth: GoogleAuthManager

  constructor(
    private readonly store: Store,
    private readonly emitProgress: (p: UploadProgress) => void,
  ) {
    this.auth = new GoogleAuthManager(store)
  }

  getAuthStatus(): GoogleAuthStatus {
    return this.auth.status()
  }
  setCredentials(clientId: string, clientSecret: string): GoogleAuthStatus {
    return this.auth.setCredentials(clientId, clientSecret)
  }
  connect(): Promise<GoogleAuthStatus> {
    return this.auth.connect()
  }
  disconnect(): void {
    this.auth.disconnect()
  }

  async listTodayEvents(): Promise<CalendarEvent[]> {
    const client = this.auth.getClient()
    if (!client) return []
    return new CalendarClient(client).listToday()
  }

  listSessions(): SessionSummary[] {
    return this.store.listSessions()
  }

  /** Attach the overlapping calendar event's title/guests to the session. */
  async recognizeSession(sessionId: string): Promise<SessionSummary | null> {
    const session = this.store.getSession(sessionId)
    if (!session) return null
    const client = this.auth.getClient()
    if (!client) return session

    const events = await new CalendarClient(client).listToday()
    const match = events.find((ev) => eventOverlaps(ev, session))
    if (!match) return session

    const updated: SessionSummary = {
      ...session,
      title: match.title,
      calendarEventId: match.id,
      guests: match.attendees,
    }
    this.store.saveSession(updated)
    return updated
  }

  /** Upload every file in the session folder to Drive under StudioMaster/<session>. */
  async uploadSession(sessionId: string): Promise<SessionSummary | null> {
    const session = this.store.getSession(sessionId)
    if (!session) return null
    const client = this.auth.getClient()
    if (!client) throw new Error('לא מחובר לגוגל')

    const drive = new DriveClient(client)
    const root = await drive.ensureFolder('StudioMaster')
    const folderName = session.title ? `${session.title} — ${session.startedAt}` : session.startedAt
    const folderId = await drive.ensureFolder(folderName, root)

    const files = readdirSync(session.storagePath).filter((f) =>
      statSync(join(session.storagePath, f)).isFile(),
    )

    for (let i = 0; i < files.length; i++) {
      const file = files[i]!
      this.emitProgress({
        sessionId,
        file,
        fileIndex: i + 1,
        fileCount: files.length,
        state: 'uploading',
      })
      try {
        await drive.uploadFile(join(session.storagePath, file), folderId)
      } catch (err) {
        this.emitProgress({
          sessionId,
          file,
          fileIndex: i + 1,
          fileCount: files.length,
          state: 'error',
          error: err instanceof Error ? err.message : String(err),
        })
        throw err
      }
    }

    this.emitProgress({
      sessionId,
      file: '',
      fileIndex: files.length,
      fileCount: files.length,
      state: 'done',
    })
    const updated: SessionSummary = { ...session, uploaded: true, driveFolderId: folderId }
    this.store.saveSession(updated)
    return updated
  }
}

/** True if the session's start falls within (or near) the event's window. */
function eventOverlaps(ev: CalendarEvent, session: SessionSummary): boolean {
  const evStart = Date.parse(ev.start)
  const evEnd = Date.parse(ev.end)
  const sStart = Date.parse(session.startedAt)
  if (Number.isNaN(evStart) || Number.isNaN(evEnd) || Number.isNaN(sStart)) return false
  const sEnd = session.endedAt ? Date.parse(session.endedAt) : sStart
  // 30-minute tolerance around the event so a slightly early/late start still matches.
  const pad = 30 * 60 * 1000
  return sStart <= evEnd + pad && sEnd >= evStart - pad
}
