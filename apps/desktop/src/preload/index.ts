import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_EVENTS,
  type InputLevel,
  type ObsConnectionParams,
  type ObsConnectionState,
  type ObsRecordState,
  type PtzMoveCommand,
  type PtzPresetCommand,
  type PtzZoomCommand,
  type ReviewMarker,
  type ReviewMarkerCategory,
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
  },
  profiles: {
    list: () => ipcRenderer.invoke('profiles:list'),
    get: (id: string) => ipcRenderer.invoke('profiles:get', id),
    save: (profile: StudioProfile) => ipcRenderer.invoke('profiles:save', profile),
    remove: (id: string) => ipcRenderer.invoke('profiles:remove', id),
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
    updateNote: (id: string, note: string) => ipcRenderer.invoke('markers:update-note', id, note),
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
  },
  ai: {
    processSession: (id: string) => ipcRenderer.invoke('ai:process-session', id),
  },
  onConnectionState: (cb: (state: ObsConnectionState) => void) =>
    subscribe(IPC_EVENTS.obsConnection, cb),
  onRecordState: (cb: (state: ObsRecordState) => void) => subscribe(IPC_EVENTS.obsRecord, cb),
  onWizardState: (cb: (state: WizardState) => void) => subscribe(IPC_EVENTS.wizard, cb),
  onMixerLevels: (cb: (levels: InputLevel[]) => void) => subscribe(IPC_EVENTS.mixerLevels, cb),
  onMarkerAdded: (cb: (marker: ReviewMarker) => void) => subscribe(IPC_EVENTS.markerAdded, cb),
  onUploadProgress: (cb: (progress: UploadProgress) => void) =>
    subscribe(IPC_EVENTS.uploadProgress, cb),
}

contextBridge.exposeInMainWorld('studiomaster', api)
