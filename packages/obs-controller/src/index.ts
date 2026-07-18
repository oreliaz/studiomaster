import { EventEmitter } from 'node:events'
import OBSWebSocket, { EventSubscription } from 'obs-websocket-js'
import {
  type ObsConnectionParams,
  type ObsConnectionState,
  type ObsRecordState,
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

  // ─── internals ─────────────────────────────────────────────────────────────

  private registerObsEvents(): void {
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
