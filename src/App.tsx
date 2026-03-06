import React, { useCallback, useEffect, useState } from 'react'
import { checkHealth, fetchUsers } from './api'
import DashboardPage from './components/DashboardPage'
import ImportPage from './components/ImportPage'
import UserSelector from './components/UserSelector'
import type { User } from './types'

type Page = 'dashboard' | 'import'

function BackendOfflineBanner() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center p-8">
        <p className="text-4xl mb-3">⚠️</p>
        <h2 className="text-lg font-bold text-slate-700 mb-2">后端服务未启动</h2>
        <p className="text-sm text-slate-500 mb-4">请在项目根目录运行以下命令：</p>
        <code className="block bg-slate-800 text-emerald-400 text-xs px-5 py-3 rounded-xl font-mono">
          devbox run backend
        </code>
        <p className="text-xs text-slate-400 mt-3">后端启动后刷新本页面即可</p>
      </div>
    </div>
  )
}

// Detect macOS Electron — preload exposes window.electronAPI.platform
const isMacElectron =
  typeof window !== 'undefined' &&
  (window as any).electronAPI?.platform === 'darwin'

export default function App() {
  const [page, setPage] = useState<Page>('dashboard')
  const [users, setUsers] = useState<User[]>([])
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [online, setOnline] = useState<boolean | null>(null)

  const refreshUsers = useCallback(async () => {
    try {
      const list = await fetchUsers()
      setUsers(list)
      // Auto-select current user's updated data, or first user if none selected
      if (currentUser) {
        const updated = list.find(u => u.id === currentUser.id)
        setCurrentUser(updated ?? list[0] ?? null)
      } else {
        setCurrentUser(list[0] ?? null)
      }
    } catch {
      // backend offline handled by health check
    }
  }, [currentUser])

  // Health check + initial data load
  useEffect(() => {
    const init = async () => {
      const alive = await checkHealth()
      setOnline(alive)
      if (alive) refreshUsers()
    }
    init()
    const interval = setInterval(async () => {
      const alive = await checkHealth()
      setOnline(alive)
    }, 5000)
    return () => clearInterval(interval)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleImportDone = (userId: string) => {
    refreshUsers().then(() => {
      setUsers(prev => {
        const u = prev.find(u => u.id === userId)
        if (u) setCurrentUser(u)
        return prev
      })
      setPage('dashboard')
    })
  }

  return (
    <div className="h-screen flex flex-col bg-gray-100">
      {/* Header — on macOS Electron, hiddenInset puts traffic lights inside this bar */}
      <header
        className={`bg-slate-800 text-white pr-5 py-3 shadow-md flex items-center justify-between flex-shrink-0 ${isMacElectron ? 'pl-20' : 'pl-5'}`}
        style={isMacElectron ? { WebkitAppRegion: 'drag' } as React.CSSProperties : undefined}
      >
        {/* Logo — no-drag so it doesn't interfere with click */}
        <div
          className="flex items-center gap-3"
          style={isMacElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : undefined}
        >
          <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
          </svg>
          <span className="text-base font-bold tracking-tight">燃气管网 AI 预测系统</span>
        </div>

        <nav
          className="flex items-center gap-2"
          style={isMacElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : undefined}
        >
          <button
            onClick={() => setPage('dashboard')}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${page === 'dashboard' ? 'bg-slate-600 text-white' : 'text-slate-300 hover:bg-slate-700'}`}
          >
            预测仪表盘
          </button>
          <button
            onClick={() => setPage('import')}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${page === 'import' ? 'bg-slate-600 text-white' : 'text-slate-300 hover:bg-slate-700'}`}
          >
            导入数据
          </button>
          <div className="ml-2">
            <UserSelector
              users={users}
              current={currentUser}
              onChange={u => { setCurrentUser(u); setPage('dashboard') }}
              onRefresh={refreshUsers}
            />
          </div>
        </nav>

        {/* Backend status dot */}
        <div
          className="flex items-center gap-1.5 ml-3"
          style={isMacElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : undefined}
        >
          <span className={`w-2 h-2 rounded-full ${online === null ? 'bg-slate-400' : online ? 'bg-emerald-400' : 'bg-red-400'}`} />
          <span className="text-xs text-slate-400">
            {online === null ? '…' : online ? '服务正常' : '服务离线'}
          </span>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 overflow-auto p-5">
        {online === false ? (
          <BackendOfflineBanner />
        ) : page === 'import' ? (
          <ImportPage
            users={users}
            onDone={handleImportDone}
          />
        ) : currentUser ? (
          <DashboardPage
            user={currentUser}
            onImport={() => setPage('import')}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center h-full">
            <div className="text-center text-slate-400">
              <p className="text-4xl mb-3 opacity-20">📊</p>
              <p className="font-medium text-slate-600">欢迎使用燃气管网 AI 预测系统</p>
              <p className="text-sm mt-1">请先
                <button onClick={() => setPage('import')} className="text-blue-600 hover:underline mx-1">导入数据</button>
                开始使用
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
