import { app, BrowserWindow, ipcMain, dialog, nativeImage, Menu, shell, nativeTheme } from 'electron'
import { join } from 'path'
import { Engine } from './engine/engine'
import { setupUpdater, checkForUpdatesManual, quitAndInstall, setAutoDownload, startupCheck, downloadUpdate } from './updater'

const HELP_URL = 'https://github.com/gleyzeddonut/scene-search'
let engine: Engine
// The engine loads + JSON-parses the whole saved index, which can take a beat on a
// large library. We build it AFTER the launch splash is on screen (see createWindow)
// so it doesn't block the window from appearing; engine IPC handlers await this.
let resolveEngineReady!: () => void
const engineReady = new Promise<void>((r) => { resolveEngineReady = r })
// wrap an engine-backed IPC handler so it waits for the deferred engine load
function onEngine<A extends unknown[], R>(fn: (...a: A) => R) {
  return async (_e: unknown, ...args: A) => {
    await engineReady
    return fn(...args)
  }
}
let mainWindow: BrowserWindow | null = null
let qlWin: BrowserWindow | null = null // the Quick Look pop-out (a real OS window)
// what currently has keyboard focus in the main window, reported by the renderer:
// 'pdf' = the embedded PDF preview (which otherwise eats Space to scroll), 'text' =
// a search/input field, 'other' = normal DOM. Lets us reclaim Space only over the PDF.
let spaceTarget: 'pdf' | 'text' | 'other' = 'other'

// Open (or update) a single Quick Look window — a genuine separate window the user
// can move anywhere, even onto another display. It loads our renderer (with the
// preload) and renders the preview through the same byte-read→blob path the main
// window uses, so the PDF reliably shows.
type QlPayload = { title: string; path: string; sceneIndex: number; page?: number; top?: number; isPdf: boolean }

function openQuickLook(p: QlPayload) {
  // the window is kept alive across closes (hidden, not destroyed), so after the first
  // open its renderer bundle is already loaded — just update the scene and reveal it
  // instantly instead of reloading the whole app (the ~1s grey-then-load).
  if (qlWin && !qlWin.isDestroyed()) {
    qlWin.setTitle(p.title)
    qlWin.webContents.send('ql-scene', p)
    if (!qlWin.isVisible()) qlWin.showInactive()
    return
  }
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
  // closing the pop-out (red X) hides it rather than destroying it, so the next open is
  // instant; the main window closing (below) force-destroys it on app teardown
  qlWin.on('close', (e) => {
    e.preventDefault()
    qlWin?.hide()
  })
  qlWin.on('hide', () => mainWindow?.webContents.send('quicklook-closed')) // sync the toggle
  qlWin.on('closed', () => { qlWin = null })
  // intercept Space/Esc at the webContents level so they close the pop-out even
  // when the PDF iframe has focus (otherwise Space scrolls the PDF) — Finder-style
  qlWin.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && !input.isAutoRepeat && (input.key === ' ' || input.key === 'Escape')) {
      event.preventDefault()
      closeQuickLook()
    }
  })
  qlWin.once('ready-to-show', () => qlWin?.showInactive()) // show only once painted — no grey flash
  qlWin.setTitle(p.title)
  const search = '?quicklook=' + encodeURIComponent(JSON.stringify(p))
  if (process.env['ELECTRON_RENDERER_URL']) {
    qlWin.loadURL(process.env['ELECTRON_RENDERER_URL'] + search)
  } else {
    qlWin.loadFile(join(__dirname, '../renderer/index.html'), { search })
  }
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
  if (qlWin && !qlWin.isDestroyed()) qlWin.hide() // hide (keep alive) so reopening is instant
}

function registerIpc() {
  // in-process engine (no sidecar): the renderer calls these over IPC. Each waits for
  // the engine to finish its (deferred) index load via onEngine.
  ipcMain.handle('eng:getFolders', onEngine(() => engine.getFolders()))
  ipcMain.handle('eng:setFolders', onEngine((r: string[], ig: string[]) => engine.setFolders(r, ig)))
  ipcMain.handle('eng:stats', onEngine(() => engine.stats()))
  ipcMain.handle('eng:scenes', onEngine((f: unknown) => engine.scenes(f as Parameters<Engine['scenes']>[0])))
  ipcMain.handle('eng:scene', onEngine((p: string, i: number) => engine.scene(p, i)))
  ipcMain.handle('eng:reindex', onEngine(() => engine.reindex()))
  ipcMain.handle('eng:rebuild', onEngine(() => engine.rebuild()))
  ipcMain.handle('eng:reindexStatus', onEngine(() => engine.reindexStatus()))
  ipcMain.handle('eng:reindexStop', onEngine(() => engine.reindexStop()))
  ipcMain.handle('eng:add', onEngine((p: string) => engine.add(p)))
  ipcMain.handle('eng:remove', onEngine((p: string) => engine.removeScript(p)))
  ipcMain.handle('eng:rename', onEngine((p: string, name: string) => engine.rename(p, name)))
  ipcMain.handle('eng:moveAll', onEngine((dir: string) => engine.moveAll(dir)))
  ipcMain.handle('eng:genres', onEngine(() => engine.allGenres()))
  ipcMain.handle('eng:mediums', onEngine(() => engine.mediums()))
  ipcMain.handle('eng:getMeta', onEngine((p: string) => engine.getMeta(p)))
  ipcMain.handle(
    'eng:setMeta',
    onEngine((p: string, m: { genres: string[]; genders: Record<string, 'female' | 'male' | 'unknown'> }) =>
      engine.setMeta(p, m)
    )
  )
  ipcMain.handle('eng:setGenres', onEngine((p: string, g: string[]) => engine.setGenres(p, g)))
  ipcMain.handle('eng:setMedium', onEngine((p: string, md: string) => engine.setMedium(p, md)))
  ipcMain.handle('eng:prefs', onEngine(() => engine.prefs()))
  ipcMain.handle(
    'eng:setPref',
    onEngine((k: 'monologueMin' | 'autoDownload', v: number | boolean) => {
      const prefs = engine.setPref(k, v)
      if (k === 'autoDownload') setAutoDownload(prefs.autoDownload) // apply live
      return prefs
    })
  )
  ipcMain.handle('eng:hidden', onEngine(() => engine.hiddenFiles()))
  ipcMain.handle('eng:open', (_e, p: string) => { shell.openPath(p); return { ok: true } })
  ipcMain.handle('eng:reveal', (_e, p: string) => { shell.showItemInFolder(p); return { ok: true } })
  // native right-click menu for a script row
  ipcMain.handle('row-menu', (e, p: { path: string; name: string }) => {
    const menu = Menu.buildFromTemplate([
      { label: 'Quick Look', click: () => e.sender.send('quicklook-request', p) },
      { label: 'Edit details…', click: () => e.sender.send('edit-details-request', p) },
      { type: 'separator' },
      { label: 'Show in Finder', click: () => shell.showItemInFolder(p.path) },
      { label: 'Remove from library', click: () => e.sender.send('remove-request', p) }
    ])
    menu.popup({ window: BrowserWindow.fromWebContents(e.sender) ?? undefined })
  })
  ipcMain.handle('pick-folder', async () => {
    // createDirectory adds the macOS "New Folder" button so a destination can be made
    // right in the picker (e.g. when consolidating scripts into a brand-new folder)
    const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
  // pick one or more script files to add to the library
  ipcMain.handle('pick-files', async () => {
    const r = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Scripts', extensions: ['pdf', 'docx', 'txt', 'fountain', 'fdx'] }]
    })
    return r.canceled ? [] : r.filePaths
  })
  ipcMain.handle('app-version', () => app.getVersion())
  ipcMain.handle('quicklook', (_e, p) => openQuickLook(p))
  ipcMain.handle('quicklook-update', (_e, p) => updateQuickLook(p))
  ipcMain.handle('quicklook-close', () => closeQuickLook())
  ipcMain.on('focus-cat', (_e, c: 'pdf' | 'text' | 'other') => { spaceTarget = c })
  ipcMain.handle('check-updates', () => checkForUpdatesManual())
  ipcMain.handle('download-update', () => downloadUpdate())
  ipcMain.handle('quit-and-install', () => quitAndInstall())
  // 'floating' keeps the window above normal windows without covering full-screen
  // spaces — for running lines beside another app (a self-tape monitor, Zoom)
  ipcMain.handle('set-always-on-top', (_e, v: boolean) => {
    mainWindow?.setAlwaysOnTop(!!v, 'floating')
    return { ok: true }
  })
  ipcMain.handle('read-file', async (_e, p: string) => {
    const { readFile } = await import('fs/promises')
    return readFile(p) // Buffer → Uint8Array in the renderer
  })
  // render a .docx as its real document HTML (mammoth, images inlined as data URIs)
  // so the preview shows the actual document, not the parsed scenes
  ipcMain.handle('render-doc', async (_e, p: string): Promise<string | null> => {
    try {
      const mammoth: any = await import('mammoth')
      const { value } = await mammoth.convertToHtml({ path: p })
      return value as string
    } catch {
      return null
    }
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

  registerIpc() // handlers await engineReady, so it's safe to register before the engine exists
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
  // build the engine (loads + parses the saved index) only after the splash is on
  // screen, so a large library doesn't delay the window from appearing
  const startEngine = () => {
    if (engine) return
    // ALWAYS release engineReady, even if construction throws — otherwise every
    // engine IPC handler awaits it forever and the app silently hangs. A failed
    // engine just makes those handlers reject (visible error) instead.
    try {
      engine = new Engine()
    } catch (err) {
      console.error('Engine failed to initialize:', err)
    } finally {
      resolveEngineReady()
    }
    // apply the persisted auto-download pref BEFORE the launch update check, so a
    // user who turned automatic downloads off never gets a surprise background one
    try {
      setAutoDownload(engine?.prefs().autoDownload ?? true)
    } catch {
      /* default (on) stands */
    }
    startupCheck()
  }
  // show only once the renderer has painted (the splash), so the window appears
  // already branded instead of blank; fall back after 1.5s in case the event lags.
  // load the index a tick later, once the painted splash is up.
  const reveal = () => {
    if (mainWindow && !mainWindow.isVisible()) mainWindow.show()
    setImmediate(startEngine)
  }
  mainWindow.once('ready-to-show', reveal)
  setTimeout(reveal, 1500)

  // When the embedded PDF preview has focus it swallows Space (to scroll) before the
  // renderer ever sees it. Intercept Space here and let the app toggle Quick Look —
  // but only over the PDF, so typing a space in the search field still works.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    // ignore key-repeat so holding Space doesn't strobe the pop-out open/closed
    if (input.type === 'keyDown' && input.key === ' ' && !input.isAutoRepeat && spaceTarget === 'pdf') {
      event.preventDefault()
      mainWindow?.webContents.send('main-space')
    }
  })
  mainWindow.on('close', () => {
    // force-destroy (not close → that just hides it now) so the app can fully quit
    if (qlWin && !qlWin.isDestroyed()) qlWin.destroy()
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
