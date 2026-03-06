import { useEffect, useRef, useState } from 'react'
import type { Metrics } from '../types'

const BASE: string = (import.meta as any).env?.VITE_API_BASE ?? 'http://localhost:8765'

interface Props {
  userId: string
  onDone: (metrics: Metrics) => void
}

type PhaseStatus = 'waiting' | 'running' | 'done' | 'error'

interface Phase {
  label: string
  status: PhaseStatus
}

const INITIAL_PHASES: Phase[] = [
  { label: '训练用气量预测模型', status: 'waiting' },
  { label: '训练压力预测模型', status: 'waiting' },
  { label: '评估指标 & 保存', status: 'waiting' },
]

const DONE_PHASES: Phase[] = INITIAL_PHASES.map(p => ({ ...p, status: 'done' }))

export default function TrainingProgress({ userId, onDone }: Props) {
  const [phases, setPhases] = useState<Phase[]>(INITIAL_PHASES)
  const [errorMsg, setErrorMsg] = useState('')
  const [elapsedMs, setElapsedMs] = useState(0)
  const startRef = useRef(Date.now())
  const esRef = useRef<EventSource | null>(null)

  // Elapsed timer
  useEffect(() => {
    const timer = setInterval(() => setElapsedMs(Date.now() - startRef.current), 500)
    return () => clearInterval(timer)
  }, [])

  // Visual phase progression based on elapsed time
  useEffect(() => {
    const s = elapsedMs / 1000
    setPhases(prev => {
      const next = [...prev]
      if (s >= 1  && next[0].status === 'waiting') next[0] = { ...next[0], status: 'running' }
      if (s >= 8  && next[0].status === 'running') next[0] = { ...next[0], status: 'done' }
      if (s >= 8  && next[1].status === 'waiting') next[1] = { ...next[1], status: 'running' }
      if (s >= 16 && next[1].status === 'running') next[1] = { ...next[1], status: 'done' }
      if (s >= 16 && next[2].status === 'waiting') next[2] = { ...next[2], status: 'running' }
      return next
    })
  }, [elapsedMs])

  // SSE stream
  useEffect(() => {
    const es = new EventSource(`${BASE}/api/train/stream/${userId}`)
    esRef.current = es

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.done) {
          es.close()
          if (data.error) {
            setErrorMsg(data.error)
            setPhases(prev => prev.map(p =>
              p.status === 'running' ? { ...p, status: 'error' } : p
            ))
          } else {
            setPhases(DONE_PHASES)
            setTimeout(() => onDone(data.metrics as Metrics), 600)
          }
        }
      } catch {
        // ignore malformed messages
      }
    }

    es.onerror = () => {
      es.close()
      setErrorMsg('与后端的连接中断，请刷新页面重试')
      setPhases(prev => prev.map(p =>
        p.status === 'running' ? { ...p, status: 'error' } : p
      ))
    }

    return () => { es.close() }
  }, [userId, onDone])

  const formatTime = (ms: number) => {
    const s = Math.floor(ms / 1000)
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
  }

  return (
    <div className="flex items-center justify-center min-h-full p-6">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg p-8">
        {/* Icon */}
        <div className="flex justify-center mb-6">
          {errorMsg ? (
            <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center">
              <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
          ) : (
            <div className="relative w-16 h-16">
              <div className="absolute inset-0 rounded-full border-4 border-slate-100" />
              <div className="absolute inset-0 rounded-full border-4 border-t-blue-500 animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center">
                <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
            </div>
          )}
        </div>

        <h2 className="text-lg font-bold text-slate-800 text-center mb-1">
          {errorMsg ? '训练失败' : '模型训练中'}
        </h2>
        {!errorMsg && (
          <p className="text-sm text-slate-500 text-center mb-6">
            已用时 {formatTime(elapsedMs)}，请耐心等待…
          </p>
        )}

        {/* Phase list */}
        <div className="space-y-3 mb-6">
          {phases.map((phase, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center">
                {phase.status === 'done' ? (
                  <div className="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center">
                    <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                ) : phase.status === 'running' ? (
                  <div className="w-5 h-5 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
                ) : phase.status === 'error' ? (
                  <div className="w-6 h-6 rounded-full bg-red-100 flex items-center justify-center">
                    <svg className="w-3.5 h-3.5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </div>
                ) : (
                  <div className="w-5 h-5 rounded-full border-2 border-slate-200" />
                )}
              </div>
              <span className={`text-sm ${
                phase.status === 'done'    ? 'text-slate-400 line-through'
                : phase.status === 'running' ? 'text-blue-700 font-medium'
                : phase.status === 'error'   ? 'text-red-600'
                : 'text-slate-400'
              }`}>
                {phase.label}
              </span>
            </div>
          ))}
        </div>

        {errorMsg ? (
          <div className="px-4 py-3 bg-red-50 text-red-600 text-sm rounded-xl border border-red-100">
            {errorMsg}
          </div>
        ) : (
          <p className="text-xs text-slate-400 text-center">Prophet 训练通常需要 20–40 秒</p>
        )}
      </div>
    </div>
  )
}
