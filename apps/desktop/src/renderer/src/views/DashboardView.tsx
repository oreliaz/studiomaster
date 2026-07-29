import { useCallback, useEffect, useRef, useState } from 'react'
import {
  msToTimecode,
  type ObsConnectionState,
  type ObsRecordState,
  type Podcast,
} from '@studiomaster/shared'
import { t } from '../i18n.js'

const DEFAULT_URL = 'ws://127.0.0.1:4455'

const CONNECTION_LABELS: Record<ObsConnectionState['status'], string> = {
  disconnected: 'מנותק',
  connecting: 'מתחבר…',
  connected: 'מחובר',
  error: 'שגיאה',
}

export function DashboardView(): JSX.Element {
  const [url, setUrl] = useState(DEFAULT_URL)
  const [password, setPassword] = useState('')
  const [connection, setConnection] = useState<ObsConnectionState>({ status: 'disconnected' })
  const [record, setRecord] = useState<ObsRecordState>({
    active: false,
    paused: false,
    timecode: '00:00:00.000',
    timecodeMs: 0,
  })
  const [busy, setBusy] = useState(false)
  const [podcasts, setPodcasts] = useState<Podcast[]>([])
  const [activePodcast, setActivePodcast] = useState<string>('')

  useEffect(() => {
    void (async () => {
      const saved = await window.studiomaster.obs.getSavedConnection()
      if (saved) {
        setUrl(saved.url)
        setPassword(saved.password ?? '')
      }
      setConnection(await window.studiomaster.obs.getConnectionState())
      setRecord(await window.studiomaster.obs.getRecordState())
      const list = await window.studiomaster.podcasts.list()
      setPodcasts(list)
      const active = (await window.studiomaster.podcasts.getActive()) ?? list[0]?.id ?? ''
      setActivePodcast(active)
    })()

    const offConn = window.studiomaster.onConnectionState(setConnection)
    const offRec = window.studiomaster.onRecordState(setRecord)
    return () => {
      offConn()
      offRec()
    }
  }, [])

  const connected = connection.status === 'connected'

  const handleConnect = useCallback(async () => {
    setBusy(true)
    try {
      setConnection(await window.studiomaster.obs.connect({ url, password }))
    } finally {
      setBusy(false)
    }
  }, [url, password])

  const handleDisconnect = useCallback(async () => {
    setBusy(true)
    try {
      await window.studiomaster.obs.disconnect()
    } finally {
      setBusy(false)
    }
  }, [])

  const handleToggleRecord = useCallback(async () => {
    setBusy(true)
    try {
      setRecord(await window.studiomaster.obs.toggleRecord())
    } finally {
      setBusy(false)
    }
  }, [])

  const handlePodcastChange = useCallback(async (id: string) => {
    setActivePodcast(id)
    await window.studiomaster.podcasts.setActive(id)
  }, [])

  return (
    <>
      <header className="view__header">
        <h1>הקלטה</h1>
        <span className={`badge badge--${connection.status}`}>
          {CONNECTION_LABELS[connection.status]}
          {connection.obsVersion ? ` · obs-websocket ${connection.obsVersion}` : ''}
        </span>
      </header>

      <section className="card">
        <h2>חיבור ל-OBS</h2>
        <div className="field">
          <label htmlFor="url">כתובת obs-websocket</label>
          <input
            id="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={connected || busy}
            placeholder={DEFAULT_URL}
          />
        </div>
        <div className="field">
          <label htmlFor="password">סיסמה</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={connected || busy}
            placeholder="(אם מוגדרת ב-OBS)"
          />
        </div>
        <div className="actions">
          {connected ? (
            <button className="btn" onClick={handleDisconnect} disabled={busy}>
              נתק
            </button>
          ) : (
            <button className="btn btn--primary" onClick={handleConnect} disabled={busy}>
              התחבר
            </button>
          )}
        </div>
        {connection.status === 'error' && connection.error ? (
          <p className="error">{connection.error}</p>
        ) : null}
      </section>

      <section className="card">
        <h2>הקלטה</h2>
        <div className="field">
          <label htmlFor="podcast">{t('record.podcast')}</label>
          {podcasts.length > 0 ? (
            <select
              id="podcast"
              value={activePodcast}
              onChange={(e) => handlePodcastChange(e.target.value)}
              disabled={record.active}
            >
              {podcasts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : (
            <p className="hint">{t('record.noPodcast')}</p>
          )}
        </div>
        <RecordTimecode record={record} />
        <div className="actions">
          <button
            className={`btn btn--record ${record.active ? 'is-recording' : ''}`}
            onClick={handleToggleRecord}
            disabled={!connected || busy}
          >
            {record.active ? '■ עצור הקלטה' : '● התחל הקלטה'}
          </button>
        </div>
        {record.outputPath ? (
          <p className="hint">הקובץ האחרון: {record.outputPath}</p>
        ) : (
          <p className="hint">התחבר ל-OBS כדי לשלוט בהקלטה.</p>
        )}
      </section>
    </>
  )
}

/** Smoothly extrapolates the recording timecode between OBS updates. */
function RecordTimecode({ record }: { record: ObsRecordState }): JSX.Element {
  const [display, setDisplay] = useState(record.timecodeMs)
  const baseRef = useRef({ ms: record.timecodeMs, at: performance.now() })

  useEffect(() => {
    baseRef.current = { ms: record.timecodeMs, at: performance.now() }
    setDisplay(record.timecodeMs)
  }, [record.timecodeMs, record.active])

  useEffect(() => {
    if (!record.active) return
    const id = setInterval(() => {
      const elapsed = performance.now() - baseRef.current.at
      setDisplay(baseRef.current.ms + elapsed)
    }, 100)
    return () => clearInterval(id)
  }, [record.active])

  return (
    <div className={`timecode ${record.active ? 'timecode--live' : ''}`}>
      <span className={`dot ${record.active ? 'dot--live' : ''}`} />
      <span className="timecode__value">
        {msToTimecode(record.active ? display : record.timecodeMs)}
      </span>
    </div>
  )
}
