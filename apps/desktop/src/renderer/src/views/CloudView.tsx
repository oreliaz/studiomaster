import { useEffect, useState } from 'react'
import {
  msToTimecode,
  type AiProgress,
  type CalendarEvent,
  type EditStatus,
  type GoogleAuthStatus,
  type Podcast,
  type RequestedDeliverables,
  type ReviewMarker,
  type RunMode,
  type SessionSummary,
  type UploadProgress,
} from '@studiomaster/shared'
import { t } from '../i18n.js'

const CAT_LABEL: Record<ReviewMarker['category'], string> = {
  fix: 'live.catFix',
  highlight: 'live.catHighlight',
  chapter: 'live.catChapter',
  note: 'live.catNote',
  intro: 'live.catIntro',
}

export function CloudView(): JSX.Element {
  const [status, setStatus] = useState<GoogleAuthStatus>({ connected: false, configured: false })
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [progress, setProgress] = useState<UploadProgress | null>(null)
  const [busy, setBusy] = useState(false)
  const [aiBusy, setAiBusy] = useState<string | null>(null)
  const [runMode, setRunMode] = useState<RunMode>('ask')
  const [aiProgress, setAiProgress] = useState<Record<string, AiProgress>>({})
  const [openReview, setOpenReview] = useState<string | null>(null)
  const [keySet, setKeySet] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [autoUpload, setAutoUpload] = useState(true)

  const refresh = async (): Promise<void> => {
    const s = await window.studiomaster.cloud.getAuthStatus()
    setStatus(s)
    setSessions(await window.studiomaster.cloud.listSessions())
    setRunMode(await window.studiomaster.ai.getRunMode())
    setKeySet(await window.studiomaster.ai.hasKey())
    setAutoUpload(await window.studiomaster.cloud.getAutoUpload())
    if (s.connected) setEvents(await window.studiomaster.cloud.listTodayEvents())
  }

  useEffect(() => {
    void refresh()
    const offUpload = window.studiomaster.onUploadProgress((p) => {
      setProgress(p)
      if (p.state === 'done') void refresh()
    })
    const offAi = window.studiomaster.onAiProgress((p) => {
      setAiProgress((prev) => ({ ...prev, [p.sessionId]: p }))
      if (p.phase === 'done' || p.phase === 'error') void refresh()
    })
    return () => {
      offUpload()
      offAi()
    }
  }, [])

  const changeRunMode = async (mode: RunMode): Promise<void> => {
    await window.studiomaster.ai.setRunMode(mode)
    setRunMode(mode)
  }
  const saveKey = async (): Promise<void> => {
    await window.studiomaster.ai.setKey(keyInput)
    setKeyInput('')
    setKeySet(await window.studiomaster.ai.hasKey())
  }
  const clearKey = async (): Promise<void> => {
    await window.studiomaster.ai.setKey('')
    setKeySet(false)
  }

  const saveCreds = async (): Promise<void> => {
    setStatus(await window.studiomaster.cloud.setCredentials(clientId, clientSecret))
  }
  const connect = async (): Promise<void> => {
    setBusy(true)
    try {
      setStatus(await window.studiomaster.cloud.connect())
      await refresh()
    } finally {
      setBusy(false)
    }
  }
  const disconnect = async (): Promise<void> => {
    await window.studiomaster.cloud.disconnect()
    await refresh()
  }
  const recognize = async (id: string): Promise<void> => {
    await window.studiomaster.cloud.recognizeSession(id)
    await refresh()
  }
  const upload = async (id: string): Promise<void> => {
    setBusy(true)
    try {
      await window.studiomaster.cloud.uploadSession(id)
    } catch (err) {
      alert(`${t('cloud.uploadFailed')}: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }
  const runQueue = async (): Promise<void> => {
    await window.studiomaster.ai.processQueue()
    await refresh()
  }
  const toggleAutoUpload = async (on: boolean): Promise<void> => {
    setAutoUpload(on)
    await window.studiomaster.cloud.setAutoUpload(on)
  }
  const uploadAll = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await window.studiomaster.cloud.uploadAll()
      alert(t('upload.allDone').replace('{uploaded}', String(r.uploaded)).replace('{total}', String(r.total)))
      await refresh()
    } finally {
      setBusy(false)
    }
  }
  const openFolder = async (id: string): Promise<void> => {
    const err = await window.studiomaster.sessions.openFolder(id)
    if (err) alert(`${t('cloud.folderFailed')}: ${err}`)
  }
  const editWithAi = async (id: string): Promise<void> => {
    setAiBusy(id)
    try {
      const result = await window.studiomaster.ai.processSession(id)
      if (!result.ok) alert(`${t('edit.error')}: ${result.error ?? ''}`)
      await refresh()
    } finally {
      setAiBusy(null)
    }
  }

  return (
    <>
      <header className="view__header">
        <h1>{t('cloud.title')}</h1>
        <span className={`badge ${status.connected ? 'badge--connected' : ''}`}>
          {status.connected ? `${t('dash.stConnected')} · ${status.email ?? ''}` : t('cloud.notConnected')}
        </span>
      </header>

      <section className="card">
        <h2>{t('ai.keyTitle')}</h2>
        <p className="hint">{t('ai.keyHint')}</p>
        {keySet && <p className="badge badge--connected">{t('ai.keySet')}</p>}
        <div className="row">
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder={t('ai.keyPlaceholder')}
          />
          <button className="btn btn--small btn--primary" onClick={saveKey} disabled={!keyInput}>
            {t('ai.keySave')}
          </button>
          {keySet && (
            <button className="btn btn--small btn--danger" onClick={clearKey}>
              {t('ai.keyClear')}
            </button>
          )}
        </div>
      </section>

      <section className="card">
        <div className="field">
          <label>{t('cloud.runmode')}</label>
          <select value={runMode} onChange={(e) => changeRunMode(e.target.value as RunMode)}>
            <option value="ask">{t('runmode.ask')}</option>
            <option value="now">{t('runmode.now')}</option>
            <option value="nightly">{t('runmode.nightly')}</option>
          </select>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={autoUpload}
            onChange={(e) => toggleAutoUpload(e.target.checked)}
          />
          {t('upload.auto')}
        </label>
        <div className="actions">
          <button
            className="btn btn--small"
            onClick={uploadAll}
            disabled={busy || !status.connected}
          >
            {t('upload.all')}
          </button>
        </div>
      </section>

      <section className="card">
        <h2>{t('cloud.googleAccount')}</h2>
        {!status.configured && (
          <>
            <p className="hint">{t('cloud.googleHint')}</p>
            <div className="field">
              <label>Client ID</label>
              <input value={clientId} onChange={(e) => setClientId(e.target.value)} />
            </div>
            <div className="field">
              <label>Client Secret</label>
              <input
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
              />
            </div>
            <button className="btn" onClick={saveCreds} disabled={!clientId || !clientSecret}>
              {t('cloud.saveCreds')}
            </button>
          </>
        )}
        {status.configured && (
          <div className="actions">
            {status.connected ? (
              <button className="btn" onClick={disconnect}>
                {t('common.disconnect')}
              </button>
            ) : (
              <button className="btn btn--primary" onClick={connect} disabled={busy}>
                {busy ? t('dash.stConnecting') : t('cloud.connectGoogle')}
              </button>
            )}
          </div>
        )}
        {status.error && <p className="error">{status.error}</p>}
      </section>

      {status.connected && (
        <section className="card">
          <div className="card__head">
            <h2>{t('cloud.todayEvents')}</h2>
            <button className="btn btn--small" onClick={refresh}>
              {t('common.refresh')}
            </button>
          </div>
          {events.length === 0 && <p className="hint">{t('cloud.noEvents')}</p>}
          <ul className="event-list">
            {events.map((ev) => (
              <li key={ev.id}>
                <span className="event-list__time">{formatTime(ev.start)}</span>
                <span className="event-list__title">{ev.title}</span>
                {ev.attendees.length > 0 && (
                  <span className="event-list__guests">{ev.attendees.length} {t('cloud.attendees')}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h2>{t('queue.title')}</h2>
        <ImportEpisode onImported={refresh} />
        <QueueBar sessions={sessions} onRunAll={runQueue} />
        {sessions.length === 0 && <p className="hint">{t('cloud.noSessions')}</p>}
        <ul className="session-list">
          {sessions.map((s) => (
            <li key={s.id} className="session">
              <div className="session__info">
                <span className="session__title">{s.title ?? t('cloud.recording')}</span>
                <span className="session__meta">{formatDateTime(s.startedAt)}</span>
                {s.guests.length > 0 && (
                  <span className="session__meta">{t('cloud.guests')}: {s.guests.join(', ')}</span>
                )}
                <EditStatusLine status={s.editStatus} summary={s.editSummary} />
                <AiProgressBar progress={aiProgress[s.id]} active={s.editStatus === 'running'} />
                <SessionReview
                  session={s}
                  open={openReview === s.id}
                  onToggle={() => setOpenReview((cur) => (cur === s.id ? null : s.id))}
                  onReedit={() => editWithAi(s.id)}
                />
              </div>
              <div className="session__actions">
                <button className="btn btn--small" onClick={() => openFolder(s.id)}>
                  📁 {t('session.openFolder')}
                </button>
                <button
                  className="btn btn--small"
                  onClick={() => editWithAi(s.id)}
                  disabled={aiBusy === s.id || s.editStatus === 'running'}
                >
                  {aiBusy === s.id || s.editStatus === 'running'
                    ? t('edit.running')
                    : t('edit.run')}
                </button>
                {s.uploaded ? (
                  <span className="badge badge--connected">{t('cloud.uploaded')}</span>
                ) : (
                  <>
                    {status.connected && (
                      <button className="btn btn--small" onClick={() => recognize(s.id)}>
                        {t('cloud.recognize')}
                      </button>
                    )}
                    <button
                      className="btn btn--small btn--primary"
                      onClick={() => upload(s.id)}
                      disabled={busy || !status.connected}
                    >
                      {t('cloud.uploadDrive')}
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
        {progress && progress.state !== 'done' && (
          <p className="hint">
            {t('cloud.uploading')} {progress.file} ({progress.fileIndex}/{progress.fileCount})
            {progress.state === 'error' ? ` — ${t('dash.stError')}: ${progress.error}` : '…'}
          </p>
        )}
      </section>
    </>
  )
}

function EditStatusLine({
  status,
  summary,
}: {
  status?: EditStatus
  summary?: string
}): JSX.Element | null {
  if (!status || status === 'idle') return null
  const label =
    status === 'pending'
      ? t('edit.pending')
      : status === 'running'
        ? t('edit.running')
        : status === 'done'
          ? t('edit.done')
          : t('edit.error')
  return (
    <span className={`session__meta ${status === 'error' ? 'error' : ''}`}>
      {label}
      {summary ? ` · ${summary}` : ''}
    </span>
  )
}

/** Queue summary + a 'run the whole queue' button (processes all pending). */
function QueueBar({
  sessions,
  onRunAll,
}: {
  sessions: SessionSummary[]
  onRunAll: () => void
}): JSX.Element {
  const pending = sessions.filter((s) => s.editStatus === 'pending').length
  const running = sessions.filter((s) => s.editStatus === 'running').length
  const done = sessions.filter((s) => s.editStatus === 'done').length
  const counts = t('queue.counts')
    .replace('{pending}', String(pending))
    .replace('{running}', String(running))
    .replace('{done}', String(done))
  return (
    <div className="queue-bar">
      <span className="hint">{pending + running === 0 ? t('queue.empty') : counts}</span>
      <button
        className="btn btn--small btn--primary"
        onClick={onRunAll}
        disabled={pending === 0 || running > 0}
      >
        {t('queue.runAll')}
      </button>
    </div>
  )
}

/** Import a self-edited episode and choose which deliverables to produce. */
function ImportEpisode({ onImported }: { onImported: () => void }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState('')
  const [podcasts, setPodcasts] = useState<Podcast[]>([])
  const [podcastId, setPodcastId] = useState('')
  const [busy, setBusy] = useState(false)
  const [req, setReq] = useState<RequestedDeliverables>({
    basic: false,
    reels: true,
    title: true,
    description: true,
    thumbnail: true,
  })

  useEffect(() => {
    if (open) {
      void window.studiomaster.podcasts.list().then(async (list) => {
        setPodcasts(list)
        setPodcastId((await window.studiomaster.podcasts.getActive()) ?? list[0]?.id ?? '')
      })
    }
  }, [open])

  const pick = async (): Promise<void> => {
    const path = await window.studiomaster.sessions.pickVideo()
    if (path) setFile(path)
  }
  const toggle = (k: keyof RequestedDeliverables) => setReq((r) => ({ ...r, [k]: !r[k] }))

  const queue = async (): Promise<void> => {
    if (!file) {
      alert(t('import.needFile'))
      return
    }
    setBusy(true)
    try {
      await window.studiomaster.sessions.importEpisode({
        filePath: file,
        podcastId: podcastId || undefined,
        requested: req,
      })
      setOpen(false)
      setFile('')
      onImported()
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button className="btn btn--small btn--primary" onClick={() => setOpen(true)}>
        {t('import.add')}
      </button>
    )
  }

  const boxes: { key: keyof RequestedDeliverables; label: string }[] = [
    { key: 'basic', label: t('import.basic') },
    { key: 'reels', label: t('import.reels') },
    { key: 'title', label: t('import.metaTitle') },
    { key: 'description', label: t('import.metaDesc') },
    { key: 'thumbnail', label: t('import.thumb') },
  ]

  return (
    <div className="import-form">
      <h3>{t('import.title')}</h3>
      <div className="import-form__file">
        <button className="btn btn--small" onClick={pick}>
          {t('import.pick')}
        </button>
        <span className="hint">{file || '—'}</span>
      </div>
      {podcasts.length > 0 && (
        <div className="field">
          <label>{t('import.podcast')}</label>
          <select value={podcastId} onChange={(e) => setPodcastId(e.target.value)}>
            {podcasts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <label className="hint">{t('import.deliverables')}</label>
      <div className="checks-row">
        {boxes.map((b) => (
          <label className="check" key={b.key}>
            <input type="checkbox" checked={req[b.key]} onChange={() => toggle(b.key)} />
            {b.label}
          </label>
        ))}
      </div>
      <div className="actions">
        <button className="btn btn--small" onClick={() => setOpen(false)}>
          {t('import.cancel')}
        </button>
        <button className="btn btn--small btn--primary" onClick={queue} disabled={busy || !file}>
          {t('import.queue')}
        </button>
      </div>
    </div>
  )
}

/** A live progress bar for the editing pipeline (requirement: what & how much). */
function AiProgressBar({
  progress,
  active,
}: {
  progress?: AiProgress
  active: boolean
}): JSX.Element | null {
  if (!progress && !active) return null
  const pct = Math.round(Math.min(1, Math.max(0, progress?.frac ?? 0)) * 100)
  const detail = progress?.detail ?? t('edit.running')
  const done = progress?.phase === 'done'
  const error = progress?.phase === 'error'
  if (done && !active) return null
  return (
    <div className="progress">
      <div className="progress__bar">
        <div
          className={`progress__fill ${error ? 'progress__fill--error' : ''}`}
          style={{ width: `${error ? 100 : pct}%` }}
        />
      </div>
      <span className="progress__label">
        {error ? `⚠ ${detail}` : `${detail} · ${pct}%`}
      </span>
    </div>
  )
}

/** Post-edit review: see the marker points, add notes, override intro/outro, re-edit. */
function SessionReview({
  session,
  open,
  onToggle,
  onReedit,
}: {
  session: SessionSummary
  open: boolean
  onToggle: () => void
  onReedit: () => void
}): JSX.Element {
  const [markers, setMarkers] = useState<ReviewMarker[]>([])
  const [intro, setIntro] = useState(session.introOverride ?? '')
  const [outro, setOutro] = useState(session.outroOverride ?? '')
  const [notes, setNotes] = useState(session.editNotes ?? '')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (open) void window.studiomaster.markers.listForSession(session.id).then(setMarkers)
  }, [open, session.id])

  const saveNote = async (id: string, note: string): Promise<void> => {
    setMarkers((prev) => prev.map((m) => (m.id === id ? { ...m, note } : m)))
    await window.studiomaster.markers.updateNote(id, note)
  }
  const saveEdits = async (): Promise<void> => {
    await window.studiomaster.sessions.updateEdit(session.id, {
      introOverride: intro,
      outroOverride: outro,
      editNotes: notes,
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }
  const reedit = async (): Promise<void> => {
    await saveEdits()
    onReedit()
  }

  return (
    <div className="review">
      <button className="btn btn--small btn--ghost" onClick={onToggle}>
        {open ? '▾' : '▸'} {t('review.toggle')}
      </button>
      {open && (
        <div className="review__body">
          <label className="review__section">{t('review.cuts')}</label>
          {markers.length === 0 && <p className="hint">{t('review.noCuts')}</p>}
          <ul className="review__markers">
            {markers.map((m) => (
              <li key={m.id} className="review__marker">
                <span className="review__tc">{msToTimecode(m.tcMs)}</span>
                <span className={`marker-list__cat cat--${m.category}`}>
                  {t(CAT_LABEL[m.category])}
                </span>
                <input
                  className="review__note"
                  defaultValue={m.note ?? ''}
                  placeholder={t('review.notePlaceholder')}
                  onBlur={(e) => saveNote(m.id, e.target.value)}
                />
              </li>
            ))}
          </ul>

          <div className="grid2">
            <div className="field">
              <label>{t('review.intro')}</label>
              <input value={intro} onChange={(e) => setIntro(e.target.value)} placeholder="C:/assets/intro.mp4" />
            </div>
            <div className="field">
              <label>{t('review.outro')}</label>
              <input value={outro} onChange={(e) => setOutro(e.target.value)} placeholder="C:/assets/outro.mp4" />
            </div>
          </div>
          <div className="field">
            <label>{t('review.notes')}</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>
          <div className="actions">
            <button className="btn btn--small" onClick={saveEdits}>
              {saved ? t('review.saved') : t('review.save')}
            </button>
            <button className="btn btn--small btn--primary" onClick={reedit}>
              {t('review.reedit')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
}
function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('he-IL')
}
