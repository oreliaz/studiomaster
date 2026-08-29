import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
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

const FPS = 30

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

  /** The advanced-edit targets available for a session (basic + each reel). */
  targets(sessionId: string): EditorTarget[] {
    const root = this.workDir(sessionId)
    if (!root) return []
    const targets: EditorTarget[] = []
    const basicPlan = join(root, 'work', 'edit_plan.json')
    targets.push({ mode: 'basic', label: 'עריכה בסיסית', ready: existsSync(basicPlan) })

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
    const plan = readJson<RawPlan>(join(work, 'edit_plan.json'))
    if (!plan) return null
    const notes: string[] = []
    // The render/effect config lives in config.json (target loudness, denoise,
    // per-effect fx_* toggles); plan.config only holds planning defaults.
    const cfg: RawConfig = {
      ...(plan.config ?? {}),
      ...(readJson<RawConfig>(join(work, 'config.json')) ?? {}),
    }

    const transcript = readJson<RawTranscript>(join(work, 'transcript.json'))?.segments ?? []
    if (transcript.length === 0) notes.push('אין תמלול — הרץ עריכה בסיסית כדי לראות טקסט')

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

    const source = plan.source
    const finalPath = join(work, 'final.mp4')
    return {
      sessionId,
      mode: 'basic',
      title: basename(source),
      source,
      mediaUrl: existsSync(source) ? smMediaUrl(source) : undefined,
      outputUrl: existsSync(finalPath) ? smMediaUrl(finalPath) : undefined,
      hasOutput: existsSync(finalPath),
      fps: FPS,
      durationSec: plan.total_sec,
      kept: plan.kept.map((k) => ({ start: k.start, end: k.end })),
      transcript,
      channels,
      effects: this.effectsOf(cfg),
      config: {
        targetLufs: cfg.target_lufs ?? -16,
        trimSilence: (cfg.trim_silence as EditorProject['config']['trimSilence']) ?? 'medium',
        intro: cfg.intro ?? undefined,
        outro: cfg.outro ?? undefined,
      },
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
    const planPath = join(work, 'edit_plan.json')
    const plan = readJson<RawPlan & Record<string, unknown>>(planPath)
    if (!plan) throw new Error('edit_plan.json missing')

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
      writeFileSync(planPath, JSON.stringify(plan, null, 1), 'utf8')
    }

    // config.json — target loudness, intro/outro, per-effect toggles.
    const cfgPath = join(work, 'config.json')
    const cfg = (readJson<RawConfig & Record<string, unknown>>(cfgPath) ?? {}) as RawConfig &
      Record<string, unknown>
    if (save.config) {
      if (save.config.targetLufs !== undefined) cfg.target_lufs = save.config.targetLufs
      if (save.config.intro !== undefined) cfg.intro = save.config.intro || null
      if (save.config.outro !== undefined) cfg.outro = save.config.outro || null
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
