/**
 * Shared knowledge base (docs §6.5) — the collective memory every StudioMaster
 * user builds on ("standing on the shoulders of giants"):
 *
 *  - podcastNotes: free-text editing guidelines that accumulate PER PODCAST, so
 *    the next person to edit that show starts from the same conventions.
 *  - knownIssues: a global log of editing bugs + their fix/workaround, so a
 *    problem solved once does not bite anyone again.
 *
 * The KB lives locally and is synced to a shared Google Drive file, so it is
 * mergeable across users/machines. Merges are last-write-wins per item by
 * `updatedAt` — see `mergeKnowledgeBase`, which is pure and unit-tested.
 */

export interface PodcastNote {
  id: string
  /** Matched across machines by name, so the same show links up everywhere. */
  podcastName: string
  notes: string
  updatedAt: string // ISO 8601
  author?: string
}

export interface KnownIssue {
  id: string
  title: string
  symptom: string
  fix: string
  tags: string[]
  createdAt: string
  updatedAt: string
  author?: string
}

export interface KnowledgeBase {
  version: number
  updatedAt: string
  podcastNotes: PodcastNote[]
  knownIssues: KnownIssue[]
}

export function emptyKnowledgeBase(): KnowledgeBase {
  return { version: 1, updatedAt: '1970-01-01T00:00:00.000Z', podcastNotes: [], knownIssues: [] }
}

/** Newest-wins merge of two item lists keyed by id, comparing `updatedAt`. */
function mergeById<T extends { id: string; updatedAt: string }>(a: T[], b: T[]): T[] {
  const byId = new Map<string, T>()
  for (const item of [...a, ...b]) {
    const existing = byId.get(item.id)
    if (!existing || item.updatedAt > existing.updatedAt) byId.set(item.id, item)
  }
  return [...byId.values()]
}

/**
 * Merge two knowledge bases (e.g. local + the shared Drive copy). Per-item
 * last-write-wins by `updatedAt`; podcast notes additionally collapse to one
 * newest note per podcast name so the same show never fragments.
 */
export function mergeKnowledgeBase(a: KnowledgeBase, b: KnowledgeBase): KnowledgeBase {
  const notes = mergeById(a.podcastNotes, b.podcastNotes)
  const byName = new Map<string, PodcastNote>()
  for (const note of notes) {
    const key = note.podcastName.trim().toLowerCase()
    const existing = byName.get(key)
    if (!existing || note.updatedAt > existing.updatedAt) byName.set(key, note)
  }
  return {
    version: Math.max(a.version, b.version),
    updatedAt: a.updatedAt > b.updatedAt ? a.updatedAt : b.updatedAt,
    podcastNotes: [...byName.values()].sort((x, y) => x.podcastName.localeCompare(y.podcastName)),
    knownIssues: mergeById(a.knownIssues, b.knownIssues).sort((x, y) =>
      y.updatedAt.localeCompare(x.updatedAt),
    ),
  }
}
