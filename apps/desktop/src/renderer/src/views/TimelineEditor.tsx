import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AiProgress,
  EditorAudioChannel,
  EditorAudioEffect,
  EditorMode,
  EditorProject,
  EditorRange,
  EditorSave,
} from '@studiomaster/shared'
import { t } from '../i18n.js'

/** m:ss.mmm — millisecond-precise time label. */
function fmtMs(sec: number): string {
  const s = Math.max(0, sec)
  const m = Math.floor(s / 60)
  const rest = s - m * 60
  return `${m}:${rest.toFixed(3).padStart(6, '0')}`
}

interface Props {
  sessionId: string
  mode: EditorMode
  reelId?: string
  onClose: () => void
}

/**
 * TimelineEditor — a Premiere-like review of one edited target (the basic edit
 * or a single reel). It shows the video, a time ruler, the transcript, and the
 * cuts, and lets the user nudge cut/clip boundaries to the millisecond, tune the
 * per-channel gains and the effect chain, then re-render — driving the very same
 * pipeline the automatic editor uses.
 */
export function TimelineEditor({ sessionId, mode, reelId, onClose }: Props): JSX.Element {
  const [project, setProject] = useState<EditorProject | null>(null)
  const [error, setError] = useState('')
  const [kept, setKept] = useState<EditorRange[]>([])
  const [win, setWin] = useState<EditorRange>({ start: 0, end: 0 })
  const [hook, setHook] = useState('')
  const [channels, setChannels] = useState<EditorAudioChannel[]>([])
  const [effects, setEffects] = useState<EditorAudioEffect[]>([])
  const [targetLufs, setTargetLufs] = useState(-16)
  const [intro, setIntro] = useState('')
  const [outro, setOutro] = useState('')
  const [introCue, setIntroCue] = useState<number | null>(null)
  const [zoom, setZoom] = useState(14) // px per second
  const [time, setTime] = useState(0)
  const [showOutput, setShowOutput] = useState(false)
  const [reediting, setReediting] = useState(false)
  const [progress, setProgress] = useState<AiProgress | null>(null)
  const [savedTick, setSavedTick] = useState(false)
  const [mediaVersion, setMediaVersion] = useState(0) // cache-buster after re-render

  const videoRef = useRef<HTMLVideoElement>(null)

  // Seed every editable field from a freshly-loaded project (initial + reload
  // after a re-edit, so the timeline always reflects what's on disk).
  const applyProject = useCallback((p: EditorProject): void => {
    setProject(p)
    setKept(p.kept)
    if (p.window) setWin(p.window)
    setHook(p.hook ?? '')
    setChannels(p.channels)
    setEffects(p.effects)
    setTargetLufs(p.config.targetLufs)
    setIntro(p.config.intro ?? '')
    setOutro(p.config.outro ?? '')
    setIntroCue(p.introCueSec ?? null)
  }, [])

  useEffect(() => {
    let alive = true
    void window.studiomaster.editor.load(sessionId, mode, reelId).then((p) => {
      if (!alive) return
      if (!p) setError(t('editor.loadFailed'))
      else applyProject(p)
    })
    return () => {
      alive = false
    }
  }, [sessionId, mode, reelId, applyProject])

  useEffect(() => {
    return window.studiomaster.onAiProgress((p) => {
      if (p.sessionId !== sessionId) return
      setProgress(p)
      if (p.phase === 'done' || p.phase === 'error') {
        setReediting(false)
        // Reload so the timeline + rendered output reflect the new render.
        void window.studiomaster.editor.load(sessionId, mode, reelId).then((np) => {
          if (!np) return
          applyProject(np)
          setMediaVersion((v) => v + 1)
          if (np.hasOutput) setShowOutput(true)
        })
      }
    })
  }, [sessionId, mode, reelId, applyProject])

  const duration = project?.durationSec ?? 0
  const baseMedia = showOutput && project?.outputUrl ? project.outputUrl : project?.mediaUrl
  // Append a version so the <video> reloads the freshly-rendered file.
  const mediaUrl = baseMedia
    ? `${baseMedia}${baseMedia.includes('?') ? '&' : '?'}v=${mediaVersion}`
    : undefined

  const pendingSeek = useRef<number | null>(null)
  // Seek the preview. `toSource` (transcript/timeline clicks in basic mode)
  // flips the preview back to the source so the frame matches the word's
  // source-time; if the src has to swap, the seek is applied once it reloads.
  const seek = useCallback(
    (sec: number, toSource = false) => {
      const target = Math.max(0, sec)
      if (toSource && showOutput) {
        pendingSeek.current = target
        setShowOutput(false)
        return
      }
      const v = videoRef.current
      if (v) v.currentTime = target
    },
    [showOutput],
  )
  const timelineSeek = useCallback(
    (sec: number) => seek(sec, mode === 'basic'),
    [seek, mode],
  )

  const collectSave = (): EditorSave => {
    if (mode === 'reel') {
      return { sessionId, mode, reelId, window: win, hook }
    }
    return {
      sessionId,
      mode,
      kept,
      channels: channels.map((c) => ({ index: c.index, active: c.active, gainDb: c.gainDb })),
      effects: effects.map((e) => ({ id: e.id, enabled: e.enabled })),
      config: { targetLufs, intro: intro || undefined, outro: outro || undefined },
      introCueSec: intro ? introCue : null,
    }
  }

  const save = async (): Promise<void> => {
    const res = await window.studiomaster.editor.save(collectSave())
    if (!res.ok) {
      alert(`${t('editor.saveFailed')}: ${res.error ?? ''}`)
      return
    }
    setSavedTick(true)
    setTimeout(() => setSavedTick(false), 1500)
  }

  const reedit = async (): Promise<void> => {
    setReediting(true)
    setProgress(null)
    const res = await window.studiomaster.editor.reedit(collectSave())
    if (!res.ok) {
      setReediting(false)
      alert(`${t('editor.reeditFailed')}: ${res.error ?? ''}`)
    }
  }

  // ── cut editing (basic) ──────────────────────────────────────────────────
  const updateKept = (i: number, patch: Partial<EditorRange>): void => {
    setKept((prev) => prev.map((k, idx) => (idx === i ? { ...k, ...patch } : k)))
  }
  const splitAtPlayhead = (): void => {
    const gapBefore = 0.4
    setKept((prev) => {
      const out: EditorRange[] = []
      for (const k of prev) {
        if (time > k.start + 0.1 && time < k.end - 0.1) {
          // Remove a small gap around the playhead (a manual cut).
          out.push({ start: k.start, end: Math.max(k.start, time - gapBefore) })
          out.push({ start: time, end: k.end })
        } else {
          out.push(k)
        }
      }
      return out.filter((r) => r.end - r.start > 0.02)
    })
  }
  const removeRange = (i: number): void => setKept((prev) => prev.filter((_, idx) => idx !== i))

  if (error) {
    return (
      <div className="tl-overlay">
        <div className="tl-modal tl-modal--msg">
          <p className="error">{error}</p>
          <button className="btn" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    )
  }
  if (!project) {
    return (
      <div className="tl-overlay">
        <div className="tl-modal tl-modal--msg">
          <p className="hint">{t('editor.loading')}</p>
        </div>
      </div>
    )
  }

  const width = Math.max(320, duration * zoom)

  return (
    <div className="tl-overlay" onClick={onClose}>
      <div className="tl-modal" onClick={(e) => e.stopPropagation()}>
        <header className="tl-head">
          <div>
            <h2>{project.title}</h2>
            <span className="hint">
              {mode === 'basic' ? t('editor.basicMode') : t('editor.reelMode')} ·{' '}
              {fmtMs(duration)}
            </span>
          </div>
          <div className="tl-head__actions">
            {project.hasOutput && (
              <label className="check check--inline">
                <input
                  type="checkbox"
                  checked={showOutput}
                  onChange={(e) => setShowOutput(e.target.checked)}
                />
                {t('editor.showOutput')}
              </label>
            )}
            <button className="btn btn--small" onClick={save} disabled={reediting}>
              {savedTick ? t('review.saved') : t('editor.save')}
            </button>
            <button className="btn btn--small btn--primary" onClick={reedit} disabled={reediting}>
              {reediting ? t('editor.rendering') : t('editor.reedit')}
            </button>
            {project.hasOutput && (
              <button
                className="btn btn--small"
                onClick={() => window.studiomaster.editor.openOutput(sessionId, mode, reelId)}
                title={t('editor.openFileHint')}
              >
                📂 {t('editor.openFile')}
              </button>
            )}
            <button className="btn btn--small btn--ghost" onClick={onClose}>
              {t('common.close')}
            </button>
          </div>
        </header>

        {project.notes.map((n, i) => (
          <p key={i} className="hint tl-note">
            ⚠ {n}
          </p>
        ))}
        {reediting && (
          <div className="tl-progress">
            <div className="tl-progress__bar" style={{ width: `${(progress?.frac ?? 0) * 100}%` }} />
            <span className="tl-progress__label">{progress?.detail ?? t('editor.rendering')}</span>
          </div>
        )}

        <div className="tl-body">
          <div className="tl-left">
            {mediaUrl ? (
              <video
                ref={videoRef}
                className="tl-video"
                src={mediaUrl}
                controls
                onTimeUpdate={(e) => setTime((e.target as HTMLVideoElement).currentTime)}
                onLoadedData={(e) => {
                  if (pendingSeek.current != null) {
                    ;(e.target as HTMLVideoElement).currentTime = pendingSeek.current
                    pendingSeek.current = null
                  }
                }}
              />
            ) : (
              <div className="tl-video tl-video--missing">
                <p className="hint">{t('editor.noPreview')}</p>
              </div>
            )}
            <div className="tl-playhead-read">
              ⏱ {fmtMs(time)}
              <div className="tl-zoom">
                <button className="btn btn--tiny" onClick={() => setZoom((z) => Math.max(4, z - 4))}>
                  −
                </button>
                <span className="hint">{t('editor.zoom')}</span>
                <button className="btn btn--tiny" onClick={() => setZoom((z) => Math.min(80, z + 4))}>
                  +
                </button>
              </div>
            </div>

            {mode === 'basic' && (intro || outro) && (
              <AssemblyStrip
                hasIntro={!!intro}
                hasOutro={!!outro}
                introSec={project.introSec}
                outroSec={project.outroSec}
                bodySec={kept.reduce((s, k) => s + Math.max(0, k.end - k.start), 0)}
                introAtStart={introCue == null || introCue <= 0.5}
              />
            )}

            {/* Timeline: ruler + transcript + cuts/window */}
            <div className="tl-scroll">
              <div className="tl-track-area" style={{ width }}>
                <Ruler duration={duration} zoom={zoom} onSeek={timelineSeek} />
                <TranscriptLane segments={project.transcript} zoom={zoom} onSeek={timelineSeek} />
                {mode === 'basic' ? (
                  <CutsLane
                    kept={kept}
                    onChange={setKept}
                    duration={duration}
                    zoom={zoom}
                    onSeek={timelineSeek}
                  />
                ) : (
                  <WindowLane window={win} onChange={setWin} duration={duration} zoom={zoom} />
                )}
                {mode === 'basic' && intro && introCue != null && (
                  <IntroCueMarker
                    cue={introCue}
                    duration={duration}
                    zoom={zoom}
                    onChange={setIntroCue}
                  />
                )}
                <div className="tl-playhead" style={{ insetInlineStart: time * zoom }} />
              </div>
            </div>
            <p className="hint tl-lane-hint">{t('editor.laneHint')}</p>
          </div>

          <aside className="tl-side">
            {mode === 'basic' ? (
              <>
                <section className="tl-panel">
                  <h3>{t('editor.cuts')}</h3>
                  <button className="btn btn--tiny" onClick={splitAtPlayhead}>
                    ✂ {t('editor.splitHere')}
                  </button>
                  <ul className="tl-cuts">
                    {kept.map((k, i) => (
                      <li key={i} className="tl-cut">
                        <span className="tl-cut__n">{i + 1}</span>
                        <MsInput
                          value={k.start}
                          onChange={(v) => updateKept(i, { start: v })}
                          onSeek={seek}
                        />
                        <span>→</span>
                        <MsInput
                          value={k.end}
                          onChange={(v) => updateKept(i, { end: v })}
                          onSeek={seek}
                        />
                        <button
                          className="btn btn--tiny btn--danger"
                          onClick={() => removeRange(i)}
                          title={t('editor.removeSegment')}
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>

                <section className="tl-panel">
                  <h3>{t('editor.channels')}</h3>
                  {channels.length === 0 && <p className="hint">{t('editor.noChannels')}</p>}
                  {channels.map((c, i) => (
                    <div key={c.index} className={`tl-chan ${c.isMixdown ? 'tl-chan--mix' : ''}`}>
                      <label className="check check--inline">
                        <input
                          type="checkbox"
                          checked={c.active}
                          onChange={(e) =>
                            setChannels((prev) =>
                              prev.map((x, idx) =>
                                idx === i ? { ...x, active: e.target.checked } : x,
                              ),
                            )
                          }
                        />
                        {c.label}
                        {c.isMixdown && <span className="tl-tag">{t('editor.mixdown')}</span>}
                      </label>
                      <div className="tl-chan__meta">
                        {c.meanDb != null && <span>{c.meanDb.toFixed(0)} dB</span>}
                      </div>
                      <div className="tl-gain">
                        <input
                          type="range"
                          min={-15}
                          max={15}
                          step={0.5}
                          value={c.gainDb}
                          disabled={!c.active}
                          onChange={(e) =>
                            setChannels((prev) =>
                              prev.map((x, idx) =>
                                idx === i ? { ...x, gainDb: Number(e.target.value) } : x,
                              ),
                            )
                          }
                        />
                        <span className="tl-gain__val">
                          {c.gainDb > 0 ? '+' : ''}
                          {c.gainDb.toFixed(1)} dB
                        </span>
                      </div>
                    </div>
                  ))}
                </section>

                <section className="tl-panel">
                  <h3>{t('editor.effects')}</h3>
                  {effects.map((fx, i) => (
                    <label key={fx.id} className="check check--inline tl-fx">
                      <input
                        type="checkbox"
                        checked={fx.enabled}
                        onChange={(e) =>
                          setEffects((prev) =>
                            prev.map((x, idx) =>
                              idx === i ? { ...x, enabled: e.target.checked } : x,
                            ),
                          )
                        }
                      />
                      {fx.label}
                      <span className="tl-fx__detail">{fx.detail}</span>
                    </label>
                  ))}
                  <p className="hint tl-fx__count">
                    {t('editor.effectsActive').replace(
                      '{n}',
                      String(effects.filter((e) => e.enabled).length),
                    )}
                  </p>
                </section>

                {project.transcript.length > 0 && (
                  <section className="tl-panel">
                    <h3>{t('editor.transcript')}</h3>
                    <p className="hint">{t('editor.transcriptHint')}</p>
                    <ul className="tl-caps">
                      {project.transcript.map((s, i) => (
                        <li key={i} onClick={() => seek(s.start, true)}>
                          <span className="tl-caps__tc">{fmtMs(s.start)}</span> {s.text}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                <section className="tl-panel">
                  <h3>{t('editor.output')}</h3>
                  <label className="field field--inline">
                    <span>{t('editor.targetLufs')}</span>
                    <input
                      type="number"
                      value={targetLufs}
                      onChange={(e) => setTargetLufs(Number(e.target.value))}
                    />
                  </label>
                  <label className="field">
                    <span>{t('review.intro')}</span>
                    <input value={intro} onChange={(e) => setIntro(e.target.value)} />
                  </label>
                  {intro && (
                    <div className="tl-cue-row">
                      <label className="check check--inline">
                        <input
                          type="checkbox"
                          checked={introCue != null}
                          onChange={(e) => setIntroCue(e.target.checked ? time : null)}
                        />
                        {t('editor.introCue')}
                      </label>
                      {introCue != null && (
                        <div className="tl-cue-row__set">
                          <MsInput value={introCue} onChange={setIntroCue} onSeek={seek} />
                          <button className="btn btn--tiny" onClick={() => setIntroCue(time)}>
                            {t('editor.cueAtPlayhead')}
                          </button>
                        </div>
                      )}
                      <p className="hint">{t('editor.introCueHint')}</p>
                    </div>
                  )}
                  <label className="field">
                    <span>{t('review.outro')}</span>
                    <input value={outro} onChange={(e) => setOutro(e.target.value)} />
                  </label>
                </section>
              </>
            ) : (
              <>
                <section className="tl-panel">
                  <h3>{t('editor.window')}</h3>
                  <div className="tl-cut">
                    <MsInput value={win.start} onChange={(v) => setWin((w) => ({ ...w, start: v }))} onSeek={() => undefined} />
                    <span>→</span>
                    <MsInput value={win.end} onChange={(v) => setWin((w) => ({ ...w, end: v }))} onSeek={() => undefined} />
                  </div>
                  <p className="hint">{t('editor.reelLen').replace('{len}', fmtMs(Math.max(0, win.end - win.start)))}</p>
                </section>
                <section className="tl-panel">
                  <h3>{t('editor.hook')}</h3>
                  <textarea value={hook} onChange={(e) => setHook(e.target.value)} rows={2} />
                </section>
                {project.captions && project.captions.length > 0 && (
                  <section className="tl-panel">
                    <h3>{t('editor.captions')}</h3>
                    <ul className="tl-caps">
                      {project.captions.map((c, i) => (
                        <li key={i} onClick={() => seek(c.start)}>
                          <span className="tl-caps__tc">{fmtMs(c.start)}</span> {c.text}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}

/** A numeric input in seconds with millisecond precision + a seek-to button. */
function MsInput({
  value,
  onChange,
  onSeek,
}: {
  value: number
  onChange: (v: number) => void
  onSeek: (v: number) => void
}): JSX.Element {
  return (
    <span className="tl-ms">
      <input
        type="number"
        step={0.001}
        value={Number(value.toFixed(3))}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <button className="btn btn--tiny" title="⏱" onClick={() => onSeek(value)}>
        ⏱
      </button>
    </span>
  )
}

function Ruler({
  duration,
  zoom,
  onSeek,
}: {
  duration: number
  zoom: number
  onSeek: (s: number) => void
}): JSX.Element {
  const step = zoom < 8 ? 30 : zoom < 20 ? 10 : 5 // seconds between labels
  const ticks: number[] = []
  for (let s = 0; s <= duration; s += step) ticks.push(s)
  return (
    <div
      className="tl-ruler"
      onClick={(e) => {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
        const x = Math.abs(e.clientX - rect.left)
        onSeek(x / zoom)
      }}
    >
      {ticks.map((s) => (
        <span key={s} className="tl-ruler__tick" style={{ insetInlineStart: s * zoom }}>
          {fmtMs(s).replace(/\.\d+$/, '')}
        </span>
      ))}
    </div>
  )
}

function TranscriptLane({
  segments,
  zoom,
  onSeek,
}: {
  segments: EditorProject['transcript']
  zoom: number
  onSeek: (s: number) => void
}): JSX.Element {
  return (
    <div className="tl-lane tl-lane--txt">
      {segments.map((s, i) => (
        <button
          key={i}
          className="tl-seg"
          style={{ insetInlineStart: s.start * zoom, width: Math.max(6, (s.end - s.start) * zoom) }}
          title={s.text}
          onClick={() => onSeek(s.start)}
        >
          {s.text}
        </button>
      ))}
    </div>
  )
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))
const MIN_LEN = 0.05

type DragKind = 'move' | 'l' | 'r'
interface DragState {
  kind: DragKind
  index: number
  startX: number
  orig: EditorRange
}
interface Menu {
  x: number
  y: number
  sec: number
  index: number | null // green block index, or null for a red gap
}

/**
 * Interactive cuts lane. Green blocks are the kept segments; the striped red is
 * removed. Drag a block's body to move it, drag its edges to resize (to the
 * millisecond), right-click a block to split/delete it, and right-click the red
 * to restore that gap — the numeric list stays in sync.
 */
function CutsLane({
  kept,
  onChange,
  duration,
  zoom,
  onSeek,
}: {
  kept: EditorRange[]
  onChange: (next: EditorRange[]) => void
  duration: number
  zoom: number
  onSeek: (s: number) => void
}): JSX.Element {
  const laneRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)

  const sorted = [...kept].sort((a, b) => a.start - b.start)
  const secAt = (clientX: number): number => {
    const rect = laneRef.current?.getBoundingClientRect()
    if (!rect) return 0
    return clamp((clientX - rect.left) / zoom, 0, duration)
  }

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      const rect = laneRef.current?.getBoundingClientRect()
      if (!rect) return
      const cursor = clamp((e.clientX - rect.left) / zoom, 0, duration)
      const list = [...kept].sort((a, b) => a.start - b.start)
      const prevEnd = d.index > 0 ? list[d.index - 1]!.end : 0
      const nextStart = d.index < list.length - 1 ? list[d.index + 1]!.start : duration
      const cur = list[d.index]!
      let start = cur.start
      let end = cur.end
      if (d.kind === 'l') {
        start = clamp(cursor, prevEnd, end - MIN_LEN)
      } else if (d.kind === 'r') {
        end = clamp(cursor, start + MIN_LEN, nextStart)
      } else {
        const len = d.orig.end - d.orig.start
        const deltaSec = (e.clientX - d.startX) / zoom
        start = clamp(d.orig.start + deltaSec, prevEnd, nextStart - len)
        end = start + len
      }
      list[d.index] = { start, end }
      onChange(list)
    },
    [kept, zoom, duration, onChange],
  )

  const endDrag = useCallback(() => {
    dragRef.current = null
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', endDrag)
  }, [onPointerMove])

  const startDrag = (e: React.PointerEvent, kind: DragKind, index: number): void => {
    e.preventDefault()
    e.stopPropagation()
    const list = [...kept].sort((a, b) => a.start - b.start)
    dragRef.current = { kind, index, startX: e.clientX, orig: { ...list[index]! } }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', endDrag)
  }

  useEffect(() => () => endDrag(), [endDrag])
  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [menu])

  // ── menu actions ─────────────────────────────────────────────────────────
  const splitAt = (index: number, sec: number): void => {
    const list = [...kept].sort((a, b) => a.start - b.start)
    const b = list[index]!
    if (sec <= b.start + MIN_LEN || sec >= b.end - MIN_LEN) return
    list.splice(index, 1, { start: b.start, end: sec }, { start: sec, end: b.end })
    onChange(list)
  }
  const deleteAt = (index: number): void => {
    const list = [...kept].sort((a, b) => a.start - b.start)
    list.splice(index, 1)
    onChange(list)
  }
  const restoreGapAt = (sec: number): void => {
    // Grow the kept set to cover the red gap the cursor is in.
    const list = [...kept].sort((a, b) => a.start - b.start)
    let gapStart = 0
    let gapEnd = duration
    for (const k of list) {
      if (k.end <= sec) gapStart = k.end
      if (k.start >= sec) {
        gapEnd = k.start
        break
      }
    }
    if (gapEnd - gapStart < MIN_LEN) return
    list.push({ start: gapStart, end: gapEnd })
    list.sort((a, b) => a.start - b.start)
    // Merge any now-touching ranges.
    const merged: EditorRange[] = []
    for (const k of list) {
      const last = merged[merged.length - 1]
      if (last && k.start <= last.end + 0.001) last.end = Math.max(last.end, k.end)
      else merged.push({ ...k })
    }
    onChange(merged)
  }

  const openMenu = (e: React.MouseEvent, index: number | null): void => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, sec: secAt(e.clientX), index })
  }

  return (
    <div
      ref={laneRef}
      className="tl-lane tl-lane--cuts"
      style={{ width: Math.max(1, duration * zoom) }}
      onContextMenu={(e) => openMenu(e, null)}
      onDoubleClick={(e) => onSeek(secAt(e.clientX))}
    >
      {sorted.map((k, i) => (
        <div
          key={i}
          className="tl-keep tl-keep--edit"
          style={{ insetInlineStart: k.start * zoom, width: Math.max(4, (k.end - k.start) * zoom) }}
          title={`${fmtMs(k.start)} → ${fmtMs(k.end)}`}
          onPointerDown={(e) => e.button === 0 && startDrag(e, 'move', i)}
          onContextMenu={(e) => openMenu(e, i)}
        >
          <span className="tl-keep__handle tl-keep__handle--l" onPointerDown={(e) => e.button === 0 && startDrag(e, 'l', i)} />
          <span className="tl-keep__handle tl-keep__handle--r" onPointerDown={(e) => e.button === 0 && startDrag(e, 'r', i)} />
        </div>
      ))}

      {menu && (
        <div className="tl-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          {menu.index !== null ? (
            <>
              <button onClick={() => { splitAt(menu.index!, menu.sec); setMenu(null) }}>
                ✂ {t('editor.splitAtCursor')}
              </button>
              <button onClick={() => { deleteAt(menu.index!); setMenu(null) }}>
                🗑 {t('editor.deleteSegment')}
              </button>
            </>
          ) : (
            <button onClick={() => { restoreGapAt(menu.sec); setMenu(null) }}>
              ↩ {t('editor.restoreGap')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** Reel window lane — one draggable/resizable block within the clip. */
function WindowLane({
  window: win,
  onChange,
  duration,
  zoom,
}: {
  window: EditorRange
  onChange: (w: EditorRange) => void
  duration: number
  zoom: number
}): JSX.Element {
  const laneRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ kind: DragKind; startX: number; orig: EditorRange } | null>(null)

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const d = dragRef.current
      const rect = laneRef.current?.getBoundingClientRect()
      if (!d || !rect) return
      const cursor = clamp((e.clientX - rect.left) / zoom, 0, duration)
      if (d.kind === 'l') onChange({ start: clamp(cursor, 0, d.orig.end - MIN_LEN), end: d.orig.end })
      else if (d.kind === 'r') onChange({ start: d.orig.start, end: clamp(cursor, d.orig.start + MIN_LEN, duration) })
      else {
        const len = d.orig.end - d.orig.start
        const start = clamp(d.orig.start + (e.clientX - d.startX) / zoom, 0, duration - len)
        onChange({ start, end: start + len })
      }
    },
    [zoom, duration, onChange],
  )
  const endDrag = useCallback(() => {
    dragRef.current = null
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', endDrag)
  }, [onPointerMove])
  useEffect(() => () => endDrag(), [endDrag])

  const startDrag = (e: React.PointerEvent, kind: DragKind): void => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    dragRef.current = { kind, startX: e.clientX, orig: { ...win } }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', endDrag)
  }

  return (
    <div ref={laneRef} className="tl-lane tl-lane--cuts" style={{ width: Math.max(1, duration * zoom) }}>
      <div
        className="tl-keep tl-keep--edit"
        style={{ insetInlineStart: win.start * zoom, width: Math.max(4, (win.end - win.start) * zoom) }}
        title={`${fmtMs(win.start)} → ${fmtMs(win.end)}`}
        onPointerDown={(e) => startDrag(e, 'move')}
      >
        <span className="tl-keep__handle tl-keep__handle--l" onPointerDown={(e) => startDrag(e, 'l')} />
        <span className="tl-keep__handle tl-keep__handle--r" onPointerDown={(e) => startDrag(e, 'r')} />
      </div>
    </div>
  )
}

/** A proportional "final assembly" strip: intro | body | outro, so the user
 *  sees where the intro/outro sit in the finished episode. */
function AssemblyStrip({
  hasIntro,
  hasOutro,
  introSec,
  bodySec,
  outroSec,
  introAtStart,
}: {
  hasIntro: boolean
  hasOutro: boolean
  introSec?: number
  bodySec: number
  outroSec?: number
  introAtStart: boolean
}): JSX.Element {
  // Use a nominal width when a clip's length isn't known yet (file not probed),
  // so the block still appears on the strip.
  const nominal = Math.max(6, bodySec * 0.06)
  const introW = hasIntro ? (introSec ?? nominal) : 0
  const outroW = hasOutro ? (outroSec ?? nominal) : 0
  const total = introW + bodySec + outroW || 1
  const pct = (v: number): string => `${(v / total) * 100}%`
  const len = (s?: number): string => (s ? ` · ${fmtMs(s)}` : '')
  return (
    <div className="tl-assembly">
      <span className="tl-assembly__label">{t('editor.assembly')}</span>
      <div className="tl-assembly__bar">
        {hasIntro && introAtStart && (
          <div className="tl-assembly__seg tl-assembly__seg--intro" style={{ width: pct(introW) }}>
            {t('editor.intro')}
            {len(introSec)}
          </div>
        )}
        <div className="tl-assembly__seg tl-assembly__seg--body" style={{ width: pct(bodySec) }}>
          {t('editor.body')} · {fmtMs(bodySec)}
          {hasIntro && !introAtStart && (
            <span className="tl-assembly__inline">＋{t('editor.intro')}</span>
          )}
        </div>
        {hasOutro && (
          <div className="tl-assembly__seg tl-assembly__seg--outro" style={{ width: pct(outroW) }}>
            {t('editor.outro')}
            {len(outroSec)}
          </div>
        )}
      </div>
    </div>
  )
}

/** Draggable marker on the source timeline for where the intro drops in. */
function IntroCueMarker({
  cue,
  duration,
  zoom,
  onChange,
}: {
  cue: number
  duration: number
  zoom: number
  onChange: (sec: number) => void
}): JSX.Element {
  const dragging = useRef(false)
  const onMove = useCallback(
    (e: PointerEvent) => {
      if (!dragging.current) return
      const lane = (e.target as HTMLElement).ownerDocument
        .querySelector('.tl-lane--cuts')
        ?.getBoundingClientRect()
      if (!lane) return
      onChange(clamp((e.clientX - lane.left) / zoom, 0, duration))
    },
    [zoom, duration, onChange],
  )
  const end = useCallback(() => {
    dragging.current = false
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', end)
  }, [onMove])
  useEffect(() => () => end(), [end])
  return (
    <div
      className="tl-cue"
      style={{ insetInlineStart: cue * zoom }}
      title={`${t('editor.introCue')} · ${fmtMs(cue)}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        dragging.current = true
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', end)
      }}
    >
      🎬
    </div>
  )
}
