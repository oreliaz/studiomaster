import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { app } from 'electron'
import type { AiJobResult } from '@studiomaster/shared'
import type { Store } from './store.js'

/**
 * AiEditor — bridge to the Python pilot orchestrator (docs §6.4). Exports the
 * session's markers + a job.json (the profile's deliverables questionnaire +
 * capture path), then runs `python -m ai_workers.pilot <dir>`, which drives the
 * vendored basic-editing-he / podcast-reels-he skills. Best-effort: a missing
 * Python interpreter surfaces as a clear error rather than a crash.
 */
export class AiEditor {
  constructor(private readonly store: Store) {}

  private workersDir(): string {
    if (app.isPackaged) return join(process.resourcesPath, 'ai-workers')
    return resolve(app.getAppPath(), '..', '..', 'services', 'ai-workers')
  }

  async processSession(sessionId: string): Promise<AiJobResult> {
    const session = this.store.getSession(sessionId)
    if (!session) return { sessionId, ok: false, error: 'הפגישה לא נמצאה' }

    const profile = session.profileId ? this.store.getProfile(session.profileId) : null
    const job = {
      sessionId,
      capturePath: session.capturePath ?? '',
      deliverables: profile?.deliverables ?? {},
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

    try {
      const summary = await this.runPilot(session.storagePath)
      const short = summarize(summary)
      this.store.saveSession({ ...session, editStatus: 'done', editSummary: short })
      return { sessionId, ok: true, summary }
    } catch (err) {
      this.store.saveSession({ ...session, editStatus: 'error', editSummary: message(err) })
      return { sessionId, ok: false, error: message(err) }
    }
  }

  private runPilot(sessionDir: string): Promise<Record<string, unknown> | undefined> {
    return new Promise((resolvePromise, reject) => {
      const python = process.platform === 'win32' ? 'python' : 'python3'
      const child = spawn(python, ['-m', 'ai_workers.pilot', sessionDir], {
        cwd: this.workersDir(),
      })
      let out = ''
      let err = ''
      child.stdout.on('data', (d) => (out += d.toString()))
      child.stderr.on('data', (d) => (err += d.toString()))
      child.on('error', (e) => reject(new Error(`לא ניתן להריץ Python (${python}): ${e.message}`)))
      child.on('close', (code) => {
        if (code !== 0) return reject(new Error(err.trim() || `pilot exited with code ${code}`))
        const lastLine = out.trim().split('\n').pop() ?? '{}'
        try {
          resolvePromise(JSON.parse(lastLine) as Record<string, unknown>)
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
  const reels = summary['reels'] as { planned_clips?: number } | null
  if (reels?.planned_clips) parts.push(`${reels.planned_clips} רילסים`)
  if (summary['error']) parts.push(`שגיאה: ${summary['error']}`)
  return parts.join(' · ')
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
