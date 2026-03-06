import React, { useCallback, useEffect, useState } from 'react'
import { checkHealth, fetchUsers } from './api'
import EmptyState from './components/EmptyState'
import ImportPage from './components/ImportPage'
import PredictPage from './components/PredictPage'
import TrainingProgress from './components/TrainingProgress'
import TrainingSuccess from './components/TrainingSuccess'
import UserSelector from './components/UserSelector'
import type { Metrics, User } from './types'

type Page = 'init' | 'empty' | 'import' | 'training' | 'trained' | 'predict'

// Detect macOS Electron — preload exposes window.electronAPI.platform
const isMacElectron =
  typeof window !== 'undefined' &&
  (window as any).electronAPI?.platform === 'darwin'

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

export default function App() {
  const [page, setPage] = useState<Page>('init')
  const [users, setUsers] = useState<User[]>([])
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [online, setOnline] = useState<boolean | null>(null)

  // Set during import → training flow
  const [pendingUserId, setPendingUserId] = useState<string | null>(null)
  const [trainedMetrics, setTrainedMetrics] = useState<Metrics | null>(null)

  const refreshUsers = useCallback(async () => {
    try {
      const list = await fetchUsers()
      setUsers(list)
      return list
    } catch {
      return []
    }
  }, [])

  // Init: health check + decide starting page
  useEffect(() => {
    const init = async () => {
      const alive = await checkHealth()
      setOnline(alive)
      if (!alive) {
        setPage('empty') // will show offline banner via online===false check
        return
      }
      const list = await refreshUsers()
      const hasModel = list.some(u => u.has_model)
      setCurrentUser(list[0] ?? null)
      setPage(hasModel ? 'predict' : 'empty')
    }
    init()

    // Periodic health check
    const interval = setInterval(async () => {
      const alive = await checkHealth()
      setOnline(alive)
    }, 5000)
    return () => clearInterval(interval)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Called when ImportPage finishes uploading
  const handleUploaded = (userId: string) => {
    setPendingUserId(userId)
    setPage('training')
  }

  // Called when TrainingProgress SSE completes
  const handleTrainingDone = async (metrics: Metrics) => {
    setTrainedMetrics(metrics)
    const list = await refreshUsers()
    const trained = list.find(u => u.id === pendingUserId)
    if (trained) setCurrentUser(trained)
    setPage('trained')
  }

  // Called from TrainingSuccess "开始预测" button
  const handleStartPredict = () => {
    setPage('predict')
  }

  const showHeader = page === 'predict'

  return (
    <div className="h-screen flex flex-col bg-gray-100">

      {/* Header — only shown on predict page */}
      {showHeader && <div className={`bg-slate-800 ${isMacElectron ? 'h-8' : 'h-3'}`} />}
      {showHeader && (
        <header
          className={`bg-slate-800 text-white px-5 pb-3 shadow-md flex items-center justify-between flex-shrink-0`}
          style={isMacElectron ? { WebkitAppRegion: 'drag' } as React.CSSProperties : undefined}
        >
          
          {/* Left: title */}
          <div
            className="flex items-center gap-2.5"
            style={isMacElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : undefined}
          >
            <svg className="w-5 h-5 text-blue-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
            </svg>
            <span className="text-sm font-bold tracking-tight">燃气管网 AI 预测系统</span>
          </div>

          {/* Right: nav + status */}
          <div
            className="flex items-center gap-3"
            style={isMacElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : undefined}
          >
            <UserSelector
              users={users}
              current={currentUser}
              onChange={u => setCurrentUser(u)}
              onRefresh={refreshUsers}
            />
            <button
              onClick={() => setPage('import')}
              className="px-3 py-1.5 text-sm rounded-lg text-slate-300 hover:bg-slate-700 transition-colors border border-slate-600"
            >
              + 录入数据
            </button>
            <div className="flex items-center gap-1.5 pl-1 border-l border-slate-700">
              <span className={`w-2 h-2 rounded-full ${online === null ? 'bg-slate-400' : online ? 'bg-emerald-400' : 'bg-red-400'}`} />
              <span className="text-xs text-slate-400">
                {online === null ? '…' : online ? '服务正常' : '服务离线'}
              </span>
            </div>
          </div>
        </header>
      )}

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        {online === false && page !== 'init' ? (
          <BackendOfflineBanner />
        ) : page === 'init' ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-slate-400">
              <div className="w-8 h-8 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm">正在连接后端服务…</p>
            </div>
          </div>
        ) : page === 'empty' ? (
          <EmptyState onStart={() => setPage('import')} />
        ) : page === 'import' ? (
          <ImportPage
            users={users}
            onUploaded={handleUploaded}
            onCancel={users.some(u => u.has_model) ? () => setPage('predict') : undefined}
          />
        ) : page === 'training' && pendingUserId ? (
          <TrainingProgress
            userId={pendingUserId}
            onDone={handleTrainingDone}
          />
        ) : page === 'trained' && trainedMetrics ? (
          <TrainingSuccess
            metrics={trainedMetrics}
            onStart={handleStartPredict}
          />
        ) : page === 'predict' && currentUser ? (
          <PredictPage
            user={currentUser}
            onImport={() => setPage('import')}
          />
        ) : page === 'predict' && !currentUser ? (
          <EmptyState onStart={() => setPage('import')} />
        ) : null}
      </main>
    </div>
  )
}
