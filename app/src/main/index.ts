import { app, BrowserWindow, ipcMain, dialog, nativeImage, Menu, shell, protocol } from 'electron'
import { join } from 'path'
import { startEngine, EngineHandle } from './engine'
import { setupUpdater, checkForUpdatesManual } from './updater'

const HELP_URL = 'https://github.com/gleyzeddonut/scene-search'

// lets the renderer load a local script file (e.g. a PDF) in Chromium's viewer
protocol.registerSchemesAsPrivileged([
  { scheme: 'localfile', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

async function serveLocalFile(req: Request): Promise<Response> {
  try {
    const p = decodeURIComponent(new URL(req.url).pathname)
    const { readFile } = await import('fs/promises')
    const data = await readFile(p)
    const ext = p.toLowerCase().split('.').pop()
    const type =
      ext === 'pdf' ? 'application/pdf' : ext === 'txt' ? 'text/plain; charset=utf-8' : 'application/octet-stream'
    return new Response(new Uint8Array(data), { headers: { 'content-type': type } })
  } catch {
    return new Response('not found', { status: 404 })
  }
}
let engine: EngineHandle | null = null
let enginePromise: Promise<EngineHandle> | null = null
let mainWindow: BrowserWindow | null = null

function registerIpc() {
  // resolves once the engine is healthy; rejects if it fails to start, so the
  // renderer can show an error instead of hanging on a blank screen
  ipcMain.handle('engine-info', async () => {
    const e = await enginePromise!
    return { port: e.port, token: e.token }
  })
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

  // boot the engine in the background so the window can show "Starting engine…"
  enginePromise = startEngine()
  enginePromise
    .then((e) => {
      engine = e
    })
    .catch((err) => {
      console.error('engine failed to start:', err)
    })

  registerIpc()
  protocol.handle('localfile', serveLocalFile)
  buildMenu()

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      plugins: true // enable Chromium's built-in PDF viewer
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
app.on('before-quit', () => {
  engine?.proc.kill()
  enginePromise?.then((e) => e.proc.kill()).catch(() => {})
})
