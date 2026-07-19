import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Program } from '@studiomaster/shared'
import { StudioLauncher, parseWaitFor, type LauncherEffects } from '../src/index.js'

function program(name: string, over: Partial<Program> = {}): Program {
  return { name, path: `C:/${name}.exe`, waitFor: 'spawn', required: false, ...over }
}

function makeEffects(over: Partial<LauncherEffects> = {}): {
  effects: LauncherEffects
  spawned: string[]
} {
  const spawned: string[] = []
  const effects: LauncherEffects = {
    spawn: async (p) => {
      spawned.push(p.name)
    },
    isPortOpen: async () => true,
    isProcessRunning: async () => true,
    delay: async () => {},
    ...over,
  }
  return { effects, spawned }
}

test('parseWaitFor understands every variant', () => {
  assert.deepEqual(parseWaitFor('spawn'), { kind: 'spawn' })
  assert.deepEqual(parseWaitFor('websocket'), { kind: 'websocket' })
  assert.deepEqual(parseWaitFor('delay:3000'), { kind: 'delay', ms: 3000 })
  assert.deepEqual(parseWaitFor('port:3332'), { kind: 'port', port: 3332 })
  assert.deepEqual(parseWaitFor('window:FreeStyler'), { kind: 'window', needle: 'FreeStyler' })
})

test('spawns programs in order and marks them ok', async () => {
  const { effects, spawned } = makeEffects()
  const launcher = new StudioLauncher(effects)
  const result = await launcher.launch(
    [program('OBS'), program('FreeStyler'), program('Mixer')],
    () => {},
  )
  assert.equal(result.ok, true)
  assert.deepEqual(spawned, ['OBS', 'FreeStyler', 'Mixer'])
  assert.deepEqual(
    result.steps.map((s) => s.status),
    ['ok', 'ok', 'ok'],
  )
})

test('a required failure stops the sequence and skips the rest', async () => {
  const { effects } = makeEffects({
    spawn: async (p) => {
      if (p.name === 'FreeStyler') throw new Error('exe not found')
    },
  })
  const launcher = new StudioLauncher(effects)
  const result = await launcher.launch(
    [program('OBS'), program('FreeStyler', { required: true }), program('Mixer')],
    () => {},
  )
  assert.equal(result.ok, false)
  assert.deepEqual(
    result.steps.map((s) => s.status),
    ['ok', 'failed', 'skipped'],
  )
})

test('a non-required failure does not stop the sequence', async () => {
  const spawnedNames: string[] = []
  const { effects } = makeEffects({
    spawn: async (p) => {
      spawnedNames.push(p.name)
      if (p.name === 'Teleprompter') throw new Error('optional missing')
    },
  })
  const launcher = new StudioLauncher(effects)
  const result = await launcher.launch(
    [program('OBS'), program('Teleprompter'), program('Mixer')],
    () => {},
  )
  assert.equal(result.ok, true) // no required step failed
  assert.deepEqual(spawnedNames, ['OBS', 'Teleprompter', 'Mixer']) // Mixer ran after the failure
  assert.deepEqual(
    result.steps.map((s) => s.status),
    ['ok', 'failed', 'ok'],
  )
})

test('port readiness polls until the port opens', async () => {
  let attempts = 0
  const { effects } = makeEffects({
    isPortOpen: async () => {
      attempts += 1
      return attempts >= 3 // open on the third check
    },
  })
  const launcher = new StudioLauncher(effects)
  const result = await launcher.launch(
    [program('FreeStyler', { waitFor: 'port:3332' })],
    () => {},
    {
      pollIntervalMs: 1,
      readyTimeoutMs: 1000,
    },
  )
  assert.equal(result.ok, true)
  assert.equal(result.steps[0]?.status, 'ok')
  assert.ok(attempts >= 3)
})

test('readiness times out and marks the step failed', async () => {
  const { effects } = makeEffects({ isPortOpen: async () => false })
  const launcher = new StudioLauncher(effects)
  const result = await launcher.launch([program('Mixer', { waitFor: 'port:9999' })], () => {}, {
    pollIntervalMs: 1,
    readyTimeoutMs: 10,
  })
  assert.equal(result.steps[0]?.status, 'failed')
})
