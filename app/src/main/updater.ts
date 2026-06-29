import { autoUpdater } from 'electron-updater'
import { dialog, BrowserWindow } from 'electron'

let manual = false

export function setupUpdater(getWindow: () => BrowserWindow | null): void {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', () => {
    if (manual) {
      const w = getWindow()
      if (w) {
        dialog.showMessageBox(w, {
          type: 'info',
          message: 'Update available',
          detail: 'Downloading in the background…'
        })
      }
    }
  })
  autoUpdater.on('update-not-available', () => {
    if (manual) {
      const w = getWindow()
      if (w) dialog.showMessageBox(w, { type: 'info', message: 'Scripty is up to date.' })
    }
    manual = false
  })
  autoUpdater.on('update-downloaded', async () => {
    const w = getWindow()
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
    manual = false // stay silent on background errors
  })

  autoUpdater.checkForUpdates().catch(() => {})
}

export function checkForUpdatesManual(): void {
  manual = true
  autoUpdater.checkForUpdates().catch(() => {})
}
