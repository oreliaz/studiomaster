import { useEffect, useState } from 'react'
import type { CaptureConfig, LightingConfig, Program, StudioProfile } from '@studiomaster/shared'
import {
  WAIT_FOR_LABELS,
  joinWaitFor,
  moveItem,
  newProfile,
  newProgram,
  splitWaitFor,
  type WaitForType,
} from '../profileHelpers.js'
import { t } from '../i18n.js'

const DEFAULT_LIGHTING: LightingConfig = {
  adapter: 'freestyler',
  transport: 'http',
  host: '127.0.0.1',
  port: 3332,
  cues: {},
}

export function ProfilesView(): JSX.Element {
  const [profiles, setProfiles] = useState<StudioProfile[]>([])
  const [draft, setDraft] = useState<StudioProfile | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  const reload = async (): Promise<StudioProfile[]> => {
    const list = await window.studiomaster.profiles.list()
    setProfiles(list)
    return list
  }

  useEffect(() => {
    void reload()
  }, [])

  const select = (profile: StudioProfile): void => {
    setDraft(structuredClone(profile))
    setDirty(false)
  }

  const createNew = (): void => {
    setDraft(newProfile())
    setDirty(true)
  }

  const patchDraft = (patch: Partial<StudioProfile>): void => {
    setDraft((d) => (d ? { ...d, ...patch } : d))
    setDirty(true)
  }

  // ── program editing ──
  const updateProgram = (i: number, patch: Partial<Program>): void => {
    if (!draft) return
    patchDraft({ programs: draft.programs.map((p, idx) => (idx === i ? { ...p, ...patch } : p)) })
  }
  const addProgram = (): void => {
    if (!draft) return
    patchDraft({ programs: [...draft.programs, newProgram()] })
  }
  const removeProgram = (i: number): void => {
    if (!draft) return
    patchDraft({ programs: draft.programs.filter((_, idx) => idx !== i) })
  }
  const moveProgram = (i: number, dir: -1 | 1): void => {
    if (!draft) return
    patchDraft({ programs: moveItem(draft.programs, i, i + dir) })
  }

  // ── checklist editing ──
  const updateChecklist = (i: number, text: string): void => {
    if (!draft) return
    patchDraft({ checklist: draft.checklist.map((c, idx) => (idx === i ? text : c)) })
  }
  const addChecklistItem = (): void => {
    if (!draft) return
    patchDraft({ checklist: [...draft.checklist, ''] })
  }
  const removeChecklistItem = (i: number): void => {
    if (!draft) return
    patchDraft({ checklist: draft.checklist.filter((_, idx) => idx !== i) })
  }

  // ── lighting editing ──
  const toggleLighting = (on: boolean): void => {
    patchDraft({ lighting: on ? DEFAULT_LIGHTING : undefined })
  }
  const patchLighting = (patch: Partial<LightingConfig>): void => {
    if (!draft?.lighting) return
    patchDraft({ lighting: { ...draft.lighting, ...patch } })
  }
  const setCue = (name: 'standby' | 'record', value: string): void => {
    if (!draft?.lighting) return
    const cues = { ...draft.lighting.cues }
    if (value) cues[name] = value
    else delete cues[name]
    patchLighting({ cues })
  }

  // ── recording (equipment) options ──
  const patchCapture = (patch: Partial<CaptureConfig>): void => {
    if (!draft) return
    patchDraft({ capture: { ...draft.capture, ...patch } })
  }

  const save = async (): Promise<void> => {
    if (!draft) return
    setSaving(true)
    try {
      const saved = await window.studiomaster.profiles.save(draft)
      await reload()
      setDraft(saved)
      setDirty(false)
    } catch (err) {
      alert(`${t('common.saveFailed')}: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (): Promise<void> => {
    if (!draft) return
    if (!confirm(t('common.confirmDelete').replace('{name}', draft.name))) return
    await window.studiomaster.profiles.remove(draft.id)
    await reload()
    setDraft(null)
  }

  return (
    <>
      <header className="view__header">
        <h1>{t('nav.profiles')}</h1>
        <button className="btn btn--primary" onClick={createNew}>
          {t('profiles.newStudio')}
        </button>
      </header>

      <div className="split">
        <aside className="list">
          {profiles.length === 0 && <p className="hint">{t('profiles.empty')}</p>}
          {profiles.map((p) => (
            <button
              key={p.id}
              className={`list__item ${draft?.id === p.id ? 'is-active' : ''}`}
              onClick={() => select(p)}
            >
              <span>{p.name}</span>
              <span className="list__meta">{p.programs.length} {t('profiles.programsCount')}</span>
            </button>
          ))}
        </aside>

        {draft ? (
          <div className="editor">
            <div className="card">
              <div className="field">
                <label htmlFor="pname">{t('backend.studioName')}</label>
                <input
                  id="pname"
                  value={draft.name}
                  onChange={(e) => patchDraft({ name: e.target.value })}
                />
              </div>
            </div>

            <section className="card">
              <div className="card__head">
                <h2>{t('profiles.programsTitle')}</h2>
                <button className="btn btn--small" onClick={addProgram}>
                  {t('common.add')}
                </button>
              </div>
              {draft.programs.length === 0 && (
                <p className="hint">{t('profiles.programsHint')}</p>
              )}
              {draft.programs.map((program, i) => (
                <ProgramRow
                  key={i}
                  index={i}
                  count={draft.programs.length}
                  program={program}
                  onChange={(patch) => updateProgram(i, patch)}
                  onRemove={() => removeProgram(i)}
                  onMove={(dir) => moveProgram(i, dir)}
                />
              ))}
            </section>

            <section className="card">
              <div className="card__head">
                <h2>{t('profiles.lighting')}</h2>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={!!draft.lighting}
                    onChange={(e) => toggleLighting(e.target.checked)}
                  />
                  <span>{draft.lighting ? t('profiles.on') : t('profiles.off')}</span>
                </label>
              </div>
              {draft.lighting && (
                <div className="grid2">
                  <div className="field">
                    <label>{t('profiles.host')}</label>
                    <input
                      value={draft.lighting.host}
                      onChange={(e) => patchLighting({ host: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label>{t('profiles.port')}</label>
                    <input
                      type="number"
                      value={draft.lighting.port}
                      onChange={(e) => patchLighting({ port: Number(e.target.value) })}
                    />
                  </div>
                  <div className="field">
                    <label>{t('profiles.cueStandby')}</label>
                    <input
                      value={draft.lighting.cues['standby'] ?? ''}
                      onChange={(e) => setCue('standby', e.target.value)}
                      placeholder={t('profiles.cueEg1')}
                    />
                  </div>
                  <div className="field">
                    <label>{t('profiles.cueRecord')}</label>
                    <input
                      value={draft.lighting.cues['record'] ?? ''}
                      onChange={(e) => setCue('record', e.target.value)}
                      placeholder={t('profiles.cueEg12')}
                    />
                  </div>
                </div>
              )}
            </section>

            <section className="card">
              <h2>{t('rec.title')}</h2>
              <p className="hint">{t('rec.hint')}</p>
              <div className="checks-row">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={draft.capture.multitrack}
                    onChange={(e) => patchCapture({ multitrack: e.target.checked })}
                  />
                  {t('q.multitrack')}
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={draft.capture.routed}
                    onChange={(e) => patchCapture({ routed: e.target.checked })}
                  />
                  {t('q.routed')}
                </label>
              </div>
            </section>

            <section className="card">
              <div className="card__head">
                <h2>{t('profiles.checklist')}</h2>
                <button className="btn btn--small" onClick={addChecklistItem}>
                  {t('common.add')}
                </button>
              </div>
              {draft.checklist.length === 0 && (
                <p className="hint">{t('profiles.checklistHint')}</p>
              )}
              {draft.checklist.map((item, i) => (
                <div className="row" key={i}>
                  <input
                    value={item}
                    onChange={(e) => updateChecklist(i, e.target.value)}
                    placeholder={t('profiles.checklistEg')}
                  />
                  <button className="btn btn--icon" onClick={() => removeChecklistItem(i)}>
                    ✕
                  </button>
                </div>
              ))}
            </section>

            <div className="editor__footer">
              <button className="btn btn--primary" onClick={save} disabled={saving || !dirty}>
                {saving ? t('common.saving') : t('kb.save')}
              </button>
              <button className="btn btn--danger" onClick={remove}>
                {t('kb.delete')}
              </button>
              {dirty && <span className="hint">{t('common.unsaved')}</span>}
            </div>
          </div>
        ) : (
          <div className="editor editor--empty">
            <p className="hint">{t('profiles.pick')}</p>
          </div>
        )}
      </div>
    </>
  )
}

function ProgramRow({
  index,
  count,
  program,
  onChange,
  onRemove,
  onMove,
}: {
  index: number
  count: number
  program: Program
  onChange: (patch: Partial<Program>) => void
  onRemove: () => void
  onMove: (dir: -1 | 1) => void
}): JSX.Element {
  const wait = splitWaitFor(program.waitFor)
  const needsValue = wait.type === 'delay' || wait.type === 'port' || wait.type === 'window'

  return (
    <div className="program">
      <div className="program__order">
        <span className="program__num">{index + 1}</span>
        <button className="btn btn--icon" disabled={index === 0} onClick={() => onMove(-1)}>
          ↑
        </button>
        <button className="btn btn--icon" disabled={index === count - 1} onClick={() => onMove(1)}>
          ↓
        </button>
      </div>
      <div className="program__fields">
        <div className="grid2">
          <div className="field">
            <label>{t('profiles.name')}</label>
            <input
              value={program.name}
              onChange={(e) => onChange({ name: e.target.value })}
              placeholder="OBS"
            />
          </div>
          <div className="field">
            <label>{t('profiles.exePath')}</label>
            <input
              value={program.path}
              onChange={(e) => onChange({ path: e.target.value })}
              placeholder="C:/Program Files/obs-studio/bin/64bit/obs64.exe"
            />
          </div>
        </div>
        <div className="grid2">
          <div className="field">
            <label>{t('profiles.readyWhen')}</label>
            <select
              value={wait.type}
              onChange={(e) =>
                onChange({ waitFor: joinWaitFor(e.target.value as WaitForType, wait.value) })
              }
            >
              {(Object.keys(WAIT_FOR_LABELS) as WaitForType[]).map((wf) => (
                <option key={wf} value={wf}>
                  {t(WAIT_FOR_LABELS[wf])}
                </option>
              ))}
            </select>
          </div>
          {needsValue && (
            <div className="field">
              <label>{wait.type === 'delay' ? t('profiles.ms') : wait.type === 'port' ? t('profiles.port') : t('profiles.name')}</label>
              <input
                value={wait.value}
                onChange={(e) => onChange({ waitFor: joinWaitFor(wait.type, e.target.value) })}
                placeholder={wait.type === 'window' ? 'FreeStyler' : '3332'}
              />
            </div>
          )}
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={program.required}
            onChange={(e) => onChange({ required: e.target.checked })}
          />
          {t('profiles.requiredStop')}
        </label>
      </div>
      <button className="btn btn--icon program__remove" onClick={onRemove}>
        ✕
      </button>
    </div>
  )
}
