import { join } from 'node:path'
import { app } from 'electron'
import Database from 'better-sqlite3'
import {
  studioProfileSchema,
  type ObsConnectionParams,
  type ReviewMarker,
  type ReviewMarkerCategory,
  type StudioProfile,
} from '@studiomaster/shared'

/**
 * Local persistence (docs/ARCHITECTURE.md §7). Phase 1 adds studio profiles on
 * top of the Phase 0 settings store. SQLite is a native module; if it fails to
 * load (e.g. not rebuilt for the current Electron ABI) the app degrades to an
 * in-memory store rather than crashing, so the rest of the app still works.
 */

interface SettingsRow {
  value: string
}
interface ProfileRow {
  json: string
}

const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS settings (
     key   TEXT PRIMARY KEY,
     value TEXT NOT NULL
   );`,
  `CREATE TABLE IF NOT EXISTS sessions (
     id            TEXT PRIMARY KEY,
     profile_id    TEXT,
     title         TEXT,
     status        TEXT NOT NULL,
     started_at    TEXT,
     ended_at      TEXT,
     storage_path  TEXT
   );`,
  `CREATE TABLE IF NOT EXISTS profiles (
     id   TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     json TEXT NOT NULL
   );`,
  `CREATE TABLE IF NOT EXISTS markers (
     id         TEXT PRIMARY KEY,
     session_id TEXT NOT NULL,
     tc_ms      INTEGER NOT NULL,
     category   TEXT NOT NULL,
     note       TEXT,
     created_at TEXT NOT NULL
   );`,
]

export interface Store {
  getSetting(key: string): string | null
  setSetting(key: string, value: string): void
  getSavedConnection(): ObsConnectionParams | null
  saveConnection(params: ObsConnectionParams): void
  listProfiles(): StudioProfile[]
  getProfile(id: string): StudioProfile | null
  saveProfile(profile: StudioProfile): StudioProfile
  deleteProfile(id: string): void
  addMarker(marker: ReviewMarker): void
  listMarkers(sessionId?: string): ReviewMarker[]
  updateMarkerNote(id: string, note: string): void
}

const OBS_CONNECTION_KEY = 'obs.connection'

/** Parse + validate a stored profile; returns null if it no longer matches. */
function parseProfile(json: string): StudioProfile | null {
  try {
    return studioProfileSchema.parse(JSON.parse(json))
  } catch {
    return null
  }
}

class SqliteStore implements Store {
  constructor(private readonly db: Database.Database) {
    db.pragma('journal_mode = WAL')
    for (const migration of MIGRATIONS) db.exec(migration)
  }

  getSetting(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      SettingsRow | undefined
    return row?.value ?? null
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run(key, value)
  }

  getSavedConnection(): ObsConnectionParams | null {
    const raw = this.getSetting(OBS_CONNECTION_KEY)
    if (!raw) return null
    try {
      return JSON.parse(raw) as ObsConnectionParams
    } catch {
      return null
    }
  }

  saveConnection(params: ObsConnectionParams): void {
    this.setSetting(OBS_CONNECTION_KEY, JSON.stringify(params))
  }

  listProfiles(): StudioProfile[] {
    const rows = this.db.prepare('SELECT json FROM profiles ORDER BY name').all() as ProfileRow[]
    return rows.map((r) => parseProfile(r.json)).filter((p): p is StudioProfile => p !== null)
  }

  getProfile(id: string): StudioProfile | null {
    const row = this.db.prepare('SELECT json FROM profiles WHERE id = ?').get(id) as
      ProfileRow | undefined
    return row ? parseProfile(row.json) : null
  }

  saveProfile(profile: StudioProfile): StudioProfile {
    const validated = studioProfileSchema.parse(profile)
    this.db
      .prepare(
        'INSERT INTO profiles (id, name, json) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, json = excluded.json',
      )
      .run(validated.id, validated.name, JSON.stringify(validated))
    return validated
  }

  deleteProfile(id: string): void {
    this.db.prepare('DELETE FROM profiles WHERE id = ?').run(id)
  }

  addMarker(marker: ReviewMarker): void {
    this.db
      .prepare(
        'INSERT INTO markers (id, session_id, tc_ms, category, note, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        marker.id,
        marker.sessionId,
        marker.tcMs,
        marker.category,
        marker.note ?? null,
        marker.createdAt,
      )
  }

  listMarkers(sessionId?: string): ReviewMarker[] {
    const rows = sessionId
      ? (this.db
          .prepare('SELECT * FROM markers WHERE session_id = ? ORDER BY tc_ms')
          .all(sessionId) as MarkerRow[])
      : (this.db.prepare('SELECT * FROM markers ORDER BY created_at').all() as MarkerRow[])
    return rows.map(rowToMarker)
  }

  updateMarkerNote(id: string, note: string): void {
    this.db.prepare('UPDATE markers SET note = ? WHERE id = ?').run(note, id)
  }
}

interface MarkerRow {
  id: string
  session_id: string
  tc_ms: number
  category: string
  note: string | null
  created_at: string
}

function rowToMarker(r: MarkerRow): ReviewMarker {
  return {
    id: r.id,
    sessionId: r.session_id,
    tcMs: r.tc_ms,
    category: r.category as ReviewMarkerCategory,
    note: r.note ?? undefined,
    createdAt: r.created_at,
  }
}

/** Fallback used when the native SQLite module is unavailable. */
class MemoryStore implements Store {
  private readonly settings = new Map<string, string>()
  private readonly profiles = new Map<string, StudioProfile>()
  private readonly markers: ReviewMarker[] = []

  getSetting(key: string): string | null {
    return this.settings.get(key) ?? null
  }
  setSetting(key: string, value: string): void {
    this.settings.set(key, value)
  }
  getSavedConnection(): ObsConnectionParams | null {
    const raw = this.getSetting(OBS_CONNECTION_KEY)
    return raw ? (JSON.parse(raw) as ObsConnectionParams) : null
  }
  saveConnection(params: ObsConnectionParams): void {
    this.setSetting(OBS_CONNECTION_KEY, JSON.stringify(params))
  }
  listProfiles(): StudioProfile[] {
    return [...this.profiles.values()].sort((a, b) => a.name.localeCompare(b.name))
  }
  getProfile(id: string): StudioProfile | null {
    return this.profiles.get(id) ?? null
  }
  saveProfile(profile: StudioProfile): StudioProfile {
    const validated = studioProfileSchema.parse(profile)
    this.profiles.set(validated.id, validated)
    return validated
  }
  deleteProfile(id: string): void {
    this.profiles.delete(id)
  }
  addMarker(marker: ReviewMarker): void {
    this.markers.push(marker)
  }
  listMarkers(sessionId?: string): ReviewMarker[] {
    const all = sessionId ? this.markers.filter((m) => m.sessionId === sessionId) : this.markers
    return [...all].sort((a, b) => a.tcMs - b.tcMs)
  }
  updateMarkerNote(id: string, note: string): void {
    const marker = this.markers.find((m) => m.id === id)
    if (marker) marker.note = note
  }
}

export function createStore(): Store {
  try {
    const dbPath = join(app.getPath('userData'), 'studiomaster.sqlite')
    return new SqliteStore(new Database(dbPath))
  } catch (err) {
    console.error('[store] SQLite unavailable, falling back to in-memory store:', err)
    return new MemoryStore()
  }
}
