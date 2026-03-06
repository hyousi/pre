'use strict'

// Preload script runs in an isolated context with access to a limited Node API.
// Currently no bridge is needed — the renderer talks directly to the local
// FastAPI backend over HTTP (localhost:8765).
//
// Future use: expose ipcRenderer helpers here via contextBridge if needed.

const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
})
