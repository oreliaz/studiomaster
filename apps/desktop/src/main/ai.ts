import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { app } from 'electron'
import type { AiJobResult, AiJobSummary } from '@studiomaster/shared'
import type { Store } from './store.js'

/**
 * AiEditor — bridge to the Python editing worker (docs §6.4). Exports the
 * session's markers + metadata into the session folder, then runs
 * `python -m ai_workers.worker <dir>` and returns its JSON summary. Best-effort:
 * a missing Python interpreter surfaces as a clear error rather than a crash.
 */
export class AiEditor {
  constructor(private readonly store: Store) {}

  /** Locate the services/ai-workers directory (dev layout). */
  private workersDir(): string {
    return resolve(app.getAppPath(), '..', '..', 'services', 'ai-workers')
  }

  async processSession(sessionId: string): Promise<AiJobResult> {
    const session = this.store.getSession(sessionId)
    if (!session) return { sessionId, ok: false, error: 'הפגישה לא נמצאה' }

    // Export the pipeline inputs into the session folder.
    try {
      const markers = this.store.listMarkers(sessionId)
      writeFileSync(
        join(session.storagePath, 'markers.json'),
        JSON.stringify(markers, null, 2),
        'utf8',
      )
      writeFileSync(
        join(session.storagePath, 'session.json'),
        JSON.stringify(session, null, 2),
        'utf8',
      )
    } catch (err) {
      return { sessionId, ok: false, error: `כתיבת קלט נכשלה: ${message(err)}` }
    }

    try {
      const summary = await this.runWorker(session.storagePath)
      return { sessionId, ok: true, summary }
    } catch (err) {
      return { sessionId, ok: false, error: message(err) }
    }
  }

  private runWorker(sessionDir: string): Promise<AiJobSummary | undefined> {
    return new Promise((resolvePromise, reject) => {
      const python = process.platform === 'win32' ? 'python' : 'python3'
      const child = spawn(python, ['-m', 'ai_workers.worker', sessionDir], {
        cwd: this.workersDir(),
      })
      let out = ''
      let err = ''
      child.stdout.on('data', (d) => (out += d.toString()))
      child.stderr.on('data', (d) => (err += d.toString()))
      child.on('error', (e) => reject(new Error(`לא ניתן להריץ Python (${python}): ${e.message}`)))
      child.on('close', (code) => {
        if (code !== 0) return reject(new Error(err.trim() || `worker exited with code ${code}`))
        const lastLine = out.trim().split('\n').pop() ?? '{}'
        try {
          resolvePromise(JSON.parse(lastLine) as AiJobSummary)
        } catch {
          resolvePromise(undefined)
        }
      })
    })
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
