import { app, BrowserWindow, ipcMain, dialog, nativeImage, Menu, shell, nativeTheme } from 'electron'
import { join } from 'path'
import { Engine } from './engine/engine'
import { setupUpdater, checkForUpdatesManual, quitAndInstall } from './updater'

const HELP_URL = 'https://github.com/gleyzeddonut/scene-search'
let engine: Engine
let mainWindow: BrowserWindow | null = null
let qlWin: BrowserWindow | null = null // the Quick Look pop-out (a real OS window)

// Open (or update) a single Quick Look window — a genuine separate window the user
// can move anywhere, even onto another display. It loads our renderer (with the
// preload) and renders the preview through the same byte-read→blob path the main
// window uses, so the PDF reliably shows.
type QlPayload = { title: string; path: string; sceneIndex: number; page?: number; isPdf: boolean }

function openQuickLook(p: QlPayload) {
  if (!qlWin || qlWin.isDestroyed()) {
    qlWin = new BrowserWindow({
      width: 760,
      height: 900,
      title: p.title,
      show: false,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#1d1e23' : '#fdfdfe',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        plugins: true // Chromium's PDF viewer for the blob iframe
      }
    })
    qlWin.on('closed', () => {
      qlWin = null
      mainWindow?.webContents.send('quicklook-closed') // keep the renderer's toggle state in sync
    })
    // intercept Space/Esc at the webContents level so they close the pop-out even
    // when the PDF iframe has focus (otherwise Space scrolls the PDF) — Finder-style
    qlWin.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && (input.key === ' ' || input.key === 'Escape')) {
        event.preventDefault()
        closeQuickLook()
      }
    })
  }
  qlWin.setTitle(p.title)
  const search = '?quicklook=' + encodeURIComponent(JSON.stringify(p))
  if (process.env['ELECTRON_RENDERER_URL']) {
    qlWin.loadURL(process.env['ELECTRON_RENDERER_URL'] + search)
  } else {
    qlWin.loadFile(join(__dirname, '../renderer/index.html'), { search })
  }
  qlWin.showInactive() // visible but DON'T take focus — the list keeps Space/arrows (Finder-style)
}

// follow the selection without a full reload (and without stealing focus)
function updateQuickLook(p: QlPayload) {
  if (qlWin && !qlWin.isDestroyed()) {
    qlWin.setTitle(p.title)
    qlWin.webContents.send('ql-scene', p)
  } else {
    openQuickLook(p)
  }
}

function closeQuickLook() {
  if (qlWin && !qlWin.isDestroyed()) qlWin.close()
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
  ipcMain.handle('quicklook-update', (_e, p) => updateQuickLook(p))
  ipcMain.handle('quicklook-close', () => closeQuickLook())
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
  const icon = nativeImage.createFromPath(join(app.getAppPath(), 'resources', 'icon.png'))
  // only override the dock icon when the image actually loaded — otherwise we'd
  // blank the bundle's .icns icon in the packaged app (where resources/ isn't on disk)
  if (process.platform === 'darwin' && app.dock && !icon.isEmpty()) {
    app.dock.setIcon(icon)
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
