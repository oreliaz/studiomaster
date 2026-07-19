import { spawn as nodeSpawn } from 'node:child_process'
import { exec } from 'node:child_process'
import { createConnection } from 'node:net'
import { promisify } from 'node:util'
import type { LaunchStep } from '@studiomaster/shared'
import type { Program } from '@studiomaster/shared'

const execAsync = promisify(exec)

/**
 * StudioLauncher — opens a studio's programs in order and waits for each to be
 * ready before starting the next (docs/ARCHITECTURE.md §6.1).
 *
 * Side effects (spawning, port/process checks) are injected via LauncherEffects
 * so the ordering / readiness / required-stop logic is unit-testable without
 * touching the real OS.
 */

export interface LauncherEffects {
  /** Start a program. Rejects if the process fails to spawn. */
  spawn(program: Program): Promise<void>
  /** True if a TCP port accepts a connection. */
  isPortOpen(host: string, port: number): Promise<boolean>
  /** Best-effort: true if a process/window matching `needle` is present. */
  isProcessRunning(needle: string): Promise<boolean>
  /** Resolve after `ms`. */
  delay(ms: number): Promise<void>
}

export interface LaunchOptions {
  pollIntervalMs?: number
  /** Max time to wait for a single program's readiness check. */
  readyTimeoutMs?: number
}

export type StepListener = (step: LaunchStep, allSteps: LaunchStep[]) => void

export interface LaunchResult {
  ok: boolean
  steps: LaunchStep[]
}

const DEFAULTS: Required<LaunchOptions> = {
  pollIntervalMs: 500,
  readyTimeoutMs: 30_000,
}

type WaitSpec =
  | { kind: 'spawn' }
  | { kind: 'websocket' }
  | { kind: 'delay'; ms: number }
  | { kind: 'port'; port: number }
  | { kind: 'window'; needle: string }

export function parseWaitFor(waitFor: Program['waitFor']): WaitSpec {
  if (waitFor === 'spawn') return { kind: 'spawn' }
  if (waitFor === 'websocket') return { kind: 'websocket' }
  if (waitFor.startsWith('delay:')) return { kind: 'delay', ms: Number(waitFor.slice(6)) }
  if (waitFor.startsWith('port:')) return { kind: 'port', port: Number(waitFor.slice(5)) }
  if (waitFor.startsWith('window:')) return { kind: 'window', needle: waitFor.slice(7) }
  return { kind: 'spawn' }
}

export class StudioLauncher {
  constructor(private readonly effects: LauncherEffects) {}

  async launch(
    programs: Program[],
    onStep: StepListener,
    options: LaunchOptions = {},
  ): Promise<LaunchResult> {
    const opts = { ...DEFAULTS, ...options }
    const steps: LaunchStep[] = programs.map((p, i) => ({
      id: `${i}:${p.name}`,
      label: p.name,
      status: 'pending',
      required: p.required,
    }))

    const update = (index: number, patch: Partial<LaunchStep>): void => {
      const step = steps[index]
      if (!step) return
      Object.assign(step, patch)
      onStep(step, steps)
    }

    for (let i = 0; i < programs.length; i++) {
      const program = programs[i]
      if (!program) continue
      update(i, { status: 'running' })
      try {
        await this.effects.spawn(program)
        await this.waitForReady(program, opts)
        update(i, { status: 'ok' })
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        update(i, { status: 'failed', detail })
        if (program.required) {
          // Skip everything after a required failure and stop.
          for (let j = i + 1; j < steps.length; j++) update(j, { status: 'skipped' })
          return { ok: false, steps }
        }
      }
    }

    const ok = steps.every((s) => s.status === 'ok' || s.status === 'skipped' || !s.required)
    return { ok, steps }
  }

  private async waitForReady(program: Program, opts: Required<LaunchOptions>): Promise<void> {
    const spec = parseWaitFor(program.waitFor)
    switch (spec.kind) {
      case 'spawn':
        return
      case 'delay':
        await this.effects.delay(spec.ms)
        return
      case 'websocket':
        await this.poll(() => this.effects.isPortOpen('127.0.0.1', 4455), opts)
        return
      case 'port':
        await this.poll(() => this.effects.isPortOpen('127.0.0.1', spec.port), opts)
        return
      case 'window':
        await this.poll(() => this.effects.isProcessRunning(spec.needle), opts)
        return
    }
  }

  private async poll(check: () => Promise<boolean>, opts: Required<LaunchOptions>): Promise<void> {
    const deadline = performanceNow() + opts.readyTimeoutMs
    for (;;) {
      if (await check()) return
      if (performanceNow() >= deadline) {
        throw new Error(`timed out after ${opts.readyTimeoutMs}ms waiting for readiness`)
      }
      await this.effects.delay(opts.pollIntervalMs)
    }
  }
}

// Wrapped so tests can rely on a monotonic clock without importing perf_hooks.
function performanceNow(): number {
  return Number(process.hrtime.bigint() / 1_000_000n)
}

// ─── Default (real OS) effects ───────────────────────────────────────────────

export const defaultEffects: LauncherEffects = {
  spawn(program: Program): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = nodeSpawn(program.path, program.args ?? [], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      })
      child.once('error', (err) => reject(err))
      // 'spawn' fires once the process is successfully created.
      child.once('spawn', () => {
        child.unref()
        resolve()
      })
    })
  },

  isPortOpen(host: string, port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = createConnection({ host, port })
      const done = (open: boolean) => {
        socket.destroy()
        resolve(open)
      }
      socket.setTimeout(1500)
      socket.once('connect', () => done(true))
      socket.once('timeout', () => done(false))
      socket.once('error', () => done(false))
    })
  },

  async isProcessRunning(needle: string): Promise<boolean> {
    if (process.platform !== 'win32') return true // best-effort on non-Windows
    try {
      const { stdout } = await execAsync('tasklist /FO CSV /NH')
      return stdout.toLowerCase().includes(needle.toLowerCase())
    } catch {
      return false
    }
  },

  delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  },
}
