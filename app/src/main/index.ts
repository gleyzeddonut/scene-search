import { app, BrowserWindow, ipcMain, dialog, nativeImage, Menu, shell } from 'electron'
import { join } from 'path'
import { startEngine, EngineHandle } from './engine'
import { setupUpdater, checkForUpdatesManual } from './updater'

const HELP_URL = 'https://github.com/gleyzeddonut/scene-search'
let engine: EngineHandle | null = null
let mainWindow: BrowserWindow | null = null

function buildMenu() {
  app.setAboutPanelOptions({
    applicationName: 'Scripty',
    applicationVersion: app.getVersion(),
    copyright: 'Find, browse, and prepare movie scripts on your Mac.'
  })
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Scripty',
      submenu: [
        { role: 'about', label: 'About Scripty' },
        { type: 'separator' },
        {
          label: 'Settings…',
          accelerator: 'Cmd+,',
          click: () => mainWindow?.webContents.send('open-settings')
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide', label: 'Hide Scripty' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit', label: 'Quit Scripty' }
      ]
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Scripty Help', click: () => shell.openExternal(HELP_URL) },
        { label: 'Check for Updates…', click: () => checkForUpdatesManual() }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

async function createWindow() {
  const iconPath = join(app.getAppPath(), 'resources', 'icon.png')
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(nativeImage.createFromPath(iconPath))
  }

  engine = await startEngine()
  ipcMain.handle('engine-info', () => ({ port: engine!.port, token: engine!.token }))
  ipcMain.handle('pick-folder', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('app-version', () => app.getVersion())
  ipcMain.handle('check-updates', () => checkForUpdatesManual())
  ipcMain.handle('export-sides', async (_e, html: string, name: string) => {
    const r = await dialog.showSaveDialog({ defaultPath: `${name} - sides.pdf` })
    if (r.canceled || !r.filePath) return false
    const pdfWin = new BrowserWindow({ show: false, webPreferences: { offscreen: true } })
    await pdfWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    const data = await pdfWin.webContents.printToPDF({ printBackground: true })
    const { writeFile } = await import('fs/promises')
    await writeFile(r.filePath, data)
    pdfWin.destroy()
    return true
  })

  buildMenu()

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  setupUpdater(() => mainWindow) // wires status events; only auto-checks when packaged
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => engine?.proc.kill())
