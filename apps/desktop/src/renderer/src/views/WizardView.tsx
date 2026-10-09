import { useEffect, useState } from 'react'
import {
  initialWizardState,
  type LaunchStep,
  type StudioProfile,
  type WizardPhase,
  type WizardState,
} from '@studiomaster/shared'
import { t } from '../i18n.js'

const PHASE_LABELS: Record<WizardPhase, string> = {
  idle: 'wizard.phaseIdle',
  launching: 'wizard.phaseLaunching',
  connecting: 'wizard.phaseConnecting',
  lighting: 'wizard.phaseLighting',
  checklist: 'wizard.phaseChecklist',
  ready: 'wizard.phaseReady',
  failed: 'wizard.phaseFailed',
}

const STEP_ICON: Record<LaunchStep['status'], string> = {
  pending: '○',
  running: '⟳',
  ok: '✓',
  failed: '✕',
  skipped: '—',
}

/** StudioMaster's own components get a translated label; programs keep their name. */
function stepLabel(step: LaunchStep): string {
  if (step.kind === 'obs') return t('wizard.stepObs')
  if (step.kind === 'lighting') return t('wizard.stepLighting')
  return step.label
}

/**
 * Home screen: one "start everything" button that opens the studio's
 * programs, connects to OBS and sets the lighting, then walks the checklist.
 */
export function WizardView({ onGoRecord }: { onGoRecord(): void }): JSX.Element {
  const [profiles, setProfiles] = useState<StudioProfile[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [state, setState] = useState<WizardState>(initialWizardState)
  const [busy, setBusy] = useState(false)
  const [autoStart, setAutoStart] = useState(false)

  useEffect(() => {
    void (async () => {
      const list = await window.studiomaster.profiles.list()
      setProfiles(list)
      const prefs = await window.studiomaster.wizard.getPrefs()
      setAutoStart(prefs.autoStart)
      // Pre-select the studio that was started last.
      const last = list.find((p) => p.id === prefs.profileId) ?? list[0]
      if (last) setSelectedId((cur) => cur || last.id)
      setState(await window.studiomaster.wizard.getState())
    })()
    return window.studiomaster.onWizardState(setState)
  }, [])

  const toggleAutoStart = async (on: boolean): Promise<void> => {
    setAutoStart(on)
    await window.studiomaster.wizard.setAutoStart(on)
  }

  const running = state.phase !== 'idle' && state.phase !== 'ready' && state.phase !== 'failed'

  const start = async (): Promise<void> => {
    if (!selectedId) return
    setBusy(true)
    try {
      setState(await window.studiomaster.wizard.start(selectedId))
    } finally {
      setBusy(false)
    }
  }

  const toggleChecklist = async (index: number, done: boolean): Promise<void> => {
    setState(await window.studiomaster.wizard.setChecklistItem(index, done))
  }

  const finishChecklist = async (): Promise<void> => {
    setState(await window.studiomaster.wizard.finishChecklist())
  }

  const reset = async (): Promise<void> => {
    setState(await window.studiomaster.wizard.reset())
  }

  const allChecked = state.checklist.every((c) => c.done)

  return (
    <>
      <header className="view__header">
        <h1>{t('nav.wizard')}</h1>
        <span className={`badge badge--phase-${state.phase}`}>{t(PHASE_LABELS[state.phase])}</span>
      </header>

      <section className="card">
        <div className="field">
          <label htmlFor="wprofile">{t('wizard.pickStudio')}</label>
          <select
            id="wprofile"
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            disabled={running || busy}
          >
            {profiles.length === 0 && <option value="">{t('wizard.noStudios')}</option>}
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="actions">
          <button
            className="btn btn--primary btn--big"
            onClick={start}
            disabled={!selectedId || running || busy}
          >
            {state.phase === 'failed' ? t('wizard.retry') : t('wizard.start')}
          </button>
          {(state.phase === 'ready' || state.phase === 'failed') && (
            <button className="btn" onClick={reset}>
              {t('wizard.reset')}
            </button>
          )}
        </div>
        <p className="hint">{t('wizard.startHint')}</p>
        <label className="check">
          <input
            type="checkbox"
            checked={autoStart}
            onChange={(e) => void toggleAutoStart(e.target.checked)}
          />
          {t('wizard.autoStart')}
        </label>
      </section>

      {state.steps.length > 0 && (
        <section className="card">
          <h2>{t('wizard.sequence')}</h2>
          <ul className="steps">
            {state.steps.map((step) => (
              <li key={step.id} className={`step step--${step.status}`}>
                <span className={`step__icon ${step.status === 'running' ? 'is-spin' : ''}`}>
                  {STEP_ICON[step.status]}
                </span>
                <span className="step__label">
                  {stepLabel(step)}
                  {step.required && <span className="step__req"> · {t('wizard.required')}</span>}
                </span>
                {step.alreadyRunning ? (
                  <span className="step__detail">{t('wizard.alreadyRunning')}</span>
                ) : (
                  step.detail && <span className="step__detail">{step.detail}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {state.phase === 'checklist' && (
        <section className="card">
          <h2>{t('wizard.phaseChecklist')}</h2>
          <ul className="checklist">
            {state.checklist.map((item, i) => (
              <li key={i}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={item.done}
                    onChange={(e) => toggleChecklist(i, e.target.checked)}
                  />
                  {item.text}
                </label>
              </li>
            ))}
          </ul>
          <div className="actions">
            <button className="btn btn--primary" onClick={finishChecklist} disabled={!allChecked}>
              {t('wizard.allReady')}
            </button>
          </div>
        </section>
      )}

      {state.phase === 'ready' && (
        <section className="card card--success">
          <h2>{t('wizard.readyTitle')}</h2>
          <p className="hint">{t('wizard.readyHint')}</p>
          <div className="actions">
            <button className="btn btn--primary" onClick={onGoRecord}>
              {t('wizard.goRecord')}
            </button>
          </div>
        </section>
      )}

      {state.phase === 'failed' && (
        <section className="card card--error">
          <h2>{t('wizard.phaseFailed')}</h2>
          <p className="error">{state.error}</p>
        </section>
      )}
    </>
  )
}
