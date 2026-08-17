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

export function WizardView(): JSX.Element {
  const [profiles, setProfiles] = useState<StudioProfile[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [state, setState] = useState<WizardState>(initialWizardState)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      const list = await window.studiomaster.profiles.list()
      setProfiles(list)
      if (list[0]) setSelectedId((cur) => cur || list[0]!.id)
      setState(await window.studiomaster.wizard.getState())
    })()
    return window.studiomaster.onWizardState(setState)
  }, [])

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
            {t('wizard.start')}
          </button>
          {(state.phase === 'ready' || state.phase === 'failed') && (
            <button className="btn" onClick={reset}>
              {t('wizard.reset')}
            </button>
          )}
        </div>
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
                  {step.label}
                  {step.required && <span className="step__req"> · {t('wizard.required')}</span>}
                </span>
                {step.detail && <span className="step__detail">{step.detail}</span>}
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
