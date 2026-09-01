import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type {
  EditorAudioChannel,
  EditorAudioEffect,
  EditorMode,
  EditorProject,
  EditorRange,
  EditorSave,
  EditorTarget,
  EditorTranscriptSeg,
} from '@studiomaster/shared'
import type { Store } from './store.js'
import { ffprobe, ffmpegEnv } from './ffmpeg.js'

const FPS = 30

/** Media duration in seconds via ffprobe, or 0 if it can't be read. */
function probeDurationSec(path: string): number {
  if (!path || !existsSync(path)) return 0
  try {
    const r = spawnSync(
      ffprobe,
      ['-v', 'error', '-show_entries', 'format=duration', '-of',
        'default=noprint_wrappers=1:nokey=1', path],
      { encoding: 'utf8', env: ffmpegEnv() },
    )
    const v = parseFloat((r.stdout ?? '').trim())
    return Number.isFinite(v) ? v : 0
  } catch {
    return 0
  }
}

/** Build the sm-media:// URL the renderer's <video> loads for a local file. */
export function smMediaUrl(path: string): string {
  return `sm-media://media/?p=${encodeURIComponent(path)}`
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return null
  }
}

/** The removed spans between kept ranges (for display + plan bookkeeping). */
function removalsOf(kept: EditorRange[], total: number): EditorRange[] {
  const out: EditorRange[] = []
  let cur = 0
  for (const k of [...kept].sort((a, b) => a.start - b.start)) {
    if (k.start > cur + 0.02) out.push({ start: cur, end: k.start })
    cur = Math.max(cur, k.end)
  }
  if (total - cur > 0.02) out.push({ start: cur, end: total })
  return out
}

const EFFECT_META: Record<EditorAudioEffect['id'], { label: string; detail: (c: RawConfig) => string }> = {
  highpass: { label: 'סינון תדרים נמוכים', detail: (c) => `${c.highpass_hz ?? 80} Hz` },
  denoise: { label: 'הפחתת רעש', detail: (c) => (c.denoise && c.denoise !== 'none' ? c.denoise : '—') },
  dynaudnorm: { label: 'איזון עוצמה', detail: (c) => (c.dialogue_level === 'strong' ? 'חזק' : 'עדין') },
  acompressor: { label: 'דחיסה', detail: (c) => (c.dialogue_level === 'strong' ? 'חזק' : 'עדין') },
}

interface RawConfig {
  target_lufs?: number
  intro?: string | null
  outro?: string | null
  trim_silence?: string
  highpass_hz?: number
  denoise?: string
  dialogue_level?: string
  fx_highpass?: boolean
  fx_denoise?: boolean
  fx_dynaudnorm?: boolean
  fx_acompressor?: boolean
  intro_cue_sec?: number
}
interface RawPlan {
  source: string
  total_sec: number
  kept_sec?: number
  kept: EditorRange[]
  config?: RawConfig
}
interface RawTranscript {
  segments: EditorTranscriptSeg[]
}
interface RawChannel {
  index: number
  label: string
  isMixdown: boolean
  meanDb: number | null
  maxDb: number | null
  active: boolean
  gainDb: number
}

/**
 * EditorService — read/write bridge between the timeline editor UI and a
 * session's on-disk edit artifacts (edit_plan.json, config.json,
 * audio_channels.json, reel_specs.txt, captions). Loading never renders; saving
 * only writes files. Re-rendering is driven separately via AiEditor.reedit.
 */
export class EditorService {
  constructor(private readonly store: Store) {}

  private workDir(sessionId: string): string | null {
    const session = this.store.getSession(sessionId)
    return session?.storagePath ? session.storagePath : null
  }

  private capturePath(sessionId: string): string {
    return this.store.getSession(sessionId)?.capturePath ?? ''
  }

  /** The advanced-edit targets available for a session (basic + each reel). */
  targets(sessionId: string): EditorTarget[] {
    const root = this.workDir(sessionId)
    if (!root) return []
    const targets: EditorTarget[] = []
    const basicPlan = join(root, 'work', 'edit_plan.json')
    // Basic editing is available even before any auto-edit: from a raw
    // recording the user can cut purely on the timeline.
    const capture = this.capturePath(sessionId)
    targets.push({
      mode: 'basic',
      label: 'עריכה בסיסית',
      ready: existsSync(basicPlan) || existsSync(capture),
    })

    // One entry per reel that has a spec (rendered or not).
    const specs = this.readReelSpecs(root)
    const outDir = join(root, 'out_final')
    for (const { id, slug } of specs) {
      const rendered = existsSync(join(outDir, `${id}.mp4`))
      targets.push({
        mode: 'reel',
        reelId: id,
        label: `רילס ${id}${slug ? ` · ${slug}` : ''}`,
        ready: rendered || existsSync(join(root, 'clips')),
      })
    }
    return targets
  }

  load(sessionId: string, mode: EditorMode, reelId?: string): EditorProject | null {
    const root = this.workDir(sessionId)
    if (!root) return null
    return mode === 'reel'
      ? this.loadReel(sessionId, root, reelId ?? '')
      : this.loadBasic(sessionId, root)
  }

  private loadBasic(sessionId: string, root: string): EditorProject | null {
    const work = join(root, 'work')
    const notes: string[] = []
    // config.json lives at the session ROOT (render_final reads dirname(work)).
    const cfg: RawConfig = readJson<RawConfig>(join(root, 'config.json')) ?? {}

    const plan = readJson<RawPlan>(join(work, 'edit_plan.json'))
    const capture = this.capturePath(sessionId)

    // Source + full timeline: from the plan when it exists, else synthesised
    // from the raw recording so the user can cut on the timeline with no edit yet.
    let source: string
    let durationSec: number
    let kept: EditorRange[]
    let fromScratch = false
    if (plan) {
      Object.assign(cfg, plan.config ?? {}, readJson<RawConfig>(join(root, 'config.json')) ?? {})
      source = plan.source
      durationSec = plan.total_sec
      kept = plan.kept.map((k) => ({ start: k.start, end: k.end }))
    } else {
      source = capture
      durationSec = probeDurationSec(capture)
      if (durationSec <= 0) return null // nothing to edit
      kept = [{ start: 0, end: durationSec }]
      fromScratch = true
      notes.push('הפרק טרם נערך — חתוך על ציר הזמן והפעל "ערוך מחדש"')
    }

    const transcript = readJson<RawTranscript>(join(work, 'transcript.json'))?.segments ?? []
    if (transcript.length === 0 && !fromScratch)
      notes.push('אין תמלול — ניתן לערוך על בסיס ציר הזמן בלבד')

    const rawChannels = readJson<{ channels: RawChannel[] }>(join(work, 'audio_channels.json'))
    const channels: EditorAudioChannel[] = (rawChannels?.channels ?? []).map((c) => ({
      index: c.index,
      label: c.label,
      active: c.active,
      gainDb: c.gainDb,
      meanDb: c.meanDb,
      maxDb: c.maxDb,
      isMixdown: c.isMixdown,
    }))
    if (channels.length === 0) notes.push('ערוצי הסאונד ינותחו בעריכה הבאה')

    const finalPath = join(work, 'final.mp4')
    const intro = cfg.intro ?? undefined
    const outro = cfg.outro ?? undefined
    return {
      sessionId,
      mode: 'basic',
      title: basename(source || 'recording'),
      source,
      mediaUrl: existsSync(source) ? smMediaUrl(source) : undefined,
      outputUrl: existsSync(finalPath) ? smMediaUrl(finalPath) : undefined,
      hasOutput: existsSync(finalPath),
      fps: FPS,
      durationSec,
      kept,
      transcript,
      channels,
      effects: this.effectsOf(cfg),
      config: {
        targetLufs: cfg.target_lufs ?? -16,
        trimSilence: (cfg.trim_silence as EditorProject['config']['trimSilence']) ?? 'medium',
        intro,
        outro,
      },
      introSec: intro && existsSync(intro) ? probeDurationSec(intro) : undefined,
      outroSec: outro && existsSync(outro) ? probeDurationSec(outro) : undefined,
      introCueSec: typeof cfg.intro_cue_sec === 'number' ? cfg.intro_cue_sec : null,
      fromScratch,
      notes,
    }
  }

  private loadReel(sessionId: string, root: string, reelId: string): EditorProject | null {
    const specs = this.readReelSpecs(root)
    const spec = specs.find((s) => s.id === reelId)
    if (!spec) return null
    const notes: string[] = []
    const window: EditorRange = { start: spec.start, end: spec.end }

    const clip = this.findClip(root, reelId)
    const outPath = join(root, 'out_final', `${reelId}.mp4`)
    const hooks = readJson<Record<string, string>>(join(root, 'reel_hooks.json')) ?? {}
    const captionsRaw =
      readJson<{ start: number; end: number; text: string }[]>(
        join(root, 'captions', `${reelId}.json`),
      ) ?? []

    // Transcript around the window, shifted to clip-relative time for the timeline.
    const full = readJson<RawTranscript>(join(root, 'transcript.json'))?.segments ?? []
    const transcript: EditorTranscriptSeg[] = full
      .filter((s) => s.end > window.start && s.start < window.end)
      .map((s) => ({
        start: Math.max(0, s.start - window.start),
        end: Math.min(window.end - window.start, s.end - window.start),
        text: s.text,
      }))
    if (transcript.length === 0 && captionsRaw.length === 0)
      notes.push('אין תמלול/כתוביות עדיין — הרץ רילסים')

    return {
      sessionId,
      mode: 'reel',
      reelId,
      reelSlug: spec.slug,
      title: `רילס ${reelId}${spec.slug ? ` · ${spec.slug}` : ''}`,
      source: clip ?? '',
      mediaUrl: clip && existsSync(clip) ? smMediaUrl(clip) : undefined,
      outputUrl: existsSync(outPath) ? smMediaUrl(outPath) : undefined,
      hasOutput: existsSync(outPath),
      fps: FPS,
      durationSec: Math.max(0, window.end - window.start),
      kept: [],
      window,
      hook: hooks[reelId] ?? '',
      transcript,
      captions: captionsRaw,
      channels: [],
      effects: [],
      config: { targetLufs: -16, trimSilence: 'medium' },
      notes,
    }
  }

  private effectsOf(cfg: RawConfig): EditorAudioEffect[] {
    const on = (flag: boolean | undefined, fallback: boolean): boolean =>
      flag === undefined ? fallback : flag
    // Render defaults are all-on unless config explicitly disables them, so a
    // never-touched episode shows the effects that actually ran.
    const base: { id: EditorAudioEffect['id']; enabled: boolean }[] = [
      { id: 'highpass', enabled: on(cfg.fx_highpass, cfg.highpass_hz !== 0) },
      { id: 'denoise', enabled: on(cfg.fx_denoise, cfg.denoise !== 'none') },
      { id: 'dynaudnorm', enabled: on(cfg.fx_dynaudnorm, cfg.dialogue_level !== 'off') },
      { id: 'acompressor', enabled: on(cfg.fx_acompressor, cfg.dialogue_level !== 'off') },
    ]
    return base.map((e) => ({
      ...e,
      label: EFFECT_META[e.id].label,
      detail: EFFECT_META[e.id].detail(cfg),
    }))
  }

  save(save: EditorSave): { ok: boolean; error?: string } {
    const root = this.workDir(save.sessionId)
    if (!root) return { ok: false, error: 'session not found' }
    try {
      if (save.mode === 'reel') this.saveReel(root, save)
      else this.saveBasic(root, save)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  private saveBasic(root: string, save: EditorSave): void {
    const work = join(root, 'work')
    mkdirSync(work, { recursive: true })
    const planPath = join(work, 'edit_plan.json')
    // Create a plan from the raw recording if none exists (editing from scratch).
    let plan = readJson<RawPlan & Record<string, unknown>>(planPath)
    if (!plan) {
      const source = this.capturePath(save.sessionId)
      const total = probeDurationSec(source)
      if (!source || total <= 0) throw new Error('no recording to edit')
      plan = {
        source,
        total_sec: round3(total),
        kept: [{ start: 0, end: round3(total) }],
        config: {},
      } as RawPlan & Record<string, unknown>
    }

    if (save.kept) {
      const kept = save.kept
        .map((k) => ({ start: round3(k.start), end: round3(k.end) }))
        .filter((k) => k.end - k.start > 0.02)
        .sort((a, b) => a.start - b.start)
      const total = plan.total_sec
      const keptSec = kept.reduce((s, k) => s + (k.end - k.start), 0)
      const removals = removalsOf(kept, total).map((r) => ({
        start: round3(r.start),
        end: round3(r.end),
        dur: round3(r.end - r.start),
        reason: 'manual',
        src: 'editor',
      }))
      plan.kept = kept
      plan.kept_sec = round3(keptSec)
      plan.removed_sec = round3(total - keptSec)
      plan.n_removals = removals.length
      plan.removals = removals
    }
    writeFileSync(planPath, JSON.stringify(plan, null, 1), 'utf8')

    // config.json — at the session ROOT (render_final reads dirname(work)).
    const cfgPath = join(root, 'config.json')
    const cfg = (readJson<RawConfig & Record<string, unknown>>(cfgPath) ?? {}) as RawConfig &
      Record<string, unknown>
    if (!cfg.source) cfg.source = plan.source // so render can resolve the input
    if (save.config) {
      if (save.config.targetLufs !== undefined) cfg.target_lufs = save.config.targetLufs
      if (save.config.intro !== undefined) cfg.intro = save.config.intro || null
      if (save.config.outro !== undefined) cfg.outro = save.config.outro || null
    }
    if (save.introCueSec !== undefined) {
      if (save.introCueSec === null) delete cfg.intro_cue_sec
      else cfg.intro_cue_sec = round3(save.introCueSec)
    }
    if (save.effects) {
      for (const e of save.effects) {
        if (e.id === 'highpass') cfg.fx_highpass = e.enabled
        if (e.id === 'denoise') cfg.fx_denoise = e.enabled
        if (e.id === 'dynaudnorm') cfg.fx_dynaudnorm = e.enabled
        if (e.id === 'acompressor') cfg.fx_acompressor = e.enabled
      }
    }
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8')

    // audio_channels.json — the per-channel active/gain override render honours.
    if (save.channels) {
      const chPath = join(work, 'audio_channels.json')
      const existing = readJson<{ channels: RawChannel[] }>(chPath)?.channels ?? []
      const byIndex = new Map(existing.map((c) => [c.index, c]))
      for (const c of save.channels) {
        const prev = byIndex.get(c.index)
        if (prev) {
          prev.active = c.active
          prev.gainDb = round1(c.gainDb)
        } else {
          byIndex.set(c.index, {
            index: c.index,
            label: `מיקרופון ${c.index}`,
            isMixdown: c.index === 0,
            meanDb: null,
            maxDb: null,
            active: c.active,
            gainDb: round1(c.gainDb),
          })
        }
      }
      const channels = [...byIndex.values()].sort((a, b) => a.index - b.index)
      writeFileSync(chPath, JSON.stringify({ channels }, null, 1), 'utf8')
    }
  }

  private saveReel(root: string, save: EditorSave): void {
    const specsPath = join(root, 'reel_specs.txt')
    if (!save.reelId) throw new Error('reelId required')
    const specs = this.readReelSpecs(root)
    const target = specs.find((s) => s.id === save.reelId)
    if (!target) throw new Error(`reel ${save.reelId} not found`)
    if (save.window) {
      target.start = round1(save.window.start)
      target.end = round1(save.window.end)
    }
    const lines = specs.map((s) => `${s.id}:${s.start}:${s.end}:${s.slug}`)
    writeFileSync(specsPath, lines.join('\n') + '\n', 'utf8')

    if (save.hook !== undefined) {
      const hooksPath = join(root, 'reel_hooks.json')
      const hooks = readJson<Record<string, string>>(hooksPath) ?? {}
      hooks[save.reelId] = save.hook
      writeFileSync(hooksPath, JSON.stringify(hooks, null, 1), 'utf8')
    }
  }

  private readReelSpecs(root: string): { id: string; start: number; end: number; slug: string }[] {
    const path = join(root, 'reel_specs.txt')
    if (!existsSync(path)) return []
    return readFileSync(path, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const parts = l.split(':')
        return {
          id: parts[0] ?? '',
          start: Number(parts[1]),
          end: Number(parts[2]),
          slug: parts[3] ?? '',
        }
      })
      .filter((s) => s.id && Number.isFinite(s.start) && Number.isFinite(s.end))
  }

  private findClip(root: string, reelId: string): string | null {
    const dir = join(root, 'clips')
    if (!existsSync(dir)) return null
    const match = readdirSync(dir).find((f) => f.startsWith(`${reelId}_`) && f.endsWith('.mp4'))
    return match ? join(dir, match) : null
  }
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}
function round1(n: number): number {
  return Math.round(n * 10) / 10
}
