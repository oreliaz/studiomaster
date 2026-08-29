import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { app, safeStorage } from 'electron'
import type { AiJobResult, AiProgress, RequestedDeliverables } from '@studiomaster/shared'
import type { Store } from './store.js'
import { ffmpegEnv } from './ffmpeg.js'

/** Sentinel prefix the Python pilot uses for streamed progress lines. */
const PROGRESS_PREFIX = '@@SM@@'

/**
 * AiEditor — bridge to the Python pilot orchestrator (docs §6.4). Exports the
 * session's markers + a job.json (the profile's deliverables questionnaire +
 * capture path), then runs `python -m ai_workers.pilot <dir>`, which drives the
 * vendored basic-editing-he / podcast-reels-he skills. Best-effort: a missing
 * Python interpreter surfaces as a clear error rather than a crash.
 */
const ANTHROPIC_KEY = 'ai.anthropicKey'

export class AiEditor {
  constructor(
    private readonly store: Store,
    private readonly onProgress: (p: AiProgress) => void = () => {},
  ) {}

  /** Store the Claude API key encrypted (safeStorage/DPAPI). Empty clears it. */
  setAnthropicKey(key: string): void {
    const trimmed = key.trim()
    if (!trimmed) {
      this.store.setSetting(ANTHROPIC_KEY, '')
      return
    }
    const value = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(trimmed).toString('base64')
      : trimmed
    this.store.setSetting(ANTHROPIC_KEY, value)
  }

  hasAnthropicKey(): boolean {
    return !!this.resolveAnthropicKey()
  }

  /** The key: the stored (decrypted) one, else the ANTHROPIC_API_KEY env var. */
  private resolveAnthropicKey(): string | undefined {
    const raw = this.store.getSetting(ANTHROPIC_KEY)
    if (!raw) return process.env['ANTHROPIC_API_KEY'] || undefined
    try {
      return safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(Buffer.from(raw, 'base64'))
        : raw
    } catch {
      return raw
    }
  }

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

    // Free-text correction notes for this episode + the podcast's accumulated KB
    // guidelines, so the editor (reel selection) acts on human feedback and the
    // next edit of this show starts from the same conventions.
    const kb = this.store.getKb()
    const key = podcast?.name.trim().toLowerCase()
    const guideline = key
      ? kb.podcastNotes.find((n) => n.podcastName.trim().toLowerCase() === key)
      : undefined
    // Which deliverables to produce: an explicit per-episode selection (e.g. an
    // imported, self-edited episode) wins. Otherwise this is a studio recording,
    // and every studio episode gets the full-episode basic edit (+ work brief +
    // raw material), plus whatever else the podcast asks for.
    const requested: RequestedDeliverables = session.requested ?? {
      basic: true,
      reels: deliverables.editType === 'reels' || deliverables.editType === 'both',
      title: !!deliverables.title,
      description: !!deliverables.description,
      thumbnail: !!deliverables.thumbnail,
    }
    const job = {
      sessionId,
      capturePath: session.capturePath ?? '',
      deliverables,
      requested,
      notes: session.editNotes ?? '',
      podcastGuidelines: guideline?.notes ?? '',
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
      const summary = await this.runWorker(session.storagePath, sessionId, [
        '-m',
        'ai_workers.pilot',
        session.storagePath,
      ])
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

  /** Re-render one manually-edited target (basic edit or a single reel). The
   *  timeline editor has already written the edited artifacts to disk; this
   *  runs the render-only worker and streams progress like a normal edit. */
  async reedit(
    sessionDir: string,
    sessionId: string,
    mode: 'basic' | 'reel',
    reelId?: string,
  ): Promise<Record<string, unknown> | undefined> {
    const args = ['-m', 'ai_workers.reedit', sessionDir, '--mode', mode]
    if (mode === 'reel' && reelId) args.push('--reel', reelId)
    return this.runWorker(sessionDir, sessionId, args)
  }

  private runWorker(
    sessionDir: string,
    sessionId: string,
    moduleArgs: string[],
  ): Promise<Record<string, unknown> | undefined> {
    return new Promise((resolvePromise, reject) => {
      const python = process.platform === 'win32' ? 'python' : 'python3'
      const key = this.resolveAnthropicKey()
      const child = spawn(python, ['-u', ...moduleArgs], {
        cwd: this.workersDir(),
        // Bundled ffmpeg/ffprobe on PATH + the Claude key, so the workers find
        // both with no separate install / env-var setup.
        env: ffmpegEnv(key ? { ANTHROPIC_API_KEY: key } : {}),
      })
      let buffer = ''
      let lastResult = '{}'
      let err = ''
      let logBuf = `# StudioMaster edit log\npython: ${python}\ncwd: ${this.workersDir()}\n` +
        `anthropicKey: ${key ? 'set' : 'none'}\n\n`
      const logPath = join(sessionDir, 'edit-log.txt')
      const flushLog = (): void => {
        try {
          writeFileSync(logPath, logBuf, 'utf8')
        } catch {
          /* logging is best-effort */
        }
      }

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
        const s = d.toString()
        logBuf += s
        buffer += s
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? '' // keep the incomplete tail
        for (const line of lines) handleLine(line)
      })
      child.stderr.on('data', (d) => {
        const s = d.toString()
        err += s
        logBuf += s
      })
      child.on('error', (e) => {
        logBuf += `\n[spawn error] ${e.message}\n(Python may not be installed / not on PATH)\n`
        flushLog()
        reject(new Error(`לא ניתן להריץ Python (${python}): ${e.message}`))
      })
      child.on('close', (code) => {
        if (buffer) handleLine(buffer)
        logBuf += `\n[exit code] ${code}\n`
        flushLog()
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
    note?: string
  } | null
  if (reels?.rendered) {
    const how = reels.selection === 'model' ? ' (בחירה חכמה)' : ''
    parts.push(`${reels.rendered} רילסים ✓${how}`)
  } else if (reels?.note) {
    parts.push(`רילסים נכשלו — ${reels.note}`)
  } else if (reels?.planned_clips) {
    parts.push(`${reels.planned_clips} רילסים (מתוכננים)`)
  }
  const meta = summary['metadata'] as { title?: string; description?: string } | null
  if (meta?.title) parts.push('כותרת ✓')
  if (meta?.description) parts.push('תיאור ✓')
  const thumb = summary['thumbnail'] as { count?: number } | null
  if (thumb?.count) parts.push(`${thumb.count} תמבנייל`)
  if (summary['brief']) parts.push('מסמך עריכה ✓')
  if (summary['ai_note']) parts.push(`⚠ ${String(summary['ai_note'])}`)
  if (summary['error']) parts.push(`שגיאה: ${summary['error']}`)
  return parts.join(' · ')
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
