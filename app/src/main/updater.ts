import { autoUpdater } from 'electron-updater'
import { app, dialog, BrowserWindow } from 'electron'

type Status = 'checking' | 'available' | 'not-available' | 'downloaded' | 'error' | 'dev'

let getWin: () => BrowserWindow | null = () => null
let manual = false

function send(status: Status): void {
  getWin()?.webContents.send('update-status', status)
}

export function setupUpdater(getWindow: () => BrowserWindow | null): void {
  getWin = getWindow
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => send('checking'))
  autoUpdater.on('update-available', () => {
    send('available')
    if (manual) {
      const w = getWin()
      if (w) dialog.showMessageBox(w, { type: 'info', message: 'Update available', detail: 'Downloading in the background…' })
    }
  })
  autoUpdater.on('update-not-available', () => {
    send('not-available')
    if (manual) {
      const w = getWin()
      if (w) dialog.showMessageBox(w, { type: 'info', message: 'Scripty is up to date.' })
    }
    manual = false
  })
  autoUpdater.on('update-downloaded', async () => {
    send('downloaded')
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
    manual = false
  })
  autoUpdater.on('error', () => {
    send('error')
    manual = false
  })

  if (app.isPackaged) autoUpdater.checkForUpdates().catch(() => send('error'))
}

export function checkForUpdatesManual(): void {
  if (!app.isPackaged) {
    send('dev') // auto-update only works in the installed (packaged) app
    return
  }
  manual = true
  send('checking')
  autoUpdater.checkForUpdates().catch(() => send('error'))
}
