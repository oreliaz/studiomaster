/** AI editing agent bridge types (docs §6.4). */

export interface AiJobResult {
  sessionId: string
  ok: boolean
  /** The worker's JSON summary (segment counts, rendered files, etc.). */
  summary?: AiJobSummary
  error?: string
}

export interface AiJobSummary {
  media: string
  total_ms: number
  markers: number
  transcript_segments: number
  full_edit_segments: number
  highlights: number
  chapters: number
  rendered: string[]
  ffmpeg: boolean
  dry_run: boolean
}
