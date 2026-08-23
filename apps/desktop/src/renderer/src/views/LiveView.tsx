import { useEffect, useState } from 'react'
import type {
  InputLevel,
  ObsInput,
  ObsScene,
  PanDir,
  ReviewMarker,
  ReviewMarkerCategory,
  TiltDir,
} from '@studiomaster/shared'
import { msToTimecode } from '@studiomaster/shared'
import { t } from '../i18n.js'

export function LiveView(): JSX.Element {
  return (
    <>
      <header className="view__header">
        <h1>{t('nav.live')}</h1>
      </header>
      <MixerCard />
      <PtzCard />
      <MarkersCard />
    </>
  )
}

// ─── Mixer ───────────────────────────────────────────────────────────────────

function MixerCard(): JSX.Element {
  const [inputs, setInputs] = useState<ObsInput[]>([])
  const [scenes, setScenes] = useState<ObsScene[]>([])
  const [current, setCurrent] = useState<string | null>(null)
  const [levels, setLevels] = useState<Record<string, number>>({})
  const [error, setError] = useState<string | null>(null)

  const refresh = async (): Promise<void> => {
    try {
      setInputs(await window.studiomaster.mixer.listInputs())
      const s = await window.studiomaster.mixer.listScenes()
      setScenes(s.scenes)
      setCurrent(s.current)
      setError(null)
    } catch {
      setError(t('live.mixerNeedObs'))
    }
  }

  useEffect(() => {
    void refresh()
    return window.studiomaster.onMixerLevels((ls: InputLevel[]) => {
      setLevels((prev) => {
        const next = { ...prev }
        for (const l of ls) next[l.name] = l.peak.length ? Math.max(...l.peak) : 0
        return next
      })
    })
  }, [])

  const setMute = async (name: string, muted: boolean): Promise<void> => {
    await window.studiomaster.mixer.setMute(name, muted)
    setInputs((prev) => prev.map((i) => (i.name === name ? { ...i, muted } : i)))
  }
  const setVolume = async (name: string, db: number): Promise<void> => {
    setInputs((prev) => prev.map((i) => (i.name === name ? { ...i, volumeDb: db } : i)))
    await window.studiomaster.mixer.setVolumeDb(name, db)
  }
  const setScene = async (name: string): Promise<void> => {
    await window.studiomaster.mixer.setScene(name)
    setCurrent(name)
  }

  return (
    <section className="card">
      <div className="card__head">
        <h2>{t('live.mixer')}</h2>
        <button className="btn btn--small" onClick={refresh}>
          {t('common.refresh')}
        </button>
      </div>
      {error && <p className="hint">{error}</p>}

      {scenes.length > 0 && (
        <div className="field">
          <label>{t('live.activeScene')}</label>
          <select value={current ?? ''} onChange={(e) => setScene(e.target.value)}>
            {scenes.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {inputs.map((input) => (
        <div className="mixer-row" key={input.name}>
          <div className="mixer-row__head">
            <span className="mixer-row__name">{input.name}</span>
            <button
              className={`btn btn--small ${input.muted ? 'btn--danger' : ''}`}
              onClick={() => setMute(input.name, !input.muted)}
            >
              {input.muted ? t('live.muted') : t('live.active')}
            </button>
          </div>
          <div className="meter">
            <div
              className="meter__fill"
              style={{ width: `${Math.min(100, (levels[input.name] ?? 0) * 100)}%` }}
            />
          </div>
          <input
            type="range"
            min={-60}
            max={0}
            step={0.5}
            value={Number.isFinite(input.volumeDb) ? input.volumeDb : -60}
            onChange={(e) => setVolume(input.name, Number(e.target.value))}
          />
          <span className="mixer-row__db">{input.volumeDb.toFixed(1)} dB</span>
        </div>
      ))}
      {inputs.length === 0 && !error && <p className="hint">{t('live.noInputs')}</p>}
    </section>
  )
}

// ─── PTZ ───────────────────────────────────────────────────────────────────

const DPAD: { key: string; pan: PanDir; tilt: TiltDir; icon: string }[] = [
  { key: 'ul', pan: 'left', tilt: 'up', icon: '↖' },
  { key: 'u', pan: 'stop', tilt: 'up', icon: '↑' },
  { key: 'ur', pan: 'right', tilt: 'up', icon: '↗' },
  { key: 'l', pan: 'left', tilt: 'stop', icon: '←' },
  { key: 'c', pan: 'stop', tilt: 'stop', icon: '■' },
  { key: 'r', pan: 'right', tilt: 'stop', icon: '→' },
  { key: 'dl', pan: 'left', tilt: 'down', icon: '↙' },
  { key: 'd', pan: 'stop', tilt: 'down', icon: '↓' },
  { key: 'dr', pan: 'right', tilt: 'down', icon: '↘' },
]

function PtzCard(): JSX.Element {
  const [cameras, setCameras] = useState<{ id: string; label: string }[]>([])
  const [camId, setCamId] = useState('')

  useEffect(() => {
    void (async () => {
      const cams = await window.studiomaster.ptz.listCameras()
      setCameras(cams)
      if (cams[0]) setCamId((c) => c || cams[0]!.id)
    })()
  }, [])

  const press = (pan: PanDir, tilt: TiltDir): void => {
    if (!camId) return
    if (pan === 'stop' && tilt === 'stop') void window.studiomaster.ptz.stop(camId)
    else void window.studiomaster.ptz.move({ cameraId: camId, pan, tilt })
  }
  const release = (): void => {
    if (camId) void window.studiomaster.ptz.stop(camId)
  }
  const zoom = (dir: 'in' | 'out' | 'stop'): void => {
    if (camId) void window.studiomaster.ptz.zoom({ cameraId: camId, zoom: dir })
  }
  const preset = (n: number, store: boolean): void => {
    if (!camId) return
    const cmd = { cameraId: camId, preset: n }
    void (store
      ? window.studiomaster.ptz.storePreset(cmd)
      : window.studiomaster.ptz.recallPreset(cmd))
  }

  if (cameras.length === 0) {
    return (
      <section className="card">
        <h2>{t('live.ptz')}</h2>
        <p className="hint">{t('live.noPtz')}</p>
      </section>
    )
  }

  return (
    <section className="card">
      <div className="card__head">
        <h2>{t('live.ptz')}</h2>
        <select value={camId} onChange={(e) => setCamId(e.target.value)}>
          {cameras.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <div className="ptz">
        <div className="dpad">
          {DPAD.map((d) => (
            <button
              key={d.key}
              className="dpad__btn"
              onPointerDown={() => press(d.pan, d.tilt)}
              onPointerUp={release}
              onPointerLeave={release}
            >
              {d.icon}
            </button>
          ))}
        </div>
        <div className="ptz__zoom">
          <button className="btn" onPointerDown={() => zoom('in')} onPointerUp={() => zoom('stop')}>
            {t('live.zoomIn')}
          </button>
          <button
            className="btn"
            onPointerDown={() => zoom('out')}
            onPointerUp={() => zoom('stop')}
          >
            {t('live.zoomOut')}
          </button>
        </div>
      </div>

      <div className="presets">
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <div className="preset" key={n}>
            <button className="btn btn--small" onClick={() => preset(n, false)}>
              {t('live.preset')} {n}
            </button>
            <button className="btn btn--icon" title={t('live.savePosition')} onClick={() => preset(n, true)}>
              ●
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}

// ─── Review markers ──────────────────────────────────────────────────────────

const CATEGORIES: { id: ReviewMarkerCategory; label: string; hotkey: string }[] = [
  { id: 'fix', label: 'live.catFix', hotkey: 'Ctrl+Shift+1' },
  { id: 'highlight', label: 'live.catHighlight', hotkey: 'Ctrl+Shift+2' },
  { id: 'chapter', label: 'live.catChapter', hotkey: 'Ctrl+Shift+3' },
  { id: 'note', label: 'live.catNote', hotkey: 'Ctrl+Shift+4' },
  { id: 'intro', label: 'live.catIntro', hotkey: 'Ctrl+Shift+5' },
]

const CAT_LABEL: Record<ReviewMarkerCategory, string> = {
  fix: 'live.catFix',
  highlight: 'live.catHighlight',
  chapter: 'live.catChapter',
  note: 'live.catNote',
  intro: 'live.catIntro',
}

function MarkersCard(): JSX.Element {
  const [markers, setMarkers] = useState<ReviewMarker[]>([])
  const [note, setNote] = useState('')
  const [flash, setFlash] = useState(false)

  useEffect(() => {
    void window.studiomaster.markers.list().then(setMarkers)
    return window.studiomaster.onMarkerAdded((m) => {
      setMarkers((prev) => [...prev, m])
      setFlash(true)
      setTimeout(() => setFlash(false), 600)
    })
  }, [])

  const add = async (category: ReviewMarkerCategory): Promise<void> => {
    const marker = await window.studiomaster.markers.add(category, note || undefined)
    if (!marker) {
      alert(t('live.noActiveRec'))
      return
    }
    setNote('')
  }

  return (
    <section className={`card ${flash ? 'card--flash' : ''}`}>
      <h2>{t('live.markTitle')}</h2>
      <p className="hint">{t('live.markHint')}</p>
      <div className="field">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('live.markNotePlaceholder')}
        />
      </div>
      <div className="marker-buttons">
        {CATEGORIES.map((c) => (
          <button key={c.id} className="btn" onClick={() => add(c.id)}>
            {t(c.label)}
            <span className="marker-buttons__hk">{c.hotkey}</span>
          </button>
        ))}
      </div>

      <ul className="marker-list">
        {markers.map((m) => (
          <li key={m.id}>
            <span className="marker-list__tc">{msToTimecode(m.tcMs)}</span>
            <span className={`marker-list__cat cat--${m.category}`}>{t(CAT_LABEL[m.category])}</span>
            <span className="marker-list__note">{m.note}</span>
          </li>
        ))}
        {markers.length === 0 && <li className="hint">{t('live.noMarkers')}</li>}
      </ul>
    </section>
  )
}
