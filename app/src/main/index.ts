import { app, BrowserWindow, ipcMain, dialog, nativeImage, Menu, shell, nativeTheme } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'node:url'
import { Engine } from './engine/engine'
import { setupUpdater, checkForUpdatesManual, quitAndInstall } from './updater'

const HELP_URL = 'https://github.com/gleyzeddonut/scene-search'
let engine: Engine
let mainWindow: BrowserWindow | null = null
let qlWin: BrowserWindow | null = null // the Quick Look pop-out (a real OS window)

// Open (or update) a single Quick Look window — a genuine separate window the user
// can move anywhere, even onto another display.
function openQuickLook(p: { title: string; pdfPath?: string; page?: number; html?: string }) {
  if (!qlWin || qlWin.isDestroyed()) {
    qlWin = new BrowserWindow({
      width: 760,
      height: 900,
      title: p.title,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#1d1e23' : '#fdfdfe',
      webPreferences: { plugins: true, contextIsolation: true, nodeIntegration: false }
    })
    qlWin.on('closed', () => {
      qlWin = null
    })
  }
  qlWin.setTitle(p.title)
  if (p.pdfPath) {
    // load the real file so Chromium's PDF viewer renders it; hide its toolbar
    const url = pathToFileURL(p.pdfPath).toString() + `#page=${p.page || 1}&toolbar=0&navpanes=0`
    qlWin.loadURL(url)
  } else {
    qlWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(p.html || ''))
  }
  if (!qlWin.isVisible()) qlWin.show()
  qlWin.focus()
}

function registerIpc() {
  // in-process engine (no sidecar): the renderer calls these over IPC
  ipcMain.handle('eng:getFolders', () => engine.getFolders())
  ipcMain.handle('eng:setFolders', (_e, r: string[], ig: string[]) => engine.setFolders(r, ig))
  ipcMain.handle('eng:stats', () => engine.stats())
  ipcMain.handle('eng:scenes', (_e, f) => engine.scenes(f))
  ipcMain.handle('eng:scene', (_e, p: string, i: number) => engine.scene(p, i))
  ipcMain.handle('eng:reindex', () => engine.reindex())
  ipcMain.handle('eng:reindexStatus', () => engine.reindexStatus())
  ipcMain.handle('eng:reindexStop', () => engine.reindexStop())
  ipcMain.handle('eng:add', (_e, p: string) => engine.add(p))
  ipcMain.handle('eng:open', (_e, p: string) => { shell.openPath(p); return { ok: true } })
  ipcMain.handle('eng:reveal', (_e, p: string) => { shell.showItemInFolder(p); return { ok: true } })
  ipcMain.handle('pick-folder', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('app-version', () => app.getVersion())
  ipcMain.handle('quicklook', (_e, p) => openQuickLook(p))
  ipcMain.handle('check-updates', () => checkForUpdatesManual())
  ipcMain.handle('quit-and-install', () => quitAndInstall())
  ipcMain.handle('read-file', async (_e, p: string) => {
    const { readFile } = await import('fs/promises')
    return readFile(p) // Buffer → Uint8Array in the renderer
  })
  ipcMain.handle('export-sides', async (_e, html: string, name: string) => {
    const r = await dialog.showSaveDialog({ defaultPath: `${name} - sides.pdf` })
    if (r.canceled || !r.filePath) return false
    const pdfWin = new BrowserWindow({ show: false, webPreferences: { offscreen: true } })
    try {
      await pdfWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
      const data = await pdfWin.webContents.printToPDF({ printBackground: true })
      const { writeFile } = await import('fs/promises')
      await writeFile(r.filePath, data)
      return true
    } catch {
      return false
    } finally {
      pdfWin.destroy() // always release the offscreen window
    }
  })
}

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

function createWindow() {
  const iconPath = join(app.getAppPath(), 'resources', 'icon.png')
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(nativeImage.createFromPath(iconPath))
  }

  engine = new Engine() // in-process; loads the persisted index instantly
  registerIpc()
  buildMenu()

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    show: false, // stay hidden until the first paint so there's no blank white flash
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1d1e23' : '#fdfdfe', // matches --window
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      plugins: true // enable Chromium's built-in PDF viewer
    }
  })
  // show only once the renderer has painted (the splash), so the window appears
  // already branded instead of blank; fall back after 1.5s in case the event lags
  const reveal = () => {
    if (mainWindow && !mainWindow.isVisible()) mainWindow.show()
  }
  mainWindow.once('ready-to-show', reveal)
  setTimeout(reveal, 1500)
  mainWindow.on('close', () => {
    if (qlWin && !qlWin.isDestroyed()) qlWin.close() // don't leave the pop-out orphaned
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
