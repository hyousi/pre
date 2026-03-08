'use strict'

const { app, BrowserWindow, dialog, shell } = require('electron')
const { spawn, execSync } = require('child_process')
const path = require('path')
const http = require('http')
const fs = require('fs')

const BACKEND_PORT = 8765
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

let mainWindow = null
let backendProcess = null
let backendStderr = ''   // collect stderr for error reporting

// ---------------------------------------------------------------------------
// Backend executable resolution
// ---------------------------------------------------------------------------

function getBackendExecutable() {
  if (isDev) return null

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
// Kill anything already listening on the backend port
// ---------------------------------------------------------------------------

function killExistingOnPort(port) {
  try {
    if (process.platform === 'win32') {
      const out = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, { encoding: 'utf8', timeout: 3000 })
      const pids = [...new Set(out.split('\n').map(l => l.trim().split(/\s+/).pop()).filter(Boolean))]
      for (const pid of pids) {
        try { execSync(`taskkill /pid ${pid} /f`, { stdio: 'ignore', timeout: 3000 }) } catch {}
      }
    } else {
      execSync(`lsof -ti :${port} | xargs kill -9 2>/dev/null`, { stdio: 'ignore', timeout: 3000 })
    }
  } catch {
    // nothing on that port — fine
  }
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

  // Ensure port is free before starting
  killExistingOnPort(BACKEND_PORT)

  console.log('[main] Starting bundled backend:', exe)

  const dataDir = path.join(app.getPath('userData'), 'data_store')
  fs.mkdirSync(dataDir, { recursive: true })

  backendStderr = ''
  backendProcess = spawn(exe, [], {
    stdio: 'pipe',
    cwd: path.dirname(exe),
    env: {
      ...process.env,
      DATA_STORE_PATH: dataDir,
      MPLCONFIGDIR: path.join(app.getPath('temp'), 'mpl_cache'),
    },
  })

  backendProcess.stdout.on('data', (d) => process.stdout.write(`[backend] ${d}`))
  backendProcess.stderr.on('data', (d) => {
    const text = d.toString()
    process.stderr.write(`[backend] ${text}`)
    backendStderr += text
    // Cap collected stderr at 4 KB to avoid unbounded memory
    if (backendStderr.length > 4096) backendStderr = backendStderr.slice(-4096)
  })
  backendProcess.on('exit', (code, signal) => {
    console.log(`[main] Backend exited — code=${code} signal=${signal}`)
    backendProcess = null
  })
}

function stopBackend() {
  if (!backendProcess) return
  console.log('[main] Stopping backend…')
  if (process.platform === 'win32') {
    try { execSync(`taskkill /pid ${backendProcess.pid} /t /f`, { stdio: 'ignore' }) } catch {}
  } else {
    backendProcess.kill('SIGTERM')
    const timer = setTimeout(() => {
      if (backendProcess) backendProcess.kill('SIGKILL')
    }, 3000)
    backendProcess.on('exit', () => clearTimeout(timer))
  }
  backendProcess = null
}

// ---------------------------------------------------------------------------
// Wait for backend /health — aborts early if process exits
// ---------------------------------------------------------------------------

function waitForBackend(retries = 60, delayMs = 1000) {
  return new Promise((resolve, reject) => {
    const check = (remaining) => {
      // If the backend process already died, fail immediately
      if (!backendProcess) {
        const hint = backendStderr
          ? `\n\n后端输出：\n${backendStderr.slice(-1500)}`
          : ''
        reject(new Error(`后端进程已退出${hint}`))
        return
      }
      if (remaining <= 0) {
        reject(new Error('后端服务未能在 60 秒内启动，请重新打开应用或联系技术支持。'))
        return
      }
      const req = http.get(
        `http://127.0.0.1:${BACKEND_PORT}/health`,
        { timeout: 2000 },
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
    title: '燃气管网预测平台',
    backgroundColor: '#f3f4f6',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' } : {}),
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

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
  app.setName('燃气管网预测平台')

  startBackend()

  if (!isDev) {
    try {
      await waitForBackend()
    } catch (err) {
      dialog.showErrorBox('后端启动失败', String(err.message))
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

process.on('exit', stopBackend)
process.on('SIGINT', () => { stopBackend(); process.exit(0) })
process.on('SIGTERM', () => { stopBackend(); process.exit(0) })
