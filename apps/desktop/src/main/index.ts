import { join } from 'node:path'
import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { ObsController } from '@studiomaster/obs-controller'
import {
  IPC_EVENTS,
  type ObsConnectionParams,
  type ObsConnectionState,
  type ObsRecordState,
  type StudioProfile,
  type WizardState,
} from '@studiomaster/shared'
import { createStore } from './store.js'
import { WizardOrchestrator } from './wizard.js'

const store = createStore()
const obs = new ObsController()
const wizard = new WizardOrchestrator((state: WizardState) => broadcast(IPC_EVENTS.wizard, state))

function broadcast<T>(channel: string, payload: T): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

// Push OBS state changes to every renderer window.
obs.on('connection', (state: ObsConnectionState) => broadcast(IPC_EVENTS.obsConnection, state))
obs.on('record', (state: ObsRecordState) => broadcast(IPC_EVENTS.obsRecord, state))

function registerIpc(): void {
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

  // Studio profiles (requirement 1).
  ipcMain.handle('profiles:list', () => store.listProfiles())
  ipcMain.handle('profiles:get', (_e, id: string) => store.getProfile(id))
  ipcMain.handle('profiles:save', (_e, profile: StudioProfile) => store.saveProfile(profile))
  ipcMain.handle('profiles:remove', (_e, id: string) => store.deleteProfile(id))

  // Opening wizard.
  ipcMain.handle('wizard:start', async (_e, profileId: string) => {
    const profile = store.getProfile(profileId)
    if (!profile) {
      wizard.reset()
      return { ...wizard.getState(), phase: 'failed', error: 'הפרופיל לא נמצא' } as WizardState
    }
    return wizard.start(profile)
  })
  ipcMain.handle('wizard:get-state', () => wizard.getState())
  ipcMain.handle('wizard:set-checklist-item', (_e, index: number, done: boolean) =>
    wizard.setChecklistItem(index, done),
  )
  ipcMain.handle('wizard:finish-checklist', () => wizard.finishChecklist())
  ipcMain.handle('wizard:reset', () => wizard.reset())
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 900,
    minHeight: 600,
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
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  void obs.disconnect().catch(() => undefined)
  if (process.platform !== 'darwin') app.quit()
})
