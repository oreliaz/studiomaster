/** AI editing agent bridge types (docs §6.4). */

export interface AiJobResult {
  sessionId: string
  ok: boolean
  /** The pilot orchestrator's JSON summary (edit type, per-skill step status). */
  summary?: Record<string, unknown>
  error?: string
}
