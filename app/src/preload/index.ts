import { contextBridge, ipcRenderer, webUtils } from 'electron'

contextBridge.exposeInMainWorld('scripty', {
  pathForFile: (file: File) => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },
  engineInfo: () => ipcRenderer.invoke('engine-info'),
  pickFolder: () => ipcRenderer.invoke('pick-folder') as Promise<string | null>,
  onOpenSettings: (cb: () => void) => ipcRenderer.on('open-settings', cb),
  exportSides: (html: string, name: string) => ipcRenderer.invoke('export-sides', html, name),
  appVersion: () => ipcRenderer.invoke('app-version') as Promise<string>,
  readFile: (path: string) => ipcRenderer.invoke('read-file', path) as Promise<Uint8Array>,
  checkUpdates: () => ipcRenderer.invoke('check-updates'),
  onUpdateStatus: (cb: (s: string) => void) => {
    const listener = (_e: unknown, s: string) => cb(s)
    ipcRenderer.on('update-status', listener)
    return () => ipcRenderer.removeListener('update-status', listener)
  }
})
