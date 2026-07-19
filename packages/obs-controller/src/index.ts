import { EventEmitter } from 'node:events'
import OBSWebSocket, { EventSubscription } from 'obs-websocket-js'
import {
  type InputLevel,
  type ObsConnectionParams,
  type ObsConnectionState,
  type ObsInput,
  type ObsRecordState,
  type ObsScene,
  timecodeToMs,
} from '@studiomaster/shared'

/**
 * ObsController — the single point of contact with OBS via obs-websocket 5.x
 * (docs/ARCHITECTURE.md §6.2). Wraps obs-websocket-js with a typed surface,
 * connection-state tracking, automatic reconnect, and record control.
 *
 * Events:
 *   'connection' → ObsConnectionState
 *   'record'     → ObsRecordState
 */
export interface ObsControllerEvents {
  connection: (state: ObsConnectionState) => void
  record: (state: ObsRecordState) => void
  levels: (levels: InputLevel[]) => void
}

export declare interface ObsController {
  on<E extends keyof ObsControllerEvents>(event: E, listener: ObsControllerEvents[E]): this
  off<E extends keyof ObsControllerEvents>(event: E, listener: ObsControllerEvents[E]): this
  emit<E extends keyof ObsControllerEvents>(
    event: E,
    ...args: Parameters<ObsControllerEvents[E]>
  ): boolean
}

const RECONNECT_DELAY_MS = 3000

export class ObsController extends EventEmitter {
  private readonly obs = new OBSWebSocket()
  private connection: ObsConnectionState = { status: 'disconnected' }
  private record: ObsRecordState = {
    active: false,
    paused: false,
    timecode: '00:00:00.000',
    timecodeMs: 0,
  }
  private params: ObsConnectionParams | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private manualDisconnect = false

  constructor() {
    super()
    this.registerObsEvents()
  }

  getConnectionState(): ObsConnectionState {
    return this.connection
  }

  getRecordState(): ObsRecordState {
    return this.record
  }

  async connect(params: ObsConnectionParams): Promise<ObsConnectionState> {
    this.params = params
    this.manualDisconnect = false
    this.clearReconnect()
    this.setConnection({ status: 'connecting' })
    try {
      const { negotiatedRpcVersion, obsWebSocketVersion } = await this.obs.connect(
        params.url,
        params.password || undefined,
        { eventSubscriptions: EventSubscription.All, rpcVersion: 1 },
      )
      this.setConnection({
        status: 'connected',
        rpcVersion: negotiatedRpcVersion,
        obsVersion: obsWebSocketVersion,
      })
      await this.refreshRecordState()
      return this.connection
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.setConnection({ status: 'error', error: message })
      this.scheduleReconnect()
      return this.connection
    }
  }

  async disconnect(): Promise<void> {
    this.manualDisconnect = true
    this.clearReconnect()
    try {
      await this.obs.disconnect()
    } finally {
      this.setConnection({ status: 'disconnected' })
    }
  }

  async startRecord(): Promise<ObsRecordState> {
    await this.obs.call('StartRecord')
    return this.refreshRecordState()
  }

  async stopRecord(): Promise<ObsRecordState> {
    const { outputPath } = await this.obs.call('StopRecord')
    await this.refreshRecordState()
    this.setRecord({ ...this.record, outputPath })
    return this.record
  }

  async toggleRecord(): Promise<ObsRecordState> {
    return this.record.active ? this.stopRecord() : this.startRecord()
  }

  /** Read the live record status straight from OBS (source of truth for timecode). */
  async refreshRecordState(): Promise<ObsRecordState> {
    const status = await this.obs.call('GetRecordStatus')
    this.setRecord({
      active: status.outputActive,
      paused: status.outputPaused,
      timecode: status.outputTimecode,
      timecodeMs: timecodeToMs(status.outputTimecode),
      outputPath: this.record.outputPath,
    })
    return this.record
  }

  // ─── mixer / scenes (docs §6.2) ──────────────────────────────────────────────

  async listInputs(): Promise<ObsInput[]> {
    const { inputs } = await this.obs.call('GetInputList')
    const results: ObsInput[] = []
    for (const input of inputs) {
      const name = String(input.inputName)
      try {
        const [{ inputMuted }, { inputVolumeDb }] = await Promise.all([
          this.obs.call('GetInputMute', { inputName: name }),
          this.obs.call('GetInputVolume', { inputName: name }),
        ])
        results.push({
          name,
          kind: String(input.inputKind ?? ''),
          muted: inputMuted,
          volumeDb: inputVolumeDb,
        })
      } catch {
        // Some inputs (e.g. images) have no audio; skip them.
      }
    }
    return results
  }

  async setInputMute(inputName: string, muted: boolean): Promise<void> {
    await this.obs.call('SetInputMute', { inputName, inputMuted: muted })
  }

  async setInputVolumeDb(inputName: string, db: number): Promise<void> {
    await this.obs.call('SetInputVolume', { inputName, inputVolumeDb: db })
  }

  async listScenes(): Promise<{ scenes: ObsScene[]; current: string | null }> {
    const data = await this.obs.call('GetSceneList')
    const scenes = data.scenes
      .map((s) => ({ name: String(s.sceneName), index: Number(s.sceneIndex) }))
      .sort((a, b) => a.index - b.index)
    return { scenes, current: data.currentProgramSceneName ?? null }
  }

  async setCurrentScene(name: string): Promise<void> {
    await this.obs.call('SetCurrentProgramScene', { sceneName: name })
  }

  /**
   * Briefly show a source overlay (e.g. "✓ marker") then hide it — the on-screen
   * confirmation for review markers (docs §6.2.2). No-op if the source is absent.
   */
  async flashSceneItem(sceneName: string, sourceName: string, ms = 1200): Promise<void> {
    try {
      const { sceneItemId } = await this.obs.call('GetSceneItemId', { sceneName, sourceName })
      await this.obs.call('SetSceneItemEnabled', {
        sceneName,
        sceneItemId,
        sceneItemEnabled: true,
      })
      setTimeout(() => {
        void this.obs
          .call('SetSceneItemEnabled', { sceneName, sceneItemId, sceneItemEnabled: false })
          .catch(() => undefined)
      }, ms)
    } catch {
      // Overlay source not present in this scene — confirmation is best-effort.
    }
  }

  async getCurrentSceneName(): Promise<string | null> {
    const { currentProgramSceneName } = await this.obs.call('GetSceneList')
    return currentProgramSceneName ?? null
  }

  // ─── internals ─────────────────────────────────────────────────────────────

  private registerObsEvents(): void {
    this.obs.on('InputVolumeMeters', (data: { inputs: unknown[] }) => {
      const levels: InputLevel[] = data.inputs.map((raw) => {
        const input = raw as { inputName: string; inputLevelsMul?: number[][] }
        const channels = input.inputLevelsMul ?? []
        const peak = channels.map((ch) => (ch.length > 0 ? Math.max(...ch) : 0))
        return { name: input.inputName, peak }
      })
      this.emit('levels', levels)
    })

    this.obs.on('RecordStateChanged', (data) => {
      // OBS gives us the authoritative active flag here; timecode via poll.
      const active = data.outputActive
      this.setRecord({
        ...this.record,
        active,
        outputPath: data.outputPath ?? this.record.outputPath,
      })
      void this.refreshRecordState().catch(() => undefined)
    })

    this.obs.on('ConnectionClosed', () => {
      if (this.manualDisconnect) return
      this.setConnection({ status: 'disconnected', error: 'connection closed' })
      this.scheduleReconnect()
    })

    this.obs.on('ConnectionError', (err: Error) => {
      this.setConnection({ status: 'error', error: err.message })
      this.scheduleReconnect()
    })
  }

  private scheduleReconnect(): void {
    if (this.manualDisconnect || this.reconnectTimer || !this.params) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.params) void this.connect(this.params)
    }, RECONNECT_DELAY_MS)
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private setConnection(state: ObsConnectionState): void {
    this.connection = state
    this.emit('connection', state)
  }

  private setRecord(state: ObsRecordState): void {
    this.record = state
    this.emit('record', state)
  }
}
