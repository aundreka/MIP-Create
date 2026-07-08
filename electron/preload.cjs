// Preload: expose a minimal, typed-ish file API to the renderer. The renderer's
// bridge.ts detects window.editorAPI; when absent (plain browser) it falls back
// to download/localStorage.

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('editorAPI', {
  saveProject: (json, currentPath) => ipcRenderer.invoke('project:save', json, currentPath),
  loadProject: () => ipcRenderer.invoke('project:load'),
  fetchDataUrl: (url) => ipcRenderer.invoke('net:fetch', url),
  transcodeMedia: (dataUrl, kind, opts) => ipcRenderer.invoke('media:transcode', dataUrl, kind, opts),
  readRuntimeSrc: () => ipcRenderer.invoke('runtime:read'),
  compressHtml: (html) => ipcRenderer.invoke('html:compress', html),
  captureRect: (rect) => ipcRenderer.invoke('capture:rect', rect),
  applovinOpen: (url) => ipcRenderer.invoke('applovin:open', url),
  applovinProbe: (payload) => ipcRenderer.invoke('applovin:probe', payload),
  applovinUpload: (payload) => ipcRenderer.invoke('applovin:upload', payload),
})
