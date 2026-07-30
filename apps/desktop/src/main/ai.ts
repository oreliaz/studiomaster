import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { app } from 'electron'
import type { AiJobResult, AiProgress } from '@studiomaster/shared'
import type { Store } from './store.js'

/** Sentinel prefix the Python pilot uses for streamed progress lines. */
const PROGRESS_PREFIX = '@@SM@@'

/**
 * AiEditor — bridge to the Python pilot orchestrator (docs §6.4). Exports the
 * session's markers + a job.json (the profile's deliverables questionnaire +
 * capture path), then runs `python -m ai_workers.pilot <dir>`, which drives the
 * vendored basic-editing-he / podcast-reels-he skills. Best-effort: a missing
 * Python interpreter surfaces as a clear error rather than a crash.
 */
export class AiEditor {
  constructor(
    private readonly store: Store,
    private readonly onProgress: (p: AiProgress) => void = () => {},
  ) {}

  private workersDir(): string {
    if (app.isPackaged) return join(process.resourcesPath, 'ai-workers')
    return resolve(app.getAppPath(), '..', '..', 'services', 'ai-workers')
  }

  async processSession(sessionId: string): Promise<AiJobResult> {
    const session = this.store.getSession(sessionId)
    if (!session) return { sessionId, ok: false, error: 'הפגישה לא נמצאה' }

    // Deliverables come from the Podcast (show). Fall back to a profile's
    // legacy embedded deliverables for sessions recorded before the split.
    const podcast = session.podcastId ? this.store.getPodcast(session.podcastId) : null
    const profile = session.profileId ? this.store.getProfile(session.profileId) : null
    const deliverables = { ...(podcast?.deliverables ?? profile?.deliverables ?? {}) }
    // Per-episode intro/outro overrides (set in the post-edit review) win.
    if (session.introOverride !== undefined) deliverables.intro = session.introOverride || undefined
    if (session.outroOverride !== undefined) deliverables.outro = session.outroOverride || undefined
    const job = {
      sessionId,
      capturePath: session.capturePath ?? '',
      deliverables,
    }

    try {
      const markers = this.store.listMarkers(sessionId)
      writeFileSync(
        join(session.storagePath, 'markers.json'),
        JSON.stringify(markers, null, 2),
        'utf8',
      )
      writeFileSync(join(session.storagePath, 'job.json'), JSON.stringify(job, null, 2), 'utf8')
    } catch (err) {
      return { sessionId, ok: false, error: `כתיבת קלט נכשלה: ${message(err)}` }
    }

    this.store.saveSession({ ...session, editStatus: 'running' })
    this.onProgress({ sessionId, phase: 'start', frac: 0, detail: 'מתחיל עריכה…' })

    try {
      const summary = await this.runPilot(session.storagePath, sessionId)
      const short = summarize(summary)
      this.store.saveSession({ ...session, editStatus: 'done', editSummary: short })
      this.onProgress({ sessionId, phase: 'done', frac: 1, detail: short })
      return { sessionId, ok: true, summary }
    } catch (err) {
      this.store.saveSession({ ...session, editStatus: 'error', editSummary: message(err) })
      this.onProgress({ sessionId, phase: 'error', frac: 1, detail: message(err) })
      return { sessionId, ok: false, error: message(err) }
    }
  }

  private runPilot(
    sessionDir: string,
    sessionId: string,
  ): Promise<Record<string, unknown> | undefined> {
    return new Promise((resolvePromise, reject) => {
      const python = process.platform === 'win32' ? 'python' : 'python3'
      const child = spawn(python, ['-u', '-m', 'ai_workers.pilot', sessionDir], {
        cwd: this.workersDir(),
      })
      let buffer = ''
      let lastResult = '{}'
      let err = ''

      const handleLine = (line: string): void => {
        const trimmed = line.trim()
        if (!trimmed) return
        if (trimmed.startsWith(PROGRESS_PREFIX)) {
          try {
            const p = JSON.parse(trimmed.slice(PROGRESS_PREFIX.length)) as Omit<
              AiProgress,
              'sessionId'
            >
            this.onProgress({ sessionId, ...p })
          } catch {
            // ignore malformed progress line
          }
          return
        }
        lastResult = trimmed // last non-progress line is the summary JSON
      }

      child.stdout.on('data', (d) => {
        buffer += d.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? '' // keep the incomplete tail
        for (const line of lines) handleLine(line)
      })
      child.stderr.on('data', (d) => (err += d.toString()))
      child.on('error', (e) => reject(new Error(`לא ניתן להריץ Python (${python}): ${e.message}`)))
      child.on('close', (code) => {
        if (buffer) handleLine(buffer)
        if (code !== 0) return reject(new Error(err.trim() || `pilot exited with code ${code}`))
        try {
          resolvePromise(JSON.parse(lastResult) as Record<string, unknown>)
        } catch {
          resolvePromise(undefined)
        }
      })
    })
  }
}

function summarize(summary: Record<string, unknown> | undefined): string {
  if (!summary) return 'הושלם'
  const type = String(summary['edit_type'] ?? '')
  const parts: string[] = [`עריכה: ${type}`]
  const basic = summary['basic'] as { output?: string } | null
  if (basic?.output) parts.push('פרק מלא ✓')
  const reels = summary['reels'] as {
    planned_clips?: number
    rendered?: number
    selection?: string
  } | null
  if (reels?.rendered) {
    const how = reels.selection === 'model' ? ' (בחירה חכמה)' : ''
    parts.push(`${reels.rendered} רילסים ✓${how}`)
  } else if (reels?.planned_clips) {
    parts.push(`${reels.planned_clips} רילסים (מתוכננים)`)
  }
  if (summary['error']) parts.push(`שגיאה: ${summary['error']}`)
  return parts.join(' · ')
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
