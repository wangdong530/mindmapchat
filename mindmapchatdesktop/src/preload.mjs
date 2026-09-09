import { contextBridge, ipcRenderer } from 'electron'

if (globalThis.location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('mindmapDesktop', Object.freeze({
    getState: () => ipcRenderer.invoke('desktop:get-state'),
    applySettings: (serverUrl) => ipcRenderer.invoke('desktop:apply-settings', serverUrl),
    retry: () => ipcRenderer.invoke('desktop:retry'),
    openSettings: () => ipcRenderer.send('desktop:open-settings'),
    closeSettings: () => ipcRenderer.send('desktop:close-settings'),
  }))
}
