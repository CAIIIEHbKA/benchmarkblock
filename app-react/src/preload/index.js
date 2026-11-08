import { contextBridge, ipcRenderer } from 'electron'

const api = {
  getSites: () => ipcRenderer.invoke('bench:sites'),
  run: () => ipcRenderer.invoke('bench:run'),
  exportCsv: (text) => ipcRenderer.invoke('bench:export-csv', text),
  appInfo: () => ipcRenderer.invoke('bench:app-info'),

  onSiteDone: (cb) => {
    const h = (_e, r) => cb(r)
    ipcRenderer.on('bench:site-done', h)
    return () => ipcRenderer.removeListener('bench:site-done', h)
  },
  onYoutubeProgress: (cb) => {
    const h = (_e, p) => cb(p)
    ipcRenderer.on('bench:yt-progress', h)
    return () => ipcRenderer.removeListener('bench:yt-progress', h)
  },
  onDone: (cb) => {
    const h = (_e, p) => cb(p)
    ipcRenderer.on('bench:done', h)
    return () => ipcRenderer.removeListener('bench:done', h)
  },
  onError: (cb) => {
    const h = (_e, m) => cb(m)
    ipcRenderer.on('bench:error', h)
    return () => ipcRenderer.removeListener('bench:error', h)
  }
}

contextBridge.exposeInMainWorld('bench', api)
