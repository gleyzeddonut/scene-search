import { autoUpdater } from 'electron-updater'
import { app, dialog, BrowserWindow } from 'electron'

export type UpdatePhase =
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'none'
  | 'error'
  | 'dev'

export interface UpdateMsg {
  phase: UpdatePhase
  pct?: number
  version?: string
}

let getWin: () => BrowserWindow | null = () => null
let pendingVersion = ''

function send(msg: UpdateMsg): void {
  getWin()?.webContents.send('update-status', msg)
}

export function setupUpdater(getWindow: () => BrowserWindow | null): void {
  getWin = getWindow
  autoUpdater.autoDownload = true // keep delivering updates in the background
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => send({ phase: 'checking' }))
  autoUpdater.on('update-available', (info) => {
    pendingVersion = info?.version || ''
    send({ phase: 'available', version: pendingVersion })
  })
  autoUpdater.on('download-progress', (p) => {
    send({ phase: 'downloading', pct: Math.round(p?.percent || 0), version: pendingVersion })
  })
  autoUpdater.on('update-not-available', () => send({ phase: 'none' }))
  autoUpdater.on('update-downloaded', async (info) => {
    const version = info?.version || pendingVersion
    send({ phase: 'ready', version })
    // also notify when Settings isn't open, so background updates still prompt
    const w = getWin()
    if (!w) return
    const r = await dialog.showMessageBox(w, {
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      message: 'Update ready',
      detail: 'Restart Scripty to finish updating.'
    })
    if (r.response === 0) autoUpdater.quitAndInstall()
  })
  autoUpdater.on('error', () => send({ phase: 'error' }))

  if (app.isPackaged) autoUpdater.checkForUpdates().catch(() => send({ phase: 'error' }))
}

export function checkForUpdatesManual(): void {
  if (!app.isPackaged) {
    send({ phase: 'dev' }) // auto-update only works in the installed (packaged) app
    return
  }
  send({ phase: 'checking' })
  autoUpdater.checkForUpdates().catch(() => send({ phase: 'error' }))
}

export function quitAndInstall(): void {
  autoUpdater.quitAndInstall()
}
