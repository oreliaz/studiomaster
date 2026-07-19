import { useEffect, useState } from 'react'
import type {
  CalendarEvent,
  GoogleAuthStatus,
  SessionSummary,
  UploadProgress,
} from '@studiomaster/shared'

export function CloudView(): JSX.Element {
  const [status, setStatus] = useState<GoogleAuthStatus>({ connected: false, configured: false })
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [progress, setProgress] = useState<UploadProgress | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = async (): Promise<void> => {
    const s = await window.studiomaster.cloud.getAuthStatus()
    setStatus(s)
    setSessions(await window.studiomaster.cloud.listSessions())
    if (s.connected) setEvents(await window.studiomaster.cloud.listTodayEvents())
  }

  useEffect(() => {
    void refresh()
    return window.studiomaster.onUploadProgress((p) => {
      setProgress(p)
      if (p.state === 'done') void refresh()
    })
  }, [])

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
      alert(`העלאה נכשלה: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <header className="view__header">
        <h1>ענן</h1>
        <span className={`badge ${status.connected ? 'badge--connected' : ''}`}>
          {status.connected ? `מחובר · ${status.email ?? ''}` : 'לא מחובר'}
        </span>
      </header>

      <section className="card">
        <h2>חשבון Google</h2>
        {!status.configured && (
          <>
            <p className="hint">
              הזן Client ID ו-Client Secret מסוג "Desktop app" מ-Google Cloud Console. Scopes: Drive
              (drive.file) ו-Calendar (קריאה בלבד).
            </p>
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
              שמור פרטים
            </button>
          </>
        )}
        {status.configured && (
          <div className="actions">
            {status.connected ? (
              <button className="btn" onClick={disconnect}>
                נתק
              </button>
            ) : (
              <button className="btn btn--primary" onClick={connect} disabled={busy}>
                {busy ? 'מתחבר…' : 'התחבר ל-Google'}
              </button>
            )}
          </div>
        )}
        {status.error && <p className="error">{status.error}</p>}
      </section>

      {status.connected && (
        <section className="card">
          <div className="card__head">
            <h2>אירועי היום (Calendar)</h2>
            <button className="btn btn--small" onClick={refresh}>
              רענן
            </button>
          </div>
          {events.length === 0 && <p className="hint">אין אירועים היום.</p>}
          <ul className="event-list">
            {events.map((ev) => (
              <li key={ev.id}>
                <span className="event-list__time">{formatTime(ev.start)}</span>
                <span className="event-list__title">{ev.title}</span>
                {ev.attendees.length > 0 && (
                  <span className="event-list__guests">{ev.attendees.length} משתתפים</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h2>הקלטות</h2>
        {sessions.length === 0 && <p className="hint">אין הקלטות עדיין.</p>}
        <ul className="session-list">
          {sessions.map((s) => (
            <li key={s.id} className="session">
              <div className="session__info">
                <span className="session__title">{s.title ?? 'הקלטה'}</span>
                <span className="session__meta">{formatDateTime(s.startedAt)}</span>
                {s.guests.length > 0 && (
                  <span className="session__meta">אורחים: {s.guests.join(', ')}</span>
                )}
              </div>
              <div className="session__actions">
                {s.uploaded ? (
                  <span className="badge badge--connected">הועלה ✓</span>
                ) : (
                  <>
                    {status.connected && (
                      <button className="btn btn--small" onClick={() => recognize(s.id)}>
                        זהה
                      </button>
                    )}
                    <button
                      className="btn btn--small btn--primary"
                      onClick={() => upload(s.id)}
                      disabled={busy || !status.connected}
                    >
                      העלה ל-Drive
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
        {progress && progress.state !== 'done' && (
          <p className="hint">
            מעלה {progress.file} ({progress.fileIndex}/{progress.fileCount})
            {progress.state === 'error' ? ` — שגיאה: ${progress.error}` : '…'}
          </p>
        )}
      </section>
    </>
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
