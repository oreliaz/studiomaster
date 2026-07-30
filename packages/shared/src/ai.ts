/** AI editing agent bridge types (docs §6.4). */

export interface AiJobResult {
  sessionId: string
  ok: boolean
  /** The pilot orchestrator's JSON summary (edit type, per-skill step status). */
  summary?: Record<string, unknown>
  error?: string
}

/** Live progress emitted by the editing pilot while a session is edited. */
export interface AiProgress {
  sessionId: string
  /** Machine phase key (e.g. 'audio', 'transcribe', 'plan', 'render', 'reels-cut'). */
  phase: string
  /** 0..1 overall completion estimate. */
  frac: number
  /** Human-readable description of what is happening now. */
  detail: string
}
