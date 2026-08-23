import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_EVENTS,
  type AiProgress,
  type InputLevel,
  type ObsConnectionParams,
  type ObsConnectionState,
  type ObsRecordState,
  type Podcast,
  type PtzMoveCommand,
  type PtzPresetCommand,
  type PtzZoomCommand,
  type RequestedDeliverables,
  type ReviewMarker,
  type ReviewMarkerCategory,
  type RunMode,
  type SessionEditPatch,
  type StudioMasterApi,
  type StudioProfile,
  type UploadProgress,
  type WizardState,
} from '@studiomaster/shared'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: unknown, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: StudioMasterApi = {
  obs: {
    connect: (params: ObsConnectionParams) => ipcRenderer.invoke('obs:connect', params),
    disconnect: () => ipcRenderer.invoke('obs:disconnect'),
    getConnectionState: () => ipcRenderer.invoke('obs:get-connection-state'),
    startRecord: () => ipcRenderer.invoke('obs:start-record'),
    stopRecord: () => ipcRenderer.invoke('obs:stop-record'),
    toggleRecord: () => ipcRenderer.invoke('obs:toggle-record'),
    getRecordState: () => ipcRenderer.invoke('obs:get-record-state'),
    getSavedConnection: () => ipcRenderer.invoke('obs:get-saved-connection'),
    configureSeparateAudio: () => ipcRenderer.invoke('obs:configure-separate-audio'),
  },
  profiles: {
    list: () => ipcRenderer.invoke('profiles:list'),
    get: (id: string) => ipcRenderer.invoke('profiles:get', id),
    save: (profile: StudioProfile) => ipcRenderer.invoke('profiles:save', profile),
    remove: (id: string) => ipcRenderer.invoke('profiles:remove', id),
  },
  podcasts: {
    list: () => ipcRenderer.invoke('podcasts:list'),
    get: (id: string) => ipcRenderer.invoke('podcasts:get', id),
    save: (podcast: Podcast) => ipcRenderer.invoke('podcasts:save', podcast),
    remove: (id: string) => ipcRenderer.invoke('podcasts:remove', id),
    getActive: () => ipcRenderer.invoke('podcasts:get-active'),
    setActive: (id: string) => ipcRenderer.invoke('podcasts:set-active', id),
  },
  wizard: {
    start: (profileId: string) => ipcRenderer.invoke('wizard:start', profileId),
    getState: () => ipcRenderer.invoke('wizard:get-state'),
    setChecklistItem: (index: number, done: boolean) =>
      ipcRenderer.invoke('wizard:set-checklist-item', index, done),
    finishChecklist: () => ipcRenderer.invoke('wizard:finish-checklist'),
    reset: () => ipcRenderer.invoke('wizard:reset'),
  },
  mixer: {
    listInputs: () => ipcRenderer.invoke('mixer:list-inputs'),
    setMute: (name: string, muted: boolean) => ipcRenderer.invoke('mixer:set-mute', name, muted),
    setVolumeDb: (name: string, db: number) => ipcRenderer.invoke('mixer:set-volume', name, db),
    listScenes: () => ipcRenderer.invoke('mixer:list-scenes'),
    setScene: (name: string) => ipcRenderer.invoke('mixer:set-scene', name),
  },
  ptz: {
    move: (cmd: PtzMoveCommand) => ipcRenderer.invoke('ptz:move', cmd),
    stop: (cameraId: string) => ipcRenderer.invoke('ptz:stop', cameraId),
    zoom: (cmd: PtzZoomCommand) => ipcRenderer.invoke('ptz:zoom', cmd),
    recallPreset: (cmd: PtzPresetCommand) => ipcRenderer.invoke('ptz:recall-preset', cmd),
    storePreset: (cmd: PtzPresetCommand) => ipcRenderer.invoke('ptz:store-preset', cmd),
    listCameras: () => ipcRenderer.invoke('ptz:list-cameras'),
  },
  markers: {
    add: (category: ReviewMarkerCategory, note?: string) =>
      ipcRenderer.invoke('markers:add', category, note),
    list: () => ipcRenderer.invoke('markers:list'),
    listForSession: (sessionId: string) =>
      ipcRenderer.invoke('markers:list-for-session', sessionId),
    updateNote: (id: string, note: string) => ipcRenderer.invoke('markers:update-note', id, note),
  },
  sessions: {
    updateEdit: (sessionId: string, patch: SessionEditPatch) =>
      ipcRenderer.invoke('sessions:update-edit', sessionId, patch),
    openFolder: (sessionId: string) => ipcRenderer.invoke('sessions:open-folder', sessionId),
    pickVideo: () => ipcRenderer.invoke('sessions:pick-video'),
    importEpisode: (input: {
      filePath: string
      podcastId?: string
      requested: RequestedDeliverables
      title?: string
    }) => ipcRenderer.invoke('sessions:import', input),
  },
  cloud: {
    getAuthStatus: () => ipcRenderer.invoke('cloud:get-auth-status'),
    setCredentials: (id: string, secret: string) =>
      ipcRenderer.invoke('cloud:set-credentials', id, secret),
    connect: () => ipcRenderer.invoke('cloud:connect'),
    disconnect: () => ipcRenderer.invoke('cloud:disconnect'),
    listTodayEvents: () => ipcRenderer.invoke('cloud:list-today-events'),
    listSessions: () => ipcRenderer.invoke('cloud:list-sessions'),
    recognizeSession: (id: string) => ipcRenderer.invoke('cloud:recognize-session', id),
    uploadSession: (id: string) => ipcRenderer.invoke('cloud:upload-session', id),
    uploadAll: () => ipcRenderer.invoke('cloud:upload-all'),
    getAutoUpload: () => ipcRenderer.invoke('cloud:get-auto-upload'),
    setAutoUpload: (on: boolean) => ipcRenderer.invoke('cloud:set-auto-upload', on),
  },
  ai: {
    processSession: (id: string) => ipcRenderer.invoke('ai:process-session', id),
    getRunMode: () => ipcRenderer.invoke('ai:get-run-mode'),
    setRunMode: (mode: RunMode) => ipcRenderer.invoke('ai:set-run-mode', mode),
    hasKey: () => ipcRenderer.invoke('ai:has-key'),
    setKey: (key: string) => ipcRenderer.invoke('ai:set-key', key),
    processQueue: () => ipcRenderer.invoke('ai:process-queue'),
  },
  kb: {
    get: () => ipcRenderer.invoke('kb:get'),
    savePodcastNote: (name: string, notes: string) =>
      ipcRenderer.invoke('kb:save-podcast-note', name, notes),
    saveIssue: (input: { id?: string; title: string; symptom: string; fix: string; tags?: string[] }) =>
      ipcRenderer.invoke('kb:save-issue', input),
    deleteIssue: (id: string) => ipcRenderer.invoke('kb:delete-issue', id),
    sync: () => ipcRenderer.invoke('kb:sync'),
  },
  backend: {
    getStatus: () => ipcRenderer.invoke('backend:get-status'),
    setConfig: (url: string, anonKey: string) =>
      ipcRenderer.invoke('backend:set-config', url, anonKey),
    signUp: (email: string, password: string) =>
      ipcRenderer.invoke('backend:sign-up', email, password),
    signIn: (email: string, password: string) =>
      ipcRenderer.invoke('backend:sign-in', email, password),
    signOut: () => ipcRenderer.invoke('backend:sign-out'),
    listWorkspaces: () => ipcRenderer.invoke('backend:list-workspaces'),
    createWorkspace: (name: string, studioName?: string) =>
      ipcRenderer.invoke('backend:create-workspace', name, studioName),
    joinWorkspace: (joinCode: string, studioName?: string) =>
      ipcRenderer.invoke('backend:join-workspace', joinCode, studioName),
    setActiveWorkspace: (id: string) => ipcRenderer.invoke('backend:set-active-workspace', id),
    listMembers: () => ipcRenderer.invoke('backend:list-members'),
  },
  settings: {
    setLang: (lang: 'he' | 'en') => ipcRenderer.invoke('settings:set-lang', lang),
  },
  onConnectionState: (cb: (state: ObsConnectionState) => void) =>
    subscribe(IPC_EVENTS.obsConnection, cb),
  onRecordState: (cb: (state: ObsRecordState) => void) => subscribe(IPC_EVENTS.obsRecord, cb),
  onWizardState: (cb: (state: WizardState) => void) => subscribe(IPC_EVENTS.wizard, cb),
  onMixerLevels: (cb: (levels: InputLevel[]) => void) => subscribe(IPC_EVENTS.mixerLevels, cb),
  onMarkerAdded: (cb: (marker: ReviewMarker) => void) => subscribe(IPC_EVENTS.markerAdded, cb),
  onUploadProgress: (cb: (progress: UploadProgress) => void) =>
    subscribe(IPC_EVENTS.uploadProgress, cb),
  onAiProgress: (cb: (progress: AiProgress) => void) => subscribe(IPC_EVENTS.aiProgress, cb),
}

contextBridge.exposeInMainWorld('studiomaster', api)
