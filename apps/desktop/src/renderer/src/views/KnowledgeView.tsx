import { useEffect, useState } from 'react'
import type { KnowledgeBase, KnownIssue, Podcast } from '@studiomaster/shared'
import { t } from '../i18n.js'

/**
 * KnowledgeView — the shared knowledge base: per-podcast editing notes (so the
 * next editor of a show starts from the same conventions) and a global bug log
 * (so a problem solved once never repeats). Syncs with a shared Drive copy.
 */
export function KnowledgeView(): JSX.Element {
  const [kb, setKb] = useState<KnowledgeBase | null>(null)
  const [podcasts, setPodcasts] = useState<Podcast[]>([])
  const [syncing, setSyncing] = useState(false)
  const [synced, setSynced] = useState(false)

  const reload = async (): Promise<void> => {
    setKb(await window.studiomaster.kb.get())
    setPodcasts(await window.studiomaster.podcasts.list())
  }
  useEffect(() => {
    void reload()
  }, [])

  const sync = async (): Promise<void> => {
    setSyncing(true)
    try {
      setKb(await window.studiomaster.kb.sync())
      setSynced(true)
      setTimeout(() => setSynced(false), 2000)
    } catch (err) {
      alert(t('kb.syncNeedGoogle') + `\n${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSyncing(false)
    }
  }

  const noteFor = (name: string): string =>
    kb?.podcastNotes.find((n) => n.podcastName.trim().toLowerCase() === name.trim().toLowerCase())
      ?.notes ?? ''

  // Every podcast name we know locally + any that arrived only via the shared KB.
  const names = Array.from(
    new Set([...podcasts.map((p) => p.name), ...(kb?.podcastNotes.map((n) => n.podcastName) ?? [])]),
  ).sort((a, b) => a.localeCompare(b))

  return (
    <>
      <header className="view__header">
        <h1>{t('kb.title')}</h1>
        <button className="btn btn--small" onClick={sync} disabled={syncing}>
          {syncing ? t('kb.syncing') : synced ? t('kb.synced') : t('kb.sync')}
        </button>
      </header>
      <p className="hint">{t('kb.subtitle')}</p>

      <section className="card">
        <h2>{t('kb.podcastNotes')}</h2>
        <p className="hint">{t('kb.podcastNotesHint')}</p>
        {names.length === 0 && <p className="hint">{t('podcasts.empty')}</p>}
        {names.map((name) => (
          <PodcastNoteRow key={name} name={name} initial={noteFor(name)} onSaved={setKb} />
        ))}
      </section>

      <section className="card">
        <h2>{t('kb.issues')}</h2>
        <p className="hint">{t('kb.issuesHint')}</p>
        <IssueEditor onSaved={setKb} />
        <ul className="issue-list">
          {(kb?.knownIssues ?? []).map((issue) => (
            <IssueRow key={issue.id} issue={issue} onChanged={setKb} />
          ))}
          {kb && kb.knownIssues.length === 0 && <li className="hint">{t('kb.empty')}</li>}
        </ul>
      </section>
    </>
  )
}

function PodcastNoteRow({
  name,
  initial,
  onSaved,
}: {
  name: string
  initial: string
  onSaved: (kb: KnowledgeBase) => void
}): JSX.Element {
  const [notes, setNotes] = useState(initial)
  const [dirty, setDirty] = useState(false)
  useEffect(() => {
    setNotes(initial)
    setDirty(false)
  }, [initial])

  const save = async (): Promise<void> => {
    onSaved(await window.studiomaster.kb.savePodcastNote(name, notes))
    setDirty(false)
  }
  return (
    <div className="kb-note">
      <div className="kb-note__head">
        <strong>{name}</strong>
        <button className="btn btn--small" onClick={save} disabled={!dirty}>
          {t('kb.save')}
        </button>
      </div>
      <textarea
        rows={3}
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value)
          setDirty(true)
        }}
        placeholder={t('kb.podcastNotesHint')}
      />
    </div>
  )
}

function IssueEditor({
  issue,
  onSaved,
  onDone,
}: {
  issue?: KnownIssue
  onSaved: (kb: KnowledgeBase) => void
  onDone?: () => void
}): JSX.Element {
  const [title, setTitle] = useState(issue?.title ?? '')
  const [symptom, setSymptom] = useState(issue?.symptom ?? '')
  const [fix, setFix] = useState(issue?.fix ?? '')
  const [tags, setTags] = useState((issue?.tags ?? []).join(', '))

  const save = async (): Promise<void> => {
    if (!title.trim()) return
    const kb = await window.studiomaster.kb.saveIssue({
      id: issue?.id,
      title: title.trim(),
      symptom: symptom.trim(),
      fix: fix.trim(),
      tags: tags.split(',').map((x) => x.trim()).filter(Boolean),
    })
    onSaved(kb)
    if (!issue) {
      setTitle('')
      setSymptom('')
      setFix('')
      setTags('')
    }
    onDone?.()
  }
  return (
    <div className="kb-issue-form">
      <input placeholder={t('kb.issueTitle')} value={title} onChange={(e) => setTitle(e.target.value)} />
      <input placeholder={t('kb.issueSymptom')} value={symptom} onChange={(e) => setSymptom(e.target.value)} />
      <input placeholder={t('kb.issueFix')} value={fix} onChange={(e) => setFix(e.target.value)} />
      <input placeholder={t('kb.issueTags')} value={tags} onChange={(e) => setTags(e.target.value)} />
      <button className="btn btn--small btn--primary" onClick={save} disabled={!title.trim()}>
        {issue ? t('kb.save') : t('kb.addIssue')}
      </button>
    </div>
  )
}

function IssueRow({
  issue,
  onChanged,
}: {
  issue: KnownIssue
  onChanged: (kb: KnowledgeBase) => void
}): JSX.Element {
  const [editing, setEditing] = useState(false)
  const remove = async (): Promise<void> => {
    if (!confirm(`${t('kb.delete')}: "${issue.title}"?`)) return
    onChanged(await window.studiomaster.kb.deleteIssue(issue.id))
  }
  if (editing) {
    return (
      <li className="issue">
        <IssueEditor issue={issue} onSaved={onChanged} onDone={() => setEditing(false)} />
      </li>
    )
  }
  return (
    <li className="issue">
      <div className="issue__body">
        <strong>{issue.title}</strong>
        {issue.symptom && <span className="issue__symptom">🐞 {issue.symptom}</span>}
        {issue.fix && <span className="issue__fix">✅ {issue.fix}</span>}
        <span className="issue__meta">
          {issue.tags.map((tg) => (
            <span key={tg} className="tag">
              {tg}
            </span>
          ))}
          {issue.author ? ` · ${t('kb.by')} ${issue.author}` : ''}
        </span>
      </div>
      <div className="issue__actions">
        <button className="btn btn--icon" onClick={() => setEditing(true)}>
          ✎
        </button>
        <button className="btn btn--icon" onClick={remove}>
          ✕
        </button>
      </div>
    </li>
  )
}
