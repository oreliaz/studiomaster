import type { AuthUser, BackendConfig } from '@studiomaster/shared'

/**
 * Minimal Supabase client over the REST/Auth HTTP API using global `fetch`
 * (docs §6.5) — no SDK dependency, so nothing extra to bundle. Handles
 * email/password auth, access-token refresh, PostgREST table access and RPCs.
 */

export interface Session {
  accessToken: string
  refreshToken: string
  expiresAt: number // epoch ms
  user: AuthUser
}

interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  user: { id: string; email: string }
}

export class SupabaseClient {
  private config: BackendConfig | null = null
  private session: Session | null = null

  setConfig(config: BackendConfig | null): void {
    this.config = config
  }
  getConfig(): BackendConfig | null {
    return this.config
  }
  setSession(session: Session | null): void {
    this.session = session
  }
  getSession(): Session | null {
    return this.session
  }
  get user(): AuthUser | null {
    return this.session?.user ?? null
  }

  private authHeaders(withToken = true): Record<string, string> {
    if (!this.config) throw new Error('השרת לא הוגדר')
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      apikey: this.config.anonKey,
    }
    if (withToken && this.session) headers.Authorization = `Bearer ${this.session.accessToken}`
    return headers
  }

  private toSession(data: TokenResponse): Session {
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
      user: { id: data.user.id, email: data.user.email },
    }
  }

  async signUp(email: string, password: string): Promise<Session | null> {
    if (!this.config) throw new Error('השרת לא הוגדר')
    const res = await fetch(`${this.config.url}/auth/v1/signup`, {
      method: 'POST',
      headers: this.authHeaders(false),
      body: JSON.stringify({ email, password }),
    })
    const data = (await res.json()) as Partial<TokenResponse> & { msg?: string; error_description?: string }
    if (!res.ok) throw new Error(data.error_description || data.msg || 'הרשמה נכשלה')
    // With email confirmation on, no session is returned until the link is used.
    if (!data.access_token) return null
    this.session = this.toSession(data as TokenResponse)
    return this.session
  }

  async signIn(email: string, password: string): Promise<Session> {
    if (!this.config) throw new Error('השרת לא הוגדר')
    const res = await fetch(`${this.config.url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: this.authHeaders(false),
      body: JSON.stringify({ email, password }),
    })
    const data = (await res.json()) as TokenResponse & { error_description?: string; msg?: string }
    if (!res.ok) throw new Error(data.error_description || data.msg || 'התחברות נכשלה')
    this.session = this.toSession(data)
    return this.session
  }

  private async refresh(): Promise<void> {
    if (!this.config || !this.session) throw new Error('לא מחובר')
    const res = await fetch(`${this.config.url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: this.authHeaders(false),
      body: JSON.stringify({ refresh_token: this.session.refreshToken }),
    })
    if (!res.ok) {
      this.session = null
      throw new Error('פג תוקף החיבור — התחבר שוב')
    }
    this.session = this.toSession((await res.json()) as TokenResponse)
  }

  signOut(): void {
    this.session = null
  }

  /** Authenticated REST/RPC call, refreshing the token once on 401/expiry. */
  private async authed<T>(path: string, init: RequestInit): Promise<T> {
    if (!this.config) throw new Error('השרת לא הוגדר')
    if (this.session && Date.now() > this.session.expiresAt - 30_000) await this.refresh()
    const url = `${this.config.url}${path}`
    let res = await fetch(url, { ...init, headers: { ...this.authHeaders(), ...(init.headers ?? {}) } })
    if (res.status === 401 && this.session) {
      await this.refresh()
      res = await fetch(url, { ...init, headers: { ...this.authHeaders(), ...(init.headers ?? {}) } })
    }
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`${res.status}: ${body.slice(0, 300)}`)
    }
    const text = await res.text()
    return (text ? JSON.parse(text) : null) as T
  }

  /** Call a Postgres function exposed via PostgREST. */
  rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    return this.authed<T>(`/rest/v1/rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) })
  }

  /** Select rows from a table with a raw PostgREST query string (without '?'). */
  select<T>(table: string, query = ''): Promise<T> {
    return this.authed<T>(`/rest/v1/${table}${query ? `?${query}` : ''}`, { method: 'GET' })
  }

  /** Upsert rows (merge on conflict) and return the representation. */
  upsert<T>(table: string, rows: unknown[], onConflict?: string): Promise<T> {
    const q = onConflict ? `?on_conflict=${onConflict}` : ''
    return this.authed<T>(`/rest/v1/${table}${q}`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(rows),
    })
  }
}
