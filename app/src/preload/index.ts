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
    reindexStatus: () => ipcRenderer.invoke('eng:reindexStatus'),
    reindexStop: () => ipcRenderer.invoke('eng:reindexStop'),
    add: (p: string) => ipcRenderer.invoke('eng:add', p),
    open: (p: string) => ipcRenderer.invoke('eng:open', p),
    reveal: (p: string) => ipcRenderer.invoke('eng:reveal', p)
  },
  pickFolder: () => ipcRenderer.invoke('pick-folder') as Promise<string | null>,
  onOpenSettings: (cb: () => void) => ipcRenderer.on('open-settings', cb),
  exportSides: (html: string, name: string) => ipcRenderer.invoke('export-sides', html, name),
  appVersion: () => ipcRenderer.invoke('app-version') as Promise<string>,
  readFile: (path: string) => ipcRenderer.invoke('read-file', path) as Promise<Uint8Array>,
  checkUpdates: () => ipcRenderer.invoke('check-updates'),
  quitAndInstall: () => ipcRenderer.invoke('quit-and-install'),
  onUpdateStatus: (cb: (m: unknown) => void) => {
    const listener = (_e: unknown, m: unknown) => cb(m)
    ipcRenderer.on('update-status', listener)
    return () => ipcRenderer.removeListener('update-status', listener)
  }
})
