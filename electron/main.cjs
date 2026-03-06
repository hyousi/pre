'use strict'

const { app, BrowserWindow, dialog, shell } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const http = require('http')
const fs = require('fs')

const BACKEND_PORT = 8765
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

let mainWindow = null
let backendProcess = null

// ---------------------------------------------------------------------------
// Backend executable resolution
// ---------------------------------------------------------------------------

function getBackendExecutable() {
  if (isDev) return null   // managed externally via `devbox run backend`

  const ext = process.platform === 'win32' ? '.exe' : ''
  const bundled = path.join(process.resourcesPath, 'backend-dist', `gas_backend${ext}`)

  if (!fs.existsSync(bundled)) {
    dialog.showErrorBox(
      '后端可执行文件缺失',
      `未找到：${bundled}\n请重新安装应用程序。`,
    )
    app.quit()
    return null
  }
  return bundled
}

// ---------------------------------------------------------------------------
// Backend lifecycle
// ---------------------------------------------------------------------------

function startBackend() {
  if (isDev) {
    console.log('[main] Dev mode — backend managed externally on port', BACKEND_PORT)
    return
  }

  const exe = getBackendExecutable()
  if (!exe) return

  console.log('[main] Starting bundled backend:', exe)

  const dataDir = path.join(app.getPath('userData'), 'data_store')
  backendProcess = spawn(exe, [], {
    stdio: 'pipe',
    env: {
      ...process.env,
      DATA_STORE_PATH: dataDir,
      MPLCONFIGDIR: path.join(app.getPath('temp'), 'mpl_cache'),
    },
  })

  backendProcess.stdout.on('data', (d) => process.stdout.write(`[backend] ${d}`))
  backendProcess.stderr.on('data', (d) => process.stderr.write(`[backend] ${d}`))
  backendProcess.on('exit', (code, signal) => {
    console.log(`[main] Backend exited — code=${code} signal=${signal}`)
    backendProcess = null
  })
}

function stopBackend() {
  if (!backendProcess) return
  console.log('[main] Stopping backend…')
  backendProcess.kill('SIGTERM')
  // Give it 3 s to exit gracefully, then force-kill
  const timer = setTimeout(() => {
    if (backendProcess) backendProcess.kill('SIGKILL')
  }, 3000)
  backendProcess.on('exit', () => clearTimeout(timer))
  backendProcess = null
}

// ---------------------------------------------------------------------------
// Wait for backend /health
// ---------------------------------------------------------------------------

function waitForBackend(retries = 40, delayMs = 500) {
  return new Promise((resolve, reject) => {
    const check = (remaining) => {
      if (remaining <= 0) {
        reject(new Error('后端服务未能在规定时间内启动'))
        return
      }
      const req = http.get(
        `http://localhost:${BACKEND_PORT}/health`,
        { timeout: 1000 },
        (res) => {
          if (res.statusCode === 200) resolve()
          else setTimeout(() => check(remaining - 1), delayMs)
        },
      )
      req.on('error', () => setTimeout(() => check(remaining - 1), delayMs))
      req.on('timeout', () => { req.destroy(); setTimeout(() => check(remaining - 1), delayMs) })
    }
    check(retries)
  })
}

// ---------------------------------------------------------------------------
// BrowserWindow
// ---------------------------------------------------------------------------

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 840,
    minWidth: 1024,
    minHeight: 640,
    title: '燃气管网 AI 预测系统',
    backgroundColor: '#f3f4f6',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
    // macOS: merge traffic lights into the custom header (Windows is unaffected)
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' } : {}),
  })

  if (isDev) {
    mainWindow.loadURL(`http://localhost:5173`)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  // Open all target="_blank" links in system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => { mainWindow = null })
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(async () => {
  // Set app name shown in macOS menu bar / dock
  app.setName('燃气管网 AI 预测系统')

  startBackend()

  if (!isDev) {
    try {
      await waitForBackend()
    } catch (err) {
      dialog.showErrorBox('后端启动超时', String(err.message))
    }
  }

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopBackend()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => stopBackend())

// Ensure backend is killed if the main process crashes
process.on('exit', stopBackend)
process.on('SIGINT', () => { stopBackend(); process.exit(0) })
process.on('SIGTERM', () => { stopBackend(); process.exit(0) })
