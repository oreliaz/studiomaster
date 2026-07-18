import { join } from 'node:path'
import { app } from 'electron'
import Database from 'better-sqlite3'
import type { ObsConnectionParams } from '@studiomaster/shared'

/**
 * Local persistence (docs/ARCHITECTURE.md §7). Phase 0 keeps this intentionally
 * small: a key/value settings table plus the sessions table that later phases
 * build on. SQLite is a native module; if it fails to load (e.g. not rebuilt
 * for the current Electron ABI) the app degrades to an in-memory store rather
 * than crashing, so the OBS control surface still works.
 */

interface SettingsRow {
  value: string
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
]

export interface Store {
  getSetting(key: string): string | null
  setSetting(key: string, value: string): void
  getSavedConnection(): ObsConnectionParams | null
  saveConnection(params: ObsConnectionParams): void
}

const OBS_CONNECTION_KEY = 'obs.connection'

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
}

/** Fallback used when the native SQLite module is unavailable. */
class MemoryStore implements Store {
  private readonly map = new Map<string, string>()
  getSetting(key: string): string | null {
    return this.map.get(key) ?? null
  }
  setSetting(key: string, value: string): void {
    this.map.set(key, value)
  }
  getSavedConnection(): ObsConnectionParams | null {
    const raw = this.getSetting(OBS_CONNECTION_KEY)
    return raw ? (JSON.parse(raw) as ObsConnectionParams) : null
  }
  saveConnection(params: ObsConnectionParams): void {
    this.setSetting(OBS_CONNECTION_KEY, JSON.stringify(params))
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
