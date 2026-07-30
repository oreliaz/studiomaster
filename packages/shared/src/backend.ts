/**
 * Backend (Supabase) types (docs §6.5). A STUDIO is a user account; a WORKSPACE
 * groups studios so they share one knowledge base. The desktop app talks to
 * Supabase over its REST/Auth API, keeping the local store as an offline cache.
 */

export interface BackendConfig {
  /** Supabase project URL, e.g. https://xxxx.supabase.co */
  url: string
  /** Supabase anon (public) API key. */
  anonKey: string
}

export interface AuthUser {
  id: string
  email: string
}

/** Signed-in state surfaced to the UI (never carries tokens). */
export interface AuthStatus {
  configured: boolean
  signedIn: boolean
  user?: AuthUser
  /** The active workspace id, if one is selected. */
  workspaceId?: string
  error?: string
}

export interface Workspace {
  id: string
  name: string
  joinCode: string
  role: string
}

export interface WorkspaceMember {
  userId: string
  email?: string
  studioName?: string
  role: string
}
