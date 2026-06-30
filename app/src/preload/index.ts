import { contextBridge, ipcRenderer, webUtils } from 'electron'

contextBridge.exposeInMainWorld('scripty', {
  pathForFile: (file: File) => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },
  engine: {
    getFolders: () => ipcRenderer.invoke('eng:getFolders'),
    setFolders: (r: string[], ig: string[]) => ipcRenderer.invoke('eng:setFolders', r, ig),
    stats: () => ipcRenderer.invoke('eng:stats'),
    scenes: (f: unknown) => ipcRenderer.invoke('eng:scenes', f),
    scene: (p: string, i: number) => ipcRenderer.invoke('eng:scene', p, i),
    reindex: () => ipcRenderer.invoke('eng:reindex'),
    rebuild: () => ipcRenderer.invoke('eng:rebuild'),
    reindexStatus: () => ipcRenderer.invoke('eng:reindexStatus'),
    reindexStop: () => ipcRenderer.invoke('eng:reindexStop'),
    add: (p: string) => ipcRenderer.invoke('eng:add', p),
    rename: (p: string, name: string) => ipcRenderer.invoke('eng:rename', p, name),
    moveAll: (dir: string) => ipcRenderer.invoke('eng:moveAll', dir),
    genres: () => ipcRenderer.invoke('eng:genres'),
    mediums: () => ipcRenderer.invoke('eng:mediums'),
    getMeta: (p: string) => ipcRenderer.invoke('eng:getMeta', p),
    setMeta: (p: string, m: unknown) => ipcRenderer.invoke('eng:setMeta', p, m),
    open: (p: string) => ipcRenderer.invoke('eng:open', p),
    reveal: (p: string) => ipcRenderer.invoke('eng:reveal', p)
  },
  rowMenu: (p: { path: string; name: string }) => ipcRenderer.invoke('row-menu', p),
  onRenameRequest: (cb: (p: { path: string; name: string }) => void) => {
    const l = (_e: unknown, p: { path: string; name: string }) => cb(p)
    ipcRenderer.on('rename-request', l)
    return () => ipcRenderer.removeListener('rename-request', l)
  },
  onEditDetails: (cb: (p: { path: string; name: string }) => void) => {
    const l = (_e: unknown, p: { path: string; name: string }) => cb(p)
    ipcRenderer.on('edit-details-request', l)
    return () => ipcRenderer.removeListener('edit-details-request', l)
  },
  pickFolder: () => ipcRenderer.invoke('pick-folder') as Promise<string | null>,
  onOpenSettings: (cb: () => void) => ipcRenderer.on('open-settings', cb),
  exportSides: (html: string, name: string) => ipcRenderer.invoke('export-sides', html, name),
  appVersion: () => ipcRenderer.invoke('app-version') as Promise<string>,
  readFile: (path: string) => ipcRenderer.invoke('read-file', path) as Promise<Uint8Array>,
  renderDoc: (path: string) => ipcRenderer.invoke('render-doc', path) as Promise<string | null>,
  checkUpdates: () => ipcRenderer.invoke('check-updates'),
  quitAndInstall: () => ipcRenderer.invoke('quit-and-install'),
  quickLook: (p: { title: string; path: string; sceneIndex: number; page?: number; isPdf: boolean }) =>
    ipcRenderer.invoke('quicklook', p),
  quickLookUpdate: (p: { title: string; path: string; sceneIndex: number; page?: number; isPdf: boolean }) =>
    ipcRenderer.invoke('quicklook-update', p),
  quickLookClose: () => ipcRenderer.invoke('quicklook-close'),
  setFocusCat: (c: 'pdf' | 'text' | 'other') => ipcRenderer.send('focus-cat', c),
  onMainSpace: (cb: () => void) => {
    const l = () => cb()
    ipcRenderer.on('main-space', l)
    return () => ipcRenderer.removeListener('main-space', l)
  },
  onQuickLookClosed: (cb: () => void) => {
    const l = () => cb()
    ipcRenderer.on('quicklook-closed', l)
    return () => ipcRenderer.removeListener('quicklook-closed', l)
  },
  onQuickLookScene: (cb: (p: unknown) => void) => {
    const l = (_e: unknown, p: unknown) => cb(p)
    ipcRenderer.on('ql-scene', l)
    return () => ipcRenderer.removeListener('ql-scene', l)
  },
  onUpdateStatus: (cb: (m: unknown) => void) => {
    const listener = (_e: unknown, m: unknown) => cb(m)
    ipcRenderer.on('update-status', listener)
    return () => ipcRenderer.removeListener('update-status', listener)
  }
})
