import { useEffect, useRef, useState } from 'react'
import { fetchTasks } from '../api'
import type { TaskStatus, TrainTask } from '../types'

interface Props {
  onBack: () => void
  onSelectUser: (userId: string) => void
}

const STATUS_MAP: Record<TaskStatus, { label: string; color: string; bg: string }> = {
  pending:  { label: '排队中', color: 'text-slate-500', bg: 'bg-slate-100' },
  training: { label: '训练中', color: 'text-blue-600',  bg: 'bg-blue-50' },
  done:     { label: '已完成', color: 'text-emerald-600', bg: 'bg-emerald-50' },
  error:    { label: '失败',   color: 'text-red-600',  bg: 'bg-red-50' },
}

function StatusBadge({ status }: { status: TaskStatus }) {
  const s = STATUS_MAP[status]
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${s.color} ${s.bg}`}>
      {status === 'training' && (
        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
      )}
      {s.label}
    </span>
  )
}

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString('zh-CN', { hour12: false })
  } catch {
    return iso
  }
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
  } catch {
    return iso
  }
}

function elapsed(start: string | null, end: string | null): string {
  if (!start) return '—'
  const s = new Date(start).getTime()
  const e = end ? new Date(end).getTime() : Date.now()
  const sec = Math.round((e - s) / 1000)
  if (sec < 60) return `${sec}s`
  return `${Math.floor(sec / 60)}m ${sec % 60}s`
}

export default function TaskListPage({ onBack, onSelectUser }: Props) {
  const [tasks, setTasks] = useState<TrainTask[]>([])
  const [loading, setLoading] = useState(true)
  const pollRef = useRef<ReturnType<typeof setInterval>>()

  const load = async () => {
    try {
      const list = await fetchTasks()
      setTasks(list)
    } catch { /* ignore */ }
    setLoading(false)
  }

  useEffect(() => {
    load()
    // Poll every 2s while any task is active
    pollRef.current = setInterval(load, 2000)
    return () => clearInterval(pollRef.current)
  }, [])

  // Stop polling when no active tasks
  useEffect(() => {
    const hasActive = tasks.some(t => t.status === 'pending' || t.status === 'training')
    if (!hasActive && pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = undefined
    } else if (hasActive && !pollRef.current) {
      pollRef.current = setInterval(load, 2000)
    }
  }, [tasks])

  return (
    <div className="p-5 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-lg font-bold text-slate-800">训练任务</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {tasks.length} 个任务
            {tasks.some(t => t.status === 'training') && ' · 自动刷新中'}
          </p>
        </div>
        <button
          onClick={onBack}
          className="text-xs text-blue-600 hover:text-blue-700 border border-blue-200 hover:border-blue-400 px-3 py-1.5 rounded-lg transition-colors"
        >
          返回预测
        </button>
      </div>

      {/* Task list */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin" />
        </div>
      ) : tasks.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-12 text-center">
          <p className="text-slate-400 text-sm">暂无训练任务</p>
          <p className="text-slate-300 text-xs mt-1">上传数据后系统将自动创建训练任务</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map(task => {
            const isDone = task.status === 'done'
            return (
              <div
                key={task.id}
                onClick={isDone ? () => onSelectUser(task.user_id) : undefined}
                className={`bg-white rounded-xl border p-4 transition-all ${
                  isDone
                    ? 'border-emerald-200 hover:border-emerald-300 hover:shadow-sm cursor-pointer group'
                    : task.status === 'training'
                    ? 'border-blue-200 shadow-sm shadow-blue-50'
                    : task.status === 'error'
                    ? 'border-red-100'
                    : 'border-slate-100'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-sm font-semibold truncate ${isDone ? 'text-slate-700 group-hover:text-emerald-700' : 'text-slate-700'}`}>
                        {task.user_name}
                      </span>
                      <StatusBadge status={task.status} />
                      {isDone && (
                        <span className="text-[10px] text-emerald-500 opacity-0 group-hover:opacity-100 transition-opacity">
                          点击进入预测 →
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-slate-400">
                      <span>{formatDate(task.created_at)} {formatTime(task.created_at)}</span>
                      {task.started_at && (
                        <span>耗时 {elapsed(task.started_at, task.completed_at)}</span>
                      )}
                      <span className="text-slate-300 font-mono">#{task.id}</span>
                    </div>
                  </div>

                  <div className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center mt-0.5">
                    {isDone ? (
                      <div className="w-8 h-8 rounded-lg bg-emerald-50 group-hover:bg-emerald-100 flex items-center justify-center transition-colors">
                        <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    ) : task.status === 'training' ? (
                      <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                        <div className="w-4 h-4 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
                      </div>
                    ) : task.status === 'error' ? (
                      <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center">
                        <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                    ) : (
                      <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center">
                        <div className="w-3 h-3 rounded-full border-2 border-slate-300" />
                      </div>
                    )}
                  </div>
                </div>

                {task.status === 'error' && task.error && (
                  <div className="mt-2 px-3 py-2 bg-red-50 text-red-600 text-xs rounded-lg border border-red-100 truncate">
                    {task.error}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
