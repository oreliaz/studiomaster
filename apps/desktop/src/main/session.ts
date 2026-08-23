import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import { msToTimecode, type ReviewMarker, type ReviewMarkerCategory } from '@studiomaster/shared'
import type { Store } from './store.js'

/**
 * RecordingSessionManager — owns the lifecycle of a recording session and the
 * review/timecode document (docs §6.2.2). A session starts when OBS begins
 * recording and ends when it stops; markers dropped via the hotkey attach to it.
 */

const CATEGORY_LABELS: Record<ReviewMarkerCategory, string> = {
  fix: 'תיקון',
  highlight: 'הדגשה',
  chapter: 'פרק',
  note: 'הערה',
  intro: 'פתיח',
}

export interface RecordingSession {
  id: string
  storagePath: string
  startedAt: string
}

export class RecordingSessionManager {
  private current: RecordingSession | null = null

  constructor(private readonly store: Store) {}

  get session(): RecordingSession | null {
    return this.current
  }

  start(profileId?: string, podcastId?: string): RecordingSession {
    const startedAt = new Date().toISOString()
    const stamp = startedAt.replace(/[:.]/g, '-')
    const storagePath = join(app.getPath('userData'), 'recordings', stamp)
    mkdirSync(storagePath, { recursive: true })
    this.current = { id: randomUUID(), storagePath, startedAt }
    this.store.saveSession({
      id: this.current.id,
      startedAt,
      storagePath,
      profileId,
      podcastId,
      guests: [],
      uploaded: false,
    })
    this.writeReviewHeader()
    return this.current
  }

  end(): void {
    if (this.current) {
      const record = this.store.getSession(this.current.id)
      if (record) this.store.saveSession({ ...record, endedAt: new Date().toISOString() })
    }
    this.current = null
  }

  /** Add a review marker at `tcMs`; null if no recording session is active. */
  addMarker(category: ReviewMarkerCategory, tcMs: number, note?: string): ReviewMarker | null {
    if (!this.current) return null
    const marker: ReviewMarker = {
      id: randomUUID(),
      sessionId: this.current.id,
      tcMs,
      category,
      note,
      createdAt: new Date().toISOString(),
    }
    this.store.addMarker(marker)
    const count = this.store.listMarkers(this.current.id).length
    this.appendReviewRow(count, marker)
    return marker
  }

  private writeReviewHeader(): void {
    if (!this.current) return
    const header = `# מסמך תיקונים — ${this.current.startedAt}\n\n| # | timecode | category | note |\n|---|----------|----------|------|\n`
    appendFileSync(join(this.current.storagePath, 'review.md'), header, 'utf8')
  }

  private appendReviewRow(index: number, marker: ReviewMarker): void {
    if (!this.current) return
    const row = `| ${index} | ${msToTimecode(marker.tcMs)} | ${CATEGORY_LABELS[marker.category]} | ${
      marker.note ?? ''
    } |\n`
    appendFileSync(join(this.current.storagePath, 'review.md'), row, 'utf8')
  }
}
