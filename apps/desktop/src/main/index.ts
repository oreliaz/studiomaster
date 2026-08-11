import { basename, join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { app, dialog, shell, BrowserWindow, ipcMain, globalShortcut } from 'electron'
import { ObsController } from '@studiomaster/obs-controller'
import { createPtzController, type PtzController } from '@studiomaster/ptz-control'
import { createLightingAdapter } from '@studiomaster/lighting'
import {
  IPC_EVENTS,
  type InputLevel,
  type ObsConnectionParams,
  type ObsConnectionState,
  defaultDeliverables,
  type KnowledgeBase,
  type KnownIssue,
  type ObsRecordState,
  type Podcast,
  type PtzMoveCommand,
  type PtzPresetCommand,
  type PtzZoomCommand,
  type ReviewMarkerCategory,
  type RequestedDeliverables,
  type RunMode,
  type SessionEditPatch,
  type SessionSummary,
  type StudioProfile,
  type WizardState,
} from '@studiomaster/shared'
import type { UploadProgress } from '@studiomaster/shared'
import { createStore } from './store.js'
import { WizardOrchestrator } from './wizard.js'
import { RecordingSessionManager } from './session.js'
import { CloudService } from './cloud.js'
import { AiEditor } from './ai.js'
import { startDockServer } from './dock.js'
import { splitAudioTracks } from './audioSplit.js'
import { BackendService } from './backend/index.js'

/** Convention: add a source with this name to the scene for on-screen marker confirmation. */
const MARKER_OVERLAY_SOURCE = 'StudioMaster Marker'
const ACTIVE_PROFILE_KEY = 'active.profile'
const ACTIVE_PODCAST_KEY = 'active.podcast'
const RUN_MODE_KEY = 'run.mode'

/** Global default treatment timing (used when a session has no podcast). */
function getRunMode(): RunMode {
  return (store.getSetting(RUN_MODE_KEY) as RunMode) || 'ask'
}

/** Resolve the post-recording treatment timing for a session: podcast first. */
function sessionRunMode(podcastId?: string): RunMode {
  const podcast = podcastId ? store.getPodcast(podcastId) : null
  return podcast?.runMode ?? getRunMode()
}

const store = createStore()
const obs = new ObsController()
const session = new RecordingSessionManager(store)
const wizard = new WizardOrchestrator((state: WizardState) => broadcast(IPC_EVENTS.wizard, state))
const cloud = new CloudService(store, (p: UploadProgress) =>
  broadcast(IPC_EVENTS.uploadProgress, p),
)
const ai = new AiEditor(store, (p) => broadcast(IPC_EVENTS.aiProgress, p))
const backend = new BackendService(store)

let ptzController: PtzController | null = null
let ptzProfileId: string | null | undefined = undefined

// Never let a stray error take down the process silently.
process.on('uncaughtException', (err) => console.error('[main] uncaught exception:', err))
process.on('unhandledRejection', (reason) => console.error('[main] unhandled rejection:', reason))

function broadcast<T>(channel: string, payload: T): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload)
}

function activeProfile(): StudioProfile | null {
  const id = store.getSetting(ACTIVE_PROFILE_KEY)
  return id ? store.getProfile(id) : null
}

/**
 * One-time migration for the Studio↔Podcast split: earlier versions kept the
 * deliverables questionnaire on the studio profile. Seed a Podcast per existing
 * profile from its embedded deliverables so no configuration is lost, and make
 * sure at least one podcast exists to record against.
 */
function migratePodcasts(): void {
  if (store.listPodcasts().length > 0) return
  const profiles = store.listProfiles()
  let firstId: string | null = null
  for (const profile of profiles) {
    if (!profile.deliverables) continue
    const podcast: Podcast = {
      id: randomUUID(),
      name: profile.name,
      deliverables: profile.deliverables,
      runMode: getRunMode(),
    }
    store.savePodcast(podcast)
    firstId ??= podcast.id
  }
  if (!firstId) {
    const fallback: Podcast = {
      id: randomUUID(),
      name: 'פודקאסט ברירת מחדל',
      deliverables: defaultDeliverables(),
      runMode: getRunMode(),
    }
    store.savePodcast(fallback)
    firstId = fallback.id
  }
  if (!store.getSetting(ACTIVE_PODCAST_KEY)) store.setSetting(ACTIVE_PODCAST_KEY, firstId)
}

/** Rebuild the PTZ controller lazily when the active profile changes. */
function getPtz(): PtzController | null {
  const id = store.getSetting(ACTIVE_PROFILE_KEY)
  if (id !== ptzProfileId) {
    ptzController?.dispose()
    ptzController = null
    ptzProfileId = id
    const profile = id ? store.getProfile(id) : null
    if (profile) ptzController = createPtzController(profile.cameras)
  }
  return ptzController
}

// ── OBS state → renderer + session lifecycle ──
obs.on('connection', (state: ObsConnectionState) => {
  broadcast(IPC_EVENTS.obsConnection, state)
  if (state.status === 'connected') {
    // Auto-create the on-screen marker overlay source (docs §6.2.2) — no manual OBS setup.
    void obs
      .ensureMarkerOverlay(MARKER_OVERLAY_SOURCE, '✓ נרשם סימון')
      .catch((err) => console.warn('[obs] ensure marker overlay failed:', err))
  }
})
obs.on('levels', (levels: InputLevel[]) => broadcast(IPC_EVENTS.mixerLevels, levels))
obs.on('record', (state: ObsRecordState) => {
  broadcast(IPC_EVENTS.obsRecord, state)
  if (state.active && !session.session) {
    session.start(
      store.getSetting(ACTIVE_PROFILE_KEY) ?? undefined,
      store.getSetting(ACTIVE_PODCAST_KEY) ?? undefined,
    )
    applyRecordLighting()
  } else if (!state.active && session.session) {
    const finished = session.session.id
    const outputPath = state.outputPath
    session.end()
    void afterRecordingStopped(finished, outputPath)
  }
})

/** On record stop: store the capture, recognize the session, and queue/run editing. */
async function afterRecordingStopped(sessionId: string, capturePath?: string): Promise<void> {
  const record = store.getSession(sessionId)
  const mode = sessionRunMode(record?.podcastId)
  if (record) {
    store.saveSession({
      ...record,
      capturePath: capturePath ?? record.capturePath,
      editStatus: mode === 'now' ? 'running' : 'pending',
    })
  }
  // Separate audio per microphone: split OBS multi-track recordings into one
  // WAV per track in the session's audio/ folder (no-op for single-track files).
  const source = capturePath ?? record?.capturePath
  if (source && record?.storagePath) {
    try {
      const { files, trackCount } = await splitAudioTracks(source, record.storagePath)
      if (files.length) console.log(`[audio] split ${trackCount} tracks →`, files)
    } catch (err) {
      console.warn('[audio] track split failed:', err)
    }
  }
  await cloud.recognizeSession(sessionId).catch(() => undefined)
  if (mode === 'now') {
    await ai.processSession(sessionId).catch((err) => console.error('[ai] run-now failed:', err))
  }
}

/** Nightly editor: while in the 00:00–08:00 window, drain pending edit jobs one at a time. */
let nightlyRunning = false
async function nightlyTick(): Promise<void> {
  if (nightlyRunning) return
  const hour = new Date().getHours()
  if (hour >= 8) return
  // Only sessions whose podcast (or the global default) opted into nightly.
  const pending = store
    .listSessions()
    .find((s) => s.editStatus === 'pending' && sessionRunMode(s.podcastId) === 'nightly')
  if (!pending) return
  nightlyRunning = true
  try {
    await ai.processSession(pending.id)
  } catch (err) {
    console.error('[ai] nightly job failed:', err)
  } finally {
    nightlyRunning = false
  }
}

function applyRecordLighting(): void {
  const profile = activeProfile()
  const cue = profile?.lighting?.cues?.['record']
  if (!profile || !cue) return
  try {
    createLightingAdapter(profile.lighting)
      ?.setCue(cue)
      .catch((err) => console.warn('[lighting] record cue failed:', err))
  } catch (err) {
    console.warn('[lighting] adapter unavailable:', err)
  }
}

/** Flash the on-screen marker overlay in whatever scene is currently live. */
async function flashMarkerOverlay(): Promise<void> {
  // Ensure the source exists in the *current* scene (the user may have switched
  // scenes since connect, where it was only added to the then-current one), then
  // flash it — so the button always gives visible feedback on the OBS canvas.
  await obs
    .ensureMarkerOverlay(MARKER_OVERLAY_SOURCE, '✓ נרשם סימון')
    .catch((err) => console.warn('[obs] ensure marker overlay failed:', err))
  const scene = await obs.getCurrentSceneName().catch(() => null)
  if (scene) await obs.flashSceneItem(scene, MARKER_OVERLAY_SOURCE).catch(() => undefined)
}

/** Drop a review marker at the current OBS timecode + flash the on-screen overlay. */
function addMarker(category: ReviewMarkerCategory, note?: string) {
  // Always flash for feedback, even when not recording, so the button is never dead.
  void flashMarkerOverlay()
  const rec = obs.getRecordState()
  const marker = session.addMarker(category, rec.timecodeMs, note)
  if (!marker) return null
  broadcast(IPC_EVENTS.markerAdded, marker)
  return marker
}

// ── Shared knowledge base (docs §6.5) ──
function kbAuthor(): string | undefined {
  return cloud.getAuthStatus().email
}

/** Upsert the accumulated editing note for a podcast (keyed by name). */
function savePodcastNote(podcastName: string, notes: string): KnowledgeBase {
  const kb = store.getKb()
  const key = podcastName.trim().toLowerCase()
  const now = new Date().toISOString()
  const existing = kb.podcastNotes.find((n) => n.podcastName.trim().toLowerCase() === key)
  if (existing) {
    existing.notes = notes
    existing.updatedAt = now
    existing.author = kbAuthor()
  } else {
    kb.podcastNotes.push({
      id: randomUUID(),
      podcastName,
      notes,
      updatedAt: now,
      author: kbAuthor(),
    })
  }
  kb.updatedAt = now
  store.setKb(kb)
  return kb
}

type IssueInput = { id?: string; title: string; symptom: string; fix: string; tags?: string[] }

/** Upsert a known editing issue (bug + fix) so it never bites anyone twice. */
function saveIssue(input: IssueInput): KnowledgeBase {
  const kb = store.getKb()
  const now = new Date().toISOString()
  const existing = input.id ? kb.knownIssues.find((i) => i.id === input.id) : undefined
  if (existing) {
    existing.title = input.title
    existing.symptom = input.symptom
    existing.fix = input.fix
    existing.tags = input.tags ?? []
    existing.updatedAt = now
    existing.author = kbAuthor()
  } else {
    const issue: KnownIssue = {
      id: randomUUID(),
      title: input.title,
      symptom: input.symptom,
      fix: input.fix,
      tags: input.tags ?? [],
      createdAt: now,
      updatedAt: now,
      author: kbAuthor(),
    }
    kb.knownIssues.push(issue)
  }
  kb.updatedAt = now
  store.setKb(kb)
  return kb
}

function deleteIssue(id: string): KnowledgeBase {
  const kb = store.getKb()
  kb.knownIssues = kb.knownIssues.filter((i) => i.id !== id)
  kb.updatedAt = new Date().toISOString()
  store.setKb(kb)
  return kb
}

function registerIpc(): void {
  // OBS
  ipcMain.handle('obs:connect', async (_e, params: ObsConnectionParams) => {
    const state = await obs.connect(params)
    if (state.status === 'connected') store.saveConnection(params)
    return state
  })
  ipcMain.handle('obs:disconnect', () => obs.disconnect())
  ipcMain.handle('obs:get-connection-state', () => obs.getConnectionState())
  ipcMain.handle('obs:start-record', () => obs.startRecord())
  ipcMain.handle('obs:stop-record', () => obs.stopRecord())
  ipcMain.handle('obs:toggle-record', () => obs.toggleRecord())
  ipcMain.handle('obs:get-record-state', () => obs.getRecordState())
  ipcMain.handle('obs:get-saved-connection', () => store.getSavedConnection())
  ipcMain.handle('obs:configure-separate-audio', () => obs.configureSeparateAudioTracks())

  // Profiles (studios / equipment)
  ipcMain.handle('profiles:list', () => store.listProfiles())
  ipcMain.handle('profiles:get', (_e, id: string) => store.getProfile(id))
  ipcMain.handle('profiles:save', (_e, profile: StudioProfile) => store.saveProfile(profile))
  ipcMain.handle('profiles:remove', (_e, id: string) => store.deleteProfile(id))

  // Podcasts (shows / deliverables)
  ipcMain.handle('podcasts:list', () => store.listPodcasts())
  ipcMain.handle('podcasts:get', (_e, id: string) => store.getPodcast(id))
  ipcMain.handle('podcasts:save', (_e, podcast: Podcast) => store.savePodcast(podcast))
  ipcMain.handle('podcasts:remove', (_e, id: string) => {
    store.deletePodcast(id)
    if (store.getSetting(ACTIVE_PODCAST_KEY) === id) store.setSetting(ACTIVE_PODCAST_KEY, '')
  })
  ipcMain.handle('podcasts:get-active', () => store.getSetting(ACTIVE_PODCAST_KEY) || null)
  ipcMain.handle('podcasts:set-active', (_e, id: string) => store.setSetting(ACTIVE_PODCAST_KEY, id))

  // Wizard
  ipcMain.handle('wizard:start', async (_e, profileId: string) => {
    const profile = store.getProfile(profileId)
    if (!profile) {
      wizard.reset()
      return { ...wizard.getState(), phase: 'failed', error: 'הפרופיל לא נמצא' } as WizardState
    }
    store.setSetting(ACTIVE_PROFILE_KEY, profileId)
    return wizard.start(profile)
  })
  ipcMain.handle('wizard:get-state', () => wizard.getState())
  ipcMain.handle('wizard:set-checklist-item', (_e, index: number, done: boolean) =>
    wizard.setChecklistItem(index, done),
  )
  ipcMain.handle('wizard:finish-checklist', () => wizard.finishChecklist())
  ipcMain.handle('wizard:reset', () => wizard.reset())

  // Mixer
  ipcMain.handle('mixer:list-inputs', () => obs.listInputs())
  ipcMain.handle('mixer:set-mute', (_e, name: string, muted: boolean) =>
    obs.setInputMute(name, muted),
  )
  ipcMain.handle('mixer:set-volume', (_e, name: string, db: number) =>
    obs.setInputVolumeDb(name, db),
  )
  ipcMain.handle('mixer:list-scenes', () => obs.listScenes())
  ipcMain.handle('mixer:set-scene', (_e, name: string) => obs.setCurrentScene(name))

  // PTZ
  ipcMain.handle('ptz:move', (_e, cmd: PtzMoveCommand) => getPtz()?.move(cmd) ?? undefined)
  ipcMain.handle('ptz:stop', (_e, cameraId: string) => getPtz()?.stopMove(cameraId) ?? undefined)
  ipcMain.handle('ptz:zoom', (_e, cmd: PtzZoomCommand) => getPtz()?.zoom(cmd) ?? undefined)
  ipcMain.handle('ptz:recall-preset', (_e, cmd: PtzPresetCommand) => getPtz()?.recallPreset(cmd))
  ipcMain.handle('ptz:store-preset', (_e, cmd: PtzPresetCommand) => getPtz()?.storePreset(cmd))
  ipcMain.handle('ptz:list-cameras', () => getPtz()?.cameras() ?? [])

  // Markers
  ipcMain.handle('markers:add', (_e, category: ReviewMarkerCategory, note?: string) =>
    addMarker(category, note),
  )
  ipcMain.handle('markers:list', () => store.listMarkers(session.session?.id))
  ipcMain.handle('markers:list-for-session', (_e, sessionId: string) =>
    store.listMarkers(sessionId),
  )
  ipcMain.handle('markers:update-note', (_e, id: string, note: string) =>
    store.updateMarkerNote(id, note),
  )

  // Per-episode review edits (notes + intro/outro overrides)
  ipcMain.handle('sessions:update-edit', (_e, sessionId: string, patch: SessionEditPatch) => {
    const existing = store.getSession(sessionId)
    if (!existing) return null
    const updated = { ...existing, ...patch }
    store.saveSession(updated)
    return updated
  })
  // Open a recording's folder (review.md, cuts.txt, edited outputs, audio tracks).
  ipcMain.handle('sessions:open-folder', async (_e, sessionId: string) => {
    const s = store.getSession(sessionId)
    if (!s?.storagePath) return 'הקלטה לא נמצאה'
    return shell.openPath(s.storagePath) // '' on success, else the OS error message
  })
  // Pick a video file to import (a self-edited episode).
  ipcMain.handle('sessions:pick-video', async () => {
    const res = await dialog.showOpenDialog({
      title: 'בחר קובץ וידאו',
      properties: ['openFile'],
      filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'm4v', 'avi', 'webm'] }],
    })
    return res.canceled ? null : (res.filePaths[0] ?? null)
  })
  // Queue an externally-edited episode with a chosen subset of deliverables.
  ipcMain.handle(
    'sessions:import',
    (
      _e,
      input: {
        filePath: string
        podcastId?: string
        requested: RequestedDeliverables
        title?: string
      },
    ) => {
      const startedAt = new Date().toISOString()
      const stamp = startedAt.replace(/[:.]/g, '-')
      const storagePath = join(app.getPath('userData'), 'recordings', `import-${stamp}`)
      mkdirSync(storagePath, { recursive: true })
      const podcastId = input.podcastId ?? store.getSetting(ACTIVE_PODCAST_KEY) ?? undefined
      const mode = sessionRunMode(podcastId)
      const session: SessionSummary = {
        id: randomUUID(),
        startedAt,
        storagePath,
        capturePath: input.filePath,
        podcastId,
        title: input.title || basename(input.filePath),
        guests: [],
        uploaded: false,
        requested: input.requested,
        imported: true,
        editStatus: mode === 'now' ? 'running' : 'pending',
      }
      store.saveSession(session)
      if (mode === 'now') {
        void ai.processSession(session.id).catch((err) => console.error('[ai] import run failed:', err))
      }
      return session
    },
  )

  // Cloud (Google Drive + Calendar)
  ipcMain.handle('cloud:get-auth-status', () => cloud.getAuthStatus())
  ipcMain.handle('cloud:set-credentials', (_e, id: string, secret: string) =>
    cloud.setCredentials(id, secret),
  )
  ipcMain.handle('cloud:connect', () => cloud.connect())
  ipcMain.handle('cloud:disconnect', () => cloud.disconnect())
  ipcMain.handle('cloud:list-today-events', () => cloud.listTodayEvents())
  ipcMain.handle('cloud:list-sessions', () => cloud.listSessions())
  ipcMain.handle('cloud:recognize-session', (_e, id: string) => cloud.recognizeSession(id))
  ipcMain.handle('cloud:upload-session', (_e, id: string) => cloud.uploadSession(id))

  // Shared knowledge base
  ipcMain.handle('kb:get', () => store.getKb())
  ipcMain.handle('kb:save-podcast-note', (_e, name: string, notes: string) =>
    savePodcastNote(name, notes),
  )
  ipcMain.handle('kb:save-issue', (_e, input: IssueInput) => saveIssue(input))
  ipcMain.handle('kb:delete-issue', (_e, id: string) => deleteIssue(id))
  ipcMain.handle('kb:sync', async () => {
    // Prefer the Supabase workspace when signed in; otherwise fall back to Drive.
    const merged = backend.canSync()
      ? await backend.syncKnowledgeBase(store.getKb())
      : await cloud.syncKnowledgeBase(store.getKb())
    store.setKb(merged)
    return merged
  })

  // Backend accounts + shared workspaces (Supabase)
  ipcMain.handle('backend:get-status', () => backend.getStatus())
  ipcMain.handle('backend:set-config', (_e, url: string, anonKey: string) =>
    backend.setConfig(url, anonKey),
  )
  ipcMain.handle('backend:sign-up', (_e, email: string, password: string) =>
    backend.signUp(email, password),
  )
  ipcMain.handle('backend:sign-in', (_e, email: string, password: string) =>
    backend.signIn(email, password),
  )
  ipcMain.handle('backend:sign-out', () => backend.signOut())
  ipcMain.handle('backend:list-workspaces', () => backend.listWorkspaces())
  ipcMain.handle('backend:create-workspace', (_e, name: string, studio?: string) =>
    backend.createWorkspace(name, studio),
  )
  ipcMain.handle('backend:join-workspace', (_e, code: string, studio?: string) =>
    backend.joinWorkspace(code, studio),
  )
  ipcMain.handle('backend:set-active-workspace', (_e, id: string) =>
    backend.setActiveWorkspace(id),
  )
  ipcMain.handle('backend:list-members', () => backend.listMembers())

  // AI editing agents
  ipcMain.handle('ai:process-session', (_e, id: string) => ai.processSession(id))
  ipcMain.handle('ai:get-run-mode', () => getRunMode())
  ipcMain.handle('ai:set-run-mode', (_e, mode: RunMode) => store.setSetting(RUN_MODE_KEY, mode))
  ipcMain.handle('ai:has-key', () => ai.hasAnthropicKey())
  ipcMain.handle('ai:set-key', (_e, key: string) => ai.setAnthropicKey(key))
}

/** Global review-marker hotkeys (docs §6.2.2) — work even when OBS has focus. */
function registerHotkeys(): void {
  const map: Record<string, ReviewMarkerCategory> = {
    'CommandOrControl+Shift+1': 'fix',
    'CommandOrControl+Shift+2': 'highlight',
    'CommandOrControl+Shift+3': 'chapter',
    'CommandOrControl+Shift+4': 'note',
  }
  for (const [accel, category] of Object.entries(map)) {
    const ok = globalShortcut.register(accel, () => addMarker(category))
    if (!ok) console.warn(`[hotkey] failed to register ${accel}`)
  }
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#0f1115',
    title: 'StudioMaster',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  window.on('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // Default the active profile to the first one that has cameras, if unset.
  if (!store.getSetting(ACTIVE_PROFILE_KEY)) {
    const withCams = store.listProfiles().find((p) => p.cameras.length > 0)
    if (withCams) store.setSetting(ACTIVE_PROFILE_KEY, withCams.id)
  }
  migratePodcasts()
  registerIpc()
  registerHotkeys()
  createWindow()

  // OBS Custom Browser Dock control server (the "plugin inside OBS" surface).
  startDockServer({
    getState: () => ({ connection: obs.getConnectionState(), record: obs.getRecordState() }),
    toggleRecord: () => obs.toggleRecord(),
    addMarker: (category) => addMarker(category),
  })

  // Nightly editor scheduler — checks every 5 minutes (docs §6.4, transcript).
  setInterval(() => void nightlyTick(), 5 * 60 * 1000)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => globalShortcut.unregisterAll())

app.on('window-all-closed', () => {
  ptzController?.dispose()
  void obs.disconnect().catch(() => undefined)
  if (process.platform !== 'darwin') app.quit()
})
