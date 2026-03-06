import { useEffect, useRef, useState } from 'react'
import type { User } from '../types'

interface Props {
  users: User[]
  current: User | null
  onChange: (user: User) => void
  onRefresh: () => void
}

export default function UserSelector({ users, current, onChange, onRefresh }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm transition-colors"
      >
        <span className="w-2 h-2 rounded-full bg-emerald-400" />
        <span className="max-w-[140px] truncate">{current?.name ?? '选择用户'}</span>
        <svg className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-60 bg-white rounded-xl shadow-xl border border-gray-100 z-50 overflow-hidden">
          <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500">用户列表</span>
            <button onClick={() => { onRefresh(); setOpen(false) }} className="text-xs text-blue-600 hover:text-blue-700">刷新</button>
          </div>

          {users.length === 0 ? (
            <p className="px-3 py-4 text-xs text-gray-400 text-center">暂无用户，请先导入数据</p>
          ) : (
            <ul className="max-h-64 overflow-y-auto divide-y divide-gray-50">
              {users.map(u => (
                <li key={u.id}>
                  <button
                    onClick={() => { onChange(u); setOpen(false) }}
                    className={`w-full text-left px-3 py-2.5 hover:bg-blue-50 transition-colors ${current?.id === u.id ? 'bg-blue-50' : ''}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-800 truncate max-w-[150px]">{u.name}</span>
                      {u.has_model ? (
                        <span className="text-xs px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded-full">已训练</span>
                      ) : (
                        <span className="text-xs px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full">未训练</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">{u.rows} 条数据</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
