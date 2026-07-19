import { join } from 'node:path'
import { app } from 'electron'
import Database from 'better-sqlite3'
import {
  studioProfileSchema,
  type ObsConnectionParams,
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
}

/** Fallback used when the native SQLite module is unavailable. */
class MemoryStore implements Store {
  private readonly settings = new Map<string, string>()
  private readonly profiles = new Map<string, StudioProfile>()

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
