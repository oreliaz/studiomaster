import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  emptyKnowledgeBase,
  mergeKnowledgeBase,
  type CalendarEvent,
  type GoogleAuthStatus,
  type KnowledgeBase,
  type SessionSummary,
  type UploadProgress,
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

  /**
   * Sync the shared knowledge base with the Drive copy: pull the shared file,
   * merge it with `local` (last-write-wins per item), push the merged result
   * back, and return it. The file lives at StudioMaster/knowledge-base.json;
   * to share across users, share that Drive folder with them.
   */
  async syncKnowledgeBase(local: KnowledgeBase): Promise<KnowledgeBase> {
    const client = this.auth.getClient()
    if (!client) throw new Error('לא מחובר לגוגל')
    const drive = new DriveClient(client)
    const root = await drive.ensureFolder('StudioMaster')

    let remote = emptyKnowledgeBase()
    const fileId = await drive.findFile('knowledge-base.json', root)
    if (fileId) {
      try {
        remote = JSON.parse(await drive.downloadText(fileId)) as KnowledgeBase
      } catch {
        // corrupt/empty remote — treat as empty and let the merge heal it
      }
    }
    const merged = mergeKnowledgeBase(local, remote)
    merged.updatedAt = new Date().toISOString()
    await drive.writeJson('knowledge-base.json', root, JSON.stringify(merged, null, 2))
    return merged
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

    // Everything in the session folder (edit, brief, audio tracks, reels…) plus
    // the raw recording itself — which for OBS captures lives outside the folder.
    const paths = readdirSync(session.storagePath)
      .map((f) => join(session.storagePath, f))
      .filter((p) => statSync(p).isFile())
    if (
      session.capturePath &&
      existsSync(session.capturePath) &&
      dirname(session.capturePath) !== session.storagePath
    ) {
      paths.push(session.capturePath) // raw material
    }

    for (let i = 0; i < paths.length; i++) {
      const path = paths[i]!
      const file = path.split(/[\\/]/).pop() ?? path
      this.emitProgress({
        sessionId,
        file,
        fileIndex: i + 1,
        fileCount: paths.length,
        state: 'uploading',
      })
      try {
        await drive.uploadFile(path, folderId)
      } catch (err) {
        this.emitProgress({
          sessionId,
          file,
          fileIndex: i + 1,
          fileCount: paths.length,
          state: 'error',
          error: err instanceof Error ? err.message : String(err),
        })
        throw err
      }
    }

    this.emitProgress({
      sessionId,
      file: '',
      fileIndex: paths.length,
      fileCount: paths.length,
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
