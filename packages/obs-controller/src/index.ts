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
  private pollTimer: NodeJS.Timeout | null = null
  private lastManualStopAt = 0
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
        {
          // `All` intentionally omits the high-volume meter stream, so it must be
          // OR'd in explicitly or the mixer meters never move (obs-websocket 5.x).
          eventSubscriptions: EventSubscription.All | EventSubscription.InputVolumeMeters,
          rpcVersion: 1,
        },
      )
      this.setConnection({
        status: 'connected',
        rpcVersion: negotiatedRpcVersion,
        obsVersion: obsWebSocketVersion,
      })
      await this.refreshRecordState()
      this.startPolling()
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
    this.stopPolling()
    try {
      await this.obs.disconnect()
    } finally {
      this.setConnection({ status: 'disconnected' })
    }
  }

  /**
   * Poll GetRecordStatus while connected so the StudioMaster timecode always
   * tracks OBS's recording time (markers use it), and recording started/stopped
   * directly in OBS is detected. `active` from the poll is ignored for a short
   * window after a manual stop so the record button never sticks during OBS's
   * stop-flush phase.
   */
  private startPolling(): void {
    if (this.pollTimer) return
    this.pollTimer = setInterval(() => {
      if (this.connection.status !== 'connected') return
      void this.obs
        .call('GetRecordStatus')
        .then((status) => {
          const withinStopGuard = Date.now() - this.lastManualStopAt < 2500
          const active = withinStopGuard ? this.record.active : status.outputActive
          this.setRecord({
            active,
            paused: status.outputPaused,
            timecode: status.outputTimecode,
            timecodeMs: timecodeToMs(status.outputTimecode),
            outputPath: this.record.outputPath,
          })
        })
        .catch(() => undefined)
    }, 1000)
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  async startRecord(): Promise<ObsRecordState> {
    await this.obs.call('StartRecord')
    // Optimistic: OBS is briefly in the "starting" phase where GetRecordStatus
    // may still report inactive. The RecordStateChanged event confirms shortly.
    this.setRecord({ ...this.record, active: true, timecode: '00:00:00.000', timecodeMs: 0 })
    return this.record
  }

  async stopRecord(): Promise<ObsRecordState> {
    const { outputPath } = await this.obs.call('StopRecord')
    // Optimistic: during the stop-flush phase GetRecordStatus still reports
    // active, which would leave the button stuck. Guard the poll for a moment.
    this.lastManualStopAt = Date.now()
    this.setRecord({ ...this.record, active: false, outputPath })
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

  /**
   * Configure OBS for separate-audio-per-microphone recording (requirement 2):
   * switch to Advanced output, record to a multi-track container, and route each
   * audio input to its own track plus track 1 (the full mix). Idempotent and
   * best-effort — each OBS call is guarded so an older/newer OBS still gets as
   * much applied as it supports. Returns which inputs were routed.
   */
  async configureSeparateAudioTracks(): Promise<{ mics: string[]; tracks: number }> {
    // Audio inputs are those that answer GetInputAudioTracks; others throw.
    const { inputs } = await this.obs.call('GetInputList')
    const audioInputs: string[] = []
    for (const input of inputs) {
      const name = String(input.inputName)
      try {
        await this.obs.call('GetInputAudioTracks', { inputName: name })
        audioInputs.push(name)
      } catch {
        // not an audio input — skip
      }
    }

    // Track 1 = full mix; tracks 2.. = one isolated track per input (max 6).
    const trackCount = Math.min(6, audioInputs.length + 1)
    const bitmask = (1 << trackCount) - 1
    const setParam = (parameterCategory: string, parameterName: string, parameterValue: string) =>
      this.obs
        .call('SetProfileParameter', { parameterCategory, parameterName, parameterValue })
        .catch((err) => console.warn(`[obs] SetProfileParameter ${parameterName} failed:`, err))

    await setParam('Output', 'Mode', 'Advanced')
    // Newer OBS uses RecFormat2; older uses RecFormat. mkv is safe for multitrack.
    await setParam('AdvOut', 'RecFormat2', 'mkv')
    await setParam('AdvOut', 'RecFormat', 'mkv')
    await setParam('AdvOut', 'RecTracks', String(bitmask))

    for (let i = 0; i < audioInputs.length; i++) {
      const ownTrack = i + 2 // track 1 stays the mix
      const tracks: Record<string, boolean> = {}
      for (let t = 1; t <= 6; t++) tracks[String(t)] = t === 1 || t === ownTrack
      await this.obs
        .call('SetInputAudioTracks', {
          inputName: audioInputs[i],
          inputAudioTracks: tracks,
        })
        .catch((err) => console.warn(`[obs] SetInputAudioTracks ${audioInputs[i]} failed:`, err))
    }

    return { mics: audioInputs, tracks: trackCount }
  }

  /**
   * Toggle the **Source Record** filter (obs-source-record plugin) on the active
   * cameras — the sources currently enabled in the program scene that carry that
   * filter, which is how each camera gets recorded as its own separate angle.
   * Turns them all off if any is on, otherwise all on. Falls back to every source
   * that has the filter when no active one does. Returns the new state + count.
   */
  async toggleSeparateAngles(): Promise<{ on: boolean; cameras: number }> {
    const isSourceRecord = (kind: unknown): boolean =>
      kind === 'source_record_filter' || String(kind).includes('source_record')

    // 1) Active sources = enabled scene items in the current program scene.
    const active = new Set<string>()
    try {
      const scene = (await this.obs.call('GetSceneList')).currentProgramSceneName
      if (scene) {
        const { sceneItems } = await this.obs.call('GetSceneItemList', { sceneName: scene })
        for (const item of sceneItems) {
          const it = item as { sceneItemEnabled?: boolean; sourceName?: string }
          if (it.sceneItemEnabled !== false && it.sourceName) active.add(String(it.sourceName))
        }
      }
    } catch {
      // Can't resolve the active set — fall back to scanning every source below.
    }

    const found: { source: string; filter: string; enabled: boolean }[] = []
    const scan = async (name: string): Promise<void> => {
      try {
        const { filters } = await this.obs.call('GetSourceFilterList', { sourceName: name })
        for (const f of filters) {
          const filter = f as { filterKind?: unknown; filterName?: string; filterEnabled?: boolean }
          if (isSourceRecord(filter.filterKind)) {
            found.push({ source: name, filter: String(filter.filterName), enabled: !!filter.filterEnabled })
          }
        }
      } catch {
        // Source can't carry filters — skip.
      }
    }

    // 2) Look on the active sources first; if none carry the filter, scan all.
    const primary = active.size ? [...active] : await this.allInputNames()
    for (const name of primary) await scan(name)
    if (found.length === 0 && active.size) {
      for (const name of await this.allInputNames()) await scan(name)
    }
    if (found.length === 0) return { on: false, cameras: 0 }

    // 3) Toggle: all off if any is on, else all on.
    const next = !found.some((f) => f.enabled)
    for (const f of found) {
      await this.obs
        .call('SetSourceFilterEnabled', {
          sourceName: f.source,
          filterName: f.filter,
          filterEnabled: next,
        })
        .catch((err) => console.warn('[obs] SetSourceFilterEnabled failed:', err))
    }
    return { on: next, cameras: found.length }
  }

  private async allInputNames(): Promise<string[]> {
    const { inputs } = await this.obs.call('GetInputList')
    return inputs.map((i) => String(i.inputName))
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

  /**
   * Ensure the marker-confirmation overlay source exists in the current scene
   * (docs §6.2.2). Creates a hidden text source if missing, so the on-screen
   * marker flash works with zero manual OBS setup. Idempotent.
   */
  async ensureMarkerOverlay(sourceName: string, text: string): Promise<void> {
    const scene = await this.getCurrentSceneName()
    if (!scene) return

    // Already present in this scene? Then nothing to do.
    try {
      await this.obs.call('GetSceneItemId', { sceneName: scene, sourceName })
      return
    } catch {
      // not in the current scene — fall through
    }

    // The input may already exist (in another scene) — just add it here.
    const { inputs } = await this.obs.call('GetInputList')
    const exists = inputs.some((i) => String(i.inputName) === sourceName)
    if (exists) {
      await this.obs.call('CreateSceneItem', {
        sceneName: scene,
        sourceName,
        sceneItemEnabled: false,
      })
      return
    }

    // Create a new hidden text source with the confirmation label.
    const kind = await this.pickTextInputKind()
    if (!kind) return
    await this.obs.call('CreateInput', {
      sceneName: scene,
      inputName: sourceName,
      inputKind: kind,
      inputSettings: { text, font: { face: 'Arial', size: 96 } },
      sceneItemEnabled: false,
    })
  }

  /** Pick an available text input kind (GDI+ on Windows, FreeType elsewhere). */
  private async pickTextInputKind(): Promise<string | null> {
    const { inputKinds } = await this.obs.call('GetInputKindList')
    const kinds = inputKinds.map(String)
    return (
      kinds.find((k) => k.includes('text_gdiplus')) ??
      kinds.find((k) => k.includes('text_ft2')) ??
      kinds.find((k) => k.includes('text')) ??
      null
    )
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
      // `outputActive` is the settled flag (true on STARTED, false on STOPPED).
      // It is authoritative — do NOT re-poll GetRecordStatus here: during the
      // stop-flush phase the poll still reports active and would clobber this
      // back to true, leaving the record button stuck on "recording".
      this.setRecord({
        ...this.record,
        active: data.outputActive,
        outputPath: data.outputPath ?? this.record.outputPath,
      })
    })

    this.obs.on('ConnectionClosed', () => {
      this.stopPolling()
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
