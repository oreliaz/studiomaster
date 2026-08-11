import { useEffect, useState } from 'react'
import type { DeliverableTemplate, Podcast, RunMode } from '@studiomaster/shared'
import { newPodcast } from '../profileHelpers.js'
import { t } from '../i18n.js'

/**
 * PodcastsView — a **Podcast** (show) is a reusable deliverables profile:
 * content language, intro/outro, edit type, reels, and when the auto-editor
 * runs. It is decoupled from the studio (equipment), so the same show produces
 * the same outputs in any studio. Chosen at record time on the Record tab.
 */
export function PodcastsView(): JSX.Element {
  const [podcasts, setPodcasts] = useState<Podcast[]>([])
  const [draft, setDraft] = useState<Podcast | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  const reload = async (): Promise<Podcast[]> => {
    const list = await window.studiomaster.podcasts.list()
    setPodcasts(list)
    return list
  }

  useEffect(() => {
    void reload()
  }, [])

  const select = (podcast: Podcast): void => {
    setDraft(structuredClone(podcast))
    setDirty(false)
  }
  const createNew = (): void => {
    setDraft(newPodcast())
    setDirty(true)
  }
  const patch = (p: Partial<Podcast>): void => {
    setDraft((d) => (d ? { ...d, ...p } : d))
    setDirty(true)
  }
  const patchDeliverables = (p: Partial<DeliverableTemplate>): void => {
    if (!draft) return
    patch({ deliverables: { ...draft.deliverables, ...p } })
  }

  const save = async (): Promise<void> => {
    if (!draft) return
    setSaving(true)
    try {
      const saved = await window.studiomaster.podcasts.save(draft)
      await reload()
      setDraft(saved)
      setDirty(false)
    } catch (err) {
      alert(`שמירה נכשלה: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }
  const remove = async (): Promise<void> => {
    if (!draft) return
    if (!confirm(`למחוק את "${draft.name}"?`)) return
    await window.studiomaster.podcasts.remove(draft.id)
    await reload()
    setDraft(null)
  }

  const d = draft?.deliverables
  const showBasic = d?.editType === 'basic' || d?.editType === 'both'
  const showReels = d?.editType === 'reels' || d?.editType === 'both'

  return (
    <>
      <header className="view__header">
        <h1>{t('podcasts.title')}</h1>
        <button className="btn btn--primary" onClick={createNew}>
          {t('podcasts.new')}
        </button>
      </header>

      <div className="split">
        <aside className="list">
          {podcasts.length === 0 && <p className="hint">{t('podcasts.empty')}</p>}
          {podcasts.map((p) => (
            <button
              key={p.id}
              className={`list__item ${draft?.id === p.id ? 'is-active' : ''}`}
              onClick={() => select(p)}
            >
              <span>{p.name}</span>
              <span className="list__meta">{t(`editType.${p.deliverables.editType}`)}</span>
            </button>
          ))}
        </aside>

        {draft && d ? (
          <div className="editor">
            <div className="card">
              <div className="field">
                <label htmlFor="pcname">{t('podcast.name')}</label>
                <input
                  id="pcname"
                  value={draft.name}
                  onChange={(e) => patch({ name: e.target.value })}
                />
              </div>
            </div>

            <section className="card">
              <h2>{t('q.title')}</h2>
              <div className="grid2">
                <div className="field">
                  <label>{t('q.editType')}</label>
                  <select
                    value={d.editType}
                    onChange={(e) =>
                      patchDeliverables({ editType: e.target.value as DeliverableTemplate['editType'] })
                    }
                  >
                    <option value="none">{t('editType.none')}</option>
                    <option value="basic">{t('editType.basic')}</option>
                    <option value="reels">{t('editType.reels')}</option>
                    <option value="both">{t('editType.both')}</option>
                  </select>
                </div>
                <div className="field">
                  <label>{t('q.language')}</label>
                  <select
                    value={d.language}
                    onChange={(e) =>
                      patchDeliverables({ language: e.target.value as DeliverableTemplate['language'] })
                    }
                  >
                    <option value="he">עברית</option>
                    <option value="en">English</option>
                  </select>
                </div>
              </div>

              {showBasic && (
                <div className="grid2">
                  <div className="field">
                    <label>{t('q.intro')}</label>
                    <input
                      value={d.intro ?? ''}
                      onChange={(e) => patchDeliverables({ intro: e.target.value || undefined })}
                      placeholder="C:/assets/intro.mp4"
                    />
                  </div>
                  <div className="field">
                    <label>{t('q.outro')}</label>
                    <input
                      value={d.outro ?? ''}
                      onChange={(e) => patchDeliverables({ outro: e.target.value || undefined })}
                      placeholder="C:/assets/outro.mp4"
                    />
                  </div>
                </div>
              )}

              {showReels && (
                <div className="grid2">
                  <div className="field">
                    <label>{t('q.reelsCount')}</label>
                    <input
                      type="number"
                      min={0}
                      value={d.reelsCount}
                      onChange={(e) => patchDeliverables({ reelsCount: Number(e.target.value) })}
                    />
                  </div>
                  <div className="field">
                    <label>{t('q.reelStyle')}</label>
                    <select
                      value={d.reelStyle}
                      onChange={(e) =>
                        patchDeliverables({ reelStyle: e.target.value as DeliverableTemplate['reelStyle'] })
                      }
                    >
                      <option value="simple">{t('style.simple')}</option>
                      <option value="premium">{t('style.premium')}</option>
                    </select>
                  </div>
                </div>
              )}

              <div className="grid2">
                <div className="field">
                  <label>{t('podcast.runmode')}</label>
                  <select
                    value={draft.runMode}
                    onChange={(e) => patch({ runMode: e.target.value as RunMode })}
                  >
                    <option value="ask">{t('runmode.ask')}</option>
                    <option value="now">{t('runmode.now')}</option>
                    <option value="nightly">{t('runmode.nightly')}</option>
                  </select>
                </div>
                <label className="check check--standalone">
                  <input
                    type="checkbox"
                    checked={d.socialUpload}
                    onChange={(e) => patchDeliverables({ socialUpload: e.target.checked })}
                  />
                  {t('q.socialUpload')}
                </label>
              </div>

              <div className="checks-row">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={d.title}
                    onChange={(e) => patchDeliverables({ title: e.target.checked })}
                  />
                  {t('import.metaTitle')}
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={d.description}
                    onChange={(e) => patchDeliverables({ description: e.target.checked })}
                  />
                  {t('import.metaDesc')}
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={d.thumbnail}
                    onChange={(e) => patchDeliverables({ thumbnail: e.target.checked })}
                  />
                  {t('import.thumb')}
                </label>
              </div>
            </section>

            <div className="editor__footer">
              <button className="btn btn--primary" onClick={save} disabled={saving || !dirty}>
                {saving ? 'שומר…' : 'שמור'}
              </button>
              <button className="btn btn--danger" onClick={remove}>
                מחק
              </button>
              {dirty && <span className="hint">יש שינויים שלא נשמרו</span>}
            </div>
          </div>
        ) : (
          <div className="editor editor--empty">
            <p className="hint">{t('podcasts.pick')}</p>
          </div>
        )}
      </div>
    </>
  )
}
