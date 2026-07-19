import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_EVENTS,
  type ObsConnectionParams,
  type ObsConnectionState,
  type ObsRecordState,
  type StudioMasterApi,
  type StudioProfile,
  type WizardState,
} from '@studiomaster/shared'

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
  onConnectionState: (cb: (state: ObsConnectionState) => void) => {
    const listener = (_e: unknown, state: ObsConnectionState) => cb(state)
    ipcRenderer.on(IPC_EVENTS.obsConnection, listener)
    return () => ipcRenderer.removeListener(IPC_EVENTS.obsConnection, listener)
  },
  onRecordState: (cb: (state: ObsRecordState) => void) => {
    const listener = (_e: unknown, state: ObsRecordState) => cb(state)
    ipcRenderer.on(IPC_EVENTS.obsRecord, listener)
    return () => ipcRenderer.removeListener(IPC_EVENTS.obsRecord, listener)
  },
  onWizardState: (cb: (state: WizardState) => void) => {
    const listener = (_e: unknown, state: WizardState) => cb(state)
    ipcRenderer.on(IPC_EVENTS.wizard, listener)
    return () => ipcRenderer.removeListener(IPC_EVENTS.wizard, listener)
  },
}

contextBridge.exposeInMainWorld('studiomaster', api)
