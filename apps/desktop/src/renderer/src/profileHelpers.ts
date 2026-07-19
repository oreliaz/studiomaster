import type { Program, StudioProfile } from '@studiomaster/shared'

/** UI-friendly decomposition of the `waitFor` string. */
export type WaitForType = 'spawn' | 'websocket' | 'delay' | 'port' | 'window'

export const WAIT_FOR_LABELS: Record<WaitForType, string> = {
  spawn: 'מיד עם הפתיחה',
  websocket: 'המתן ל-OBS (4455)',
  delay: 'המתן זמן קבוע',
  port: 'המתן לפורט',
  window: 'המתן לחלון/תהליך',
}

export function splitWaitFor(waitFor: Program['waitFor']): { type: WaitForType; value: string } {
  if (waitFor === 'spawn') return { type: 'spawn', value: '' }
  if (waitFor === 'websocket') return { type: 'websocket', value: '' }
  if (waitFor.startsWith('delay:')) return { type: 'delay', value: waitFor.slice(6) }
  if (waitFor.startsWith('port:')) return { type: 'port', value: waitFor.slice(5) }
  if (waitFor.startsWith('window:')) return { type: 'window', value: waitFor.slice(7) }
  return { type: 'spawn', value: '' }
}

export function joinWaitFor(type: WaitForType, value: string): Program['waitFor'] {
  switch (type) {
    case 'spawn':
      return 'spawn'
    case 'websocket':
      return 'websocket'
    case 'delay':
      return `delay:${Number(value) || 3000}`
    case 'port':
      return `port:${Number(value) || 3332}`
    case 'window':
      return `window:${value || 'App'}`
  }
}

export function newProgram(): Program {
  return { name: '', path: '', waitFor: 'spawn', required: false }
}

export function newProfile(): StudioProfile {
  return {
    id: crypto.randomUUID(),
    name: 'אולפן חדש',
    programs: [],
    obs: { audioTracks: {} },
    cameras: [],
    checklist: [],
  }
}

/** Immutably move an array item from one index to another. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return items
  const copy = [...items]
  const [item] = copy.splice(from, 1)
  if (item === undefined) return items
  copy.splice(to, 0, item)
  return copy
}
