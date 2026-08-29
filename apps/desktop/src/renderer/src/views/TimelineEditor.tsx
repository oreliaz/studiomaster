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
  const [zoom, setZoom] = useState(14) // px per second
  const [time, setTime] = useState(0)
  const [showOutput, setShowOutput] = useState(false)
  const [reediting, setReediting] = useState(false)
  const [progress, setProgress] = useState<AiProgress | null>(null)
  const [savedTick, setSavedTick] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    let alive = true
    void window.studiomaster.editor.load(sessionId, mode, reelId).then((p) => {
      if (!alive) return
      if (!p) {
        setError(t('editor.loadFailed'))
        return
      }
      setProject(p)
      setKept(p.kept)
      if (p.window) setWin(p.window)
      setHook(p.hook ?? '')
      setChannels(p.channels)
      setEffects(p.effects)
      setTargetLufs(p.config.targetLufs)
      setIntro(p.config.intro ?? '')
      setOutro(p.config.outro ?? '')
    })
    return () => {
      alive = false
    }
  }, [sessionId, mode, reelId])

  useEffect(() => {
    return window.studiomaster.onAiProgress((p) => {
      if (p.sessionId !== sessionId) return
      setProgress(p)
      if (p.phase === 'done' || p.phase === 'error') {
        setReediting(false)
        // Reload so the rendered output + any recomputed data refresh.
        void window.studiomaster.editor.load(sessionId, mode, reelId).then((np) => {
          if (np) {
            setProject(np)
            if (np.hasOutput) setShowOutput(true)
          }
        })
      }
    })
  }, [sessionId, mode, reelId])

  const duration = project?.durationSec ?? 0
  const mediaUrl = showOutput && project?.outputUrl ? project.outputUrl : project?.mediaUrl

  const seek = useCallback((sec: number) => {
    const v = videoRef.current
    if (v) v.currentTime = Math.max(0, sec)
  }, [])

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

            {/* Timeline: ruler + transcript + cuts/window */}
            <div className="tl-scroll">
              <div className="tl-track-area" style={{ width }}>
                <Ruler duration={duration} zoom={zoom} onSeek={seek} />
                <TranscriptLane
                  segments={project.transcript}
                  zoom={zoom}
                  onSeek={seek}
                />
                {mode === 'basic' ? (
                  <CutsLane kept={kept} duration={duration} zoom={zoom} />
                ) : (
                  <WindowLane window={win} duration={duration} zoom={zoom} />
                )}
                <div className="tl-playhead" style={{ insetInlineStart: time * zoom }} />
              </div>
            </div>
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

function CutsLane({
  kept,
  duration,
  zoom,
}: {
  kept: EditorRange[]
  duration: number
  zoom: number
}): JSX.Element {
  return (
    <div className="tl-lane tl-lane--cuts" style={{ width: Math.max(1, duration * zoom) }}>
      {kept.map((k, i) => (
        <div
          key={i}
          className="tl-keep"
          style={{ insetInlineStart: k.start * zoom, width: Math.max(2, (k.end - k.start) * zoom) }}
          title={`${fmtMs(k.start)} → ${fmtMs(k.end)}`}
        />
      ))}
    </div>
  )
}

function WindowLane({
  window: win,
  duration,
  zoom,
}: {
  window: EditorRange
  duration: number
  zoom: number
}): JSX.Element {
  return (
    <div className="tl-lane tl-lane--cuts" style={{ width: Math.max(1, duration * zoom) }}>
      <div
        className="tl-keep"
        style={{ insetInlineStart: 0, width: Math.max(2, (win.end - win.start) * zoom) }}
        title={`${fmtMs(win.start)} → ${fmtMs(win.end)}`}
      />
    </div>
  )
}
