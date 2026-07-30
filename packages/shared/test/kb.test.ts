import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyKnowledgeBase, mergeKnowledgeBase, type KnowledgeBase } from '../src/kb.js'

function kb(partial: Partial<KnowledgeBase>): KnowledgeBase {
  return { ...emptyKnowledgeBase(), ...partial }
}

test('newer podcast note wins per podcast name', () => {
  const a = kb({
    podcastNotes: [
      { id: '1', podcastName: 'Show', notes: 'old', updatedAt: '2026-01-01T00:00:00.000Z' },
    ],
  })
  const b = kb({
    podcastNotes: [
      { id: '2', podcastName: 'show', notes: 'new', updatedAt: '2026-06-01T00:00:00.000Z' },
    ],
  })
  const merged = mergeKnowledgeBase(a, b)
  assert.equal(merged.podcastNotes.length, 1) // same show (case-insensitive) collapses
  assert.equal(merged.podcastNotes[0]?.notes, 'new')
})

test('issues merge by id, newest wins, others preserved', () => {
  const a = kb({
    knownIssues: [
      { id: 'x', title: 'A', symptom: 's', fix: 'old fix', tags: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'y', title: 'B', symptom: 's', fix: 'f', tags: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    ],
  })
  const b = kb({
    knownIssues: [
      { id: 'x', title: 'A', symptom: 's', fix: 'new fix', tags: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' },
      { id: 'z', title: 'C', symptom: 's', fix: 'f', tags: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    ],
  })
  const merged = mergeKnowledgeBase(a, b)
  assert.equal(merged.knownIssues.length, 3) // x (merged), y, z
  assert.equal(merged.knownIssues.find((i) => i.id === 'x')?.fix, 'new fix')
})

test('merging with an empty KB is identity', () => {
  const a = kb({
    knownIssues: [
      { id: 'x', title: 'A', symptom: 's', fix: 'f', tags: ['audio'], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    ],
  })
  const merged = mergeKnowledgeBase(a, emptyKnowledgeBase())
  assert.equal(merged.knownIssues.length, 1)
  assert.equal(merged.knownIssues[0]?.tags[0], 'audio')
})
