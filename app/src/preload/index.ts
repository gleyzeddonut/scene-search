import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('scripty', {
  engineInfo: () => ipcRenderer.invoke('engine-info'),
  pickFolder: () => ipcRenderer.invoke('pick-folder') as Promise<string | null>,
  onOpenSettings: (cb: () => void) => ipcRenderer.on('open-settings', cb)
})
