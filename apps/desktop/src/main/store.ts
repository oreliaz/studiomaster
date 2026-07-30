import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import {
  emptyKnowledgeBase,
  podcastSchema,
  studioProfileSchema,
  type KnowledgeBase,
  type ObsConnectionParams,
  type Podcast,
  type ReviewMarker,
  type SessionSummary,
  type StudioProfile,
} from '@studiomaster/shared'

/**
 * Local persistence (docs/ARCHITECTURE.md §7). Backed by a single JSON file
 * under userData — deliberately dependency-free (no native modules), so
 * `npm install` never needs a C/C++ toolchain and the app always launches. The
 * data set (profiles, sessions, markers, settings) is tiny, so whole-file
 * writes are fine. Falls back to an in-memory store if the file can't be used.
 */

export interface Store {
  getSetting(key: string): string | null
  setSetting(key: string, value: string): void
  getSavedConnection(): ObsConnectionParams | null
  saveConnection(params: ObsConnectionParams): void
  listProfiles(): StudioProfile[]
  getProfile(id: string): StudioProfile | null
  saveProfile(profile: StudioProfile): StudioProfile
  deleteProfile(id: string): void
  listPodcasts(): Podcast[]
  getPodcast(id: string): Podcast | null
  savePodcast(podcast: Podcast): Podcast
  deletePodcast(id: string): void
  addMarker(marker: ReviewMarker): void
  listMarkers(sessionId?: string): ReviewMarker[]
  updateMarkerNote(id: string, note: string): void
  saveSession(session: SessionSummary): void
  getSession(id: string): SessionSummary | null
  listSessions(): SessionSummary[]
  getKb(): KnowledgeBase
  setKb(kb: KnowledgeBase): void
}

interface DbShape {
  settings: Record<string, string>
  profiles: Record<string, StudioProfile>
  podcasts: Record<string, Podcast>
  markers: ReviewMarker[]
  sessions: Record<string, SessionSummary>
  kb: KnowledgeBase
}

const EMPTY: DbShape = {
  settings: {},
  profiles: {},
  podcasts: {},
  markers: [],
  sessions: {},
  kb: emptyKnowledgeBase(),
}
const OBS_CONNECTION_KEY = 'obs.connection'

function parseProfile(profile: StudioProfile): StudioProfile | null {
  try {
    return studioProfileSchema.parse(profile)
  } catch {
    return null
  }
}

function parsePodcast(podcast: Podcast): Podcast | null {
  try {
    return podcastSchema.parse(podcast)
  } catch {
    return null
  }
}

class JsonFileStore implements Store {
  private readonly path: string
  private readonly data: DbShape

  constructor() {
    this.path = join(app.getPath('userData'), 'studiomaster.json')
    this.data = this.load()
  }

  private load(): DbShape {
    try {
      if (existsSync(this.path)) {
        const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<DbShape>
        return { ...EMPTY, ...parsed }
      }
    } catch (err) {
      console.error('[store] failed to read data file, starting fresh:', err)
    }
    return structuredClone(EMPTY)
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      writeFileSync(this.path, JSON.stringify(this.data, null, 2), 'utf8')
    } catch (err) {
      console.error('[store] failed to write data file:', err)
    }
  }

  getSetting(key: string): string | null {
    return this.data.settings[key] ?? null
  }
  setSetting(key: string, value: string): void {
    this.data.settings[key] = value
    this.save()
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
    return Object.values(this.data.profiles)
      .map(parseProfile)
      .filter((p): p is StudioProfile => p !== null)
      .sort((a, b) => a.name.localeCompare(b.name))
  }
  getProfile(id: string): StudioProfile | null {
    const p = this.data.profiles[id]
    return p ? parseProfile(p) : null
  }
  saveProfile(profile: StudioProfile): StudioProfile {
    const validated = studioProfileSchema.parse(profile)
    this.data.profiles[validated.id] = validated
    this.save()
    return validated
  }
  deleteProfile(id: string): void {
    delete this.data.profiles[id]
    this.save()
  }

  listPodcasts(): Podcast[] {
    return Object.values(this.data.podcasts)
      .map(parsePodcast)
      .filter((p): p is Podcast => p !== null)
      .sort((a, b) => a.name.localeCompare(b.name))
  }
  getPodcast(id: string): Podcast | null {
    const p = this.data.podcasts[id]
    return p ? parsePodcast(p) : null
  }
  savePodcast(podcast: Podcast): Podcast {
    const validated = podcastSchema.parse(podcast)
    this.data.podcasts[validated.id] = validated
    this.save()
    return validated
  }
  deletePodcast(id: string): void {
    delete this.data.podcasts[id]
    this.save()
  }

  addMarker(marker: ReviewMarker): void {
    this.data.markers.push(marker)
    this.save()
  }
  listMarkers(sessionId?: string): ReviewMarker[] {
    const all = sessionId
      ? this.data.markers.filter((m) => m.sessionId === sessionId)
      : this.data.markers
    return [...all].sort((a, b) => a.tcMs - b.tcMs)
  }
  updateMarkerNote(id: string, note: string): void {
    const marker = this.data.markers.find((m) => m.id === id)
    if (marker) {
      marker.note = note
      this.save()
    }
  }

  saveSession(session: SessionSummary): void {
    this.data.sessions[session.id] = session
    this.save()
  }
  getSession(id: string): SessionSummary | null {
    return this.data.sessions[id] ?? null
  }
  listSessions(): SessionSummary[] {
    return Object.values(this.data.sessions).sort((a, b) =>
      b.startedAt.localeCompare(a.startedAt),
    )
  }
  getKb(): KnowledgeBase {
    return this.data.kb ?? emptyKnowledgeBase()
  }
  setKb(kb: KnowledgeBase): void {
    this.data.kb = kb
    this.save()
  }
}

/** Volatile fallback if even the JSON file can't be used. */
class MemoryStore implements Store {
  private readonly settings = new Map<string, string>()
  private readonly profiles = new Map<string, StudioProfile>()
  private readonly podcasts = new Map<string, Podcast>()
  private readonly markers: ReviewMarker[] = []
  private readonly sessions = new Map<string, SessionSummary>()
  private kb: KnowledgeBase = emptyKnowledgeBase()

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
  listPodcasts(): Podcast[] {
    return [...this.podcasts.values()].sort((a, b) => a.name.localeCompare(b.name))
  }
  getPodcast(id: string): Podcast | null {
    return this.podcasts.get(id) ?? null
  }
  savePodcast(podcast: Podcast): Podcast {
    const validated = podcastSchema.parse(podcast)
    this.podcasts.set(validated.id, validated)
    return validated
  }
  deletePodcast(id: string): void {
    this.podcasts.delete(id)
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
  saveSession(session: SessionSummary): void {
    this.sessions.set(session.id, session)
  }
  getSession(id: string): SessionSummary | null {
    return this.sessions.get(id) ?? null
  }
  listSessions(): SessionSummary[] {
    return [...this.sessions.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  }
  getKb(): KnowledgeBase {
    return this.kb
  }
  setKb(kb: KnowledgeBase): void {
    this.kb = kb
  }
}

export function createStore(): Store {
  try {
    return new JsonFileStore()
  } catch (err) {
    console.error('[store] JSON store unavailable, using in-memory store:', err)
    return new MemoryStore()
  }
}
