import { safeStorage } from 'electron'
import {
  mergeKnowledgeBase,
  type AuthStatus,
  type BackendConfig,
  type KnowledgeBase,
  type KnownIssue,
  type PodcastNote,
  type Workspace,
  type WorkspaceMember,
} from '@studiomaster/shared'
import type { Store } from '../store.js'
import { SupabaseClient, type Session } from './supabase.js'

const CONFIG_KEY = 'backend.config'
const SESSION_KEY = 'backend.session' // encrypted
const ACTIVE_WS_KEY = 'backend.workspace'

/**
 * BackendService — Supabase-backed accounts + shared workspaces + knowledge-base
 * sync (docs §6.5). A studio is a user account; a workspace groups studios that
 * share one knowledge base. Tokens are stored encrypted (safeStorage/DPAPI).
 */
export class BackendService {
  private readonly sb = new SupabaseClient()

  constructor(private readonly store: Store) {
    const cfg = this.store.getSetting(CONFIG_KEY)
    if (cfg) {
      try {
        this.sb.setConfig(JSON.parse(cfg) as BackendConfig)
      } catch {
        /* ignore bad config */
      }
    }
    const enc = this.store.getSetting(SESSION_KEY)
    if (enc && safeStorage.isEncryptionAvailable()) {
      try {
        this.sb.setSession(JSON.parse(safeStorage.decryptString(Buffer.from(enc, 'base64'))) as Session)
      } catch {
        /* stale/undecryptable session — user re-signs in */
      }
    }
  }

  private persistSession(): void {
    const session = this.sb.getSession()
    if (!session || !safeStorage.isEncryptionAvailable()) {
      this.store.setSetting(SESSION_KEY, '')
      return
    }
    this.store.setSetting(SESSION_KEY, safeStorage.encryptString(JSON.stringify(session)).toString('base64'))
  }

  getStatus(): AuthStatus {
    const user = this.sb.user
    return {
      configured: !!this.sb.getConfig(),
      signedIn: !!user,
      user: user ?? undefined,
      workspaceId: this.store.getSetting(ACTIVE_WS_KEY) || undefined,
    }
  }

  setConfig(url: string, anonKey: string): AuthStatus {
    const config: BackendConfig = { url: url.replace(/\/+$/, ''), anonKey }
    this.store.setSetting(CONFIG_KEY, JSON.stringify(config))
    this.sb.setConfig(config)
    return this.getStatus()
  }

  async signUp(email: string, password: string): Promise<AuthStatus> {
    const session = await this.sb.signUp(email, password)
    this.persistSession()
    if (!session) return { ...this.getStatus(), error: 'נשלח מייל אימות — אשר אותו והתחבר' }
    return this.getStatus()
  }

  async signIn(email: string, password: string): Promise<AuthStatus> {
    await this.sb.signIn(email, password)
    this.persistSession()
    return this.getStatus()
  }

  signOut(): AuthStatus {
    this.sb.signOut()
    this.store.setSetting(SESSION_KEY, '')
    return this.getStatus()
  }

  async listWorkspaces(): Promise<Workspace[]> {
    const rows = await this.sb.rpc<
      { id: string; name: string; join_code: string; role: string }[]
    >('my_workspaces')
    return (rows ?? []).map((r) => ({ id: r.id, name: r.name, joinCode: r.join_code, role: r.role }))
  }

  async createWorkspace(name: string, studioName?: string): Promise<Workspace> {
    const w = await this.sb.rpc<{ id: string; name: string; join_code: string }>('create_workspace', {
      p_name: name,
      p_studio: studioName ?? null,
    })
    this.store.setSetting(ACTIVE_WS_KEY, w.id)
    return { id: w.id, name: w.name, joinCode: w.join_code, role: 'owner' }
  }

  async joinWorkspace(joinCode: string, studioName?: string): Promise<Workspace> {
    const w = await this.sb.rpc<{ id: string; name: string; join_code: string }>('join_workspace', {
      p_code: joinCode.trim(),
      p_studio: studioName ?? null,
    })
    this.store.setSetting(ACTIVE_WS_KEY, w.id)
    return { id: w.id, name: w.name, joinCode: w.join_code, role: 'member' }
  }

  setActiveWorkspace(id: string): void {
    this.store.setSetting(ACTIVE_WS_KEY, id)
  }

  async listMembers(): Promise<WorkspaceMember[]> {
    const ws = this.store.getSetting(ACTIVE_WS_KEY)
    if (!ws) return []
    const rows = await this.sb.select<
      { user_id: string; email?: string; studio_name?: string; role: string }[]
    >('workspace_members', `workspace_id=eq.${ws}&select=user_id,email,studio_name,role`)
    return (rows ?? []).map((r) => ({
      userId: r.user_id,
      email: r.email,
      studioName: r.studio_name,
      role: r.role,
    }))
  }

  /** True when server sync is possible (configured, signed in, workspace picked). */
  canSync(): boolean {
    return !!this.sb.getConfig() && !!this.sb.user && !!this.store.getSetting(ACTIVE_WS_KEY)
  }

  /** Pull the workspace KB, merge with `local`, push the union back, return it. */
  async syncKnowledgeBase(local: KnowledgeBase): Promise<KnowledgeBase> {
    const ws = this.store.getSetting(ACTIVE_WS_KEY)
    if (!this.sb.user) throw new Error('התחבר לחשבון כדי לסנכרן')
    if (!ws) throw new Error('בחר או צור וורקספייס כדי לסנכרן')

    const iso = (v: string): string => {
      const t = Date.parse(v)
      return Number.isNaN(t) ? new Date(0).toISOString() : new Date(t).toISOString()
    }
    const noteRows = await this.sb.select<
      { id: string; podcast_name: string; notes: string; updated_at: string; author?: string }[]
    >('podcast_notes', `workspace_id=eq.${ws}&select=*`)
    const issueRows = await this.sb.select<
      {
        id: string
        title: string
        symptom: string
        fix: string
        tags: string[]
        created_at: string
        updated_at: string
        author?: string
      }[]
    >('known_issues', `workspace_id=eq.${ws}&select=*`)

    const remote: KnowledgeBase = {
      version: 1,
      updatedAt: new Date().toISOString(),
      podcastNotes: (noteRows ?? []).map((r) => ({
        id: r.id,
        podcastName: r.podcast_name,
        notes: r.notes,
        updatedAt: iso(r.updated_at),
        author: r.author,
      })),
      knownIssues: (issueRows ?? []).map((r) => ({
        id: r.id,
        title: r.title,
        symptom: r.symptom,
        fix: r.fix,
        tags: r.tags ?? [],
        createdAt: iso(r.created_at),
        updatedAt: iso(r.updated_at),
        author: r.author,
      })),
    }

    const merged = mergeKnowledgeBase(local, remote)

    if (merged.podcastNotes.length) {
      await this.sb.upsert(
        'podcast_notes',
        merged.podcastNotes.map((n: PodcastNote) => ({
          workspace_id: ws,
          podcast_name: n.podcastName,
          notes: n.notes,
          updated_at: n.updatedAt,
          author: n.author ?? null,
        })),
        'workspace_id,podcast_name',
      )
    }
    if (merged.knownIssues.length) {
      await this.sb.upsert(
        'known_issues',
        merged.knownIssues.map((i: KnownIssue) => ({
          id: i.id,
          workspace_id: ws,
          title: i.title,
          symptom: i.symptom,
          fix: i.fix,
          tags: i.tags,
          created_at: i.createdAt,
          updated_at: i.updatedAt,
          author: i.author ?? null,
        })),
        'id',
      )
    }
    merged.updatedAt = new Date().toISOString()
    return merged
  }
}
