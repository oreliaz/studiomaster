import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_EVENTS,
  type ObsConnectionParams,
  type ObsConnectionState,
  type ObsRecordState,
  type StudioMasterApi,
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
}

contextBridge.exposeInMainWorld('studiomaster', api)
