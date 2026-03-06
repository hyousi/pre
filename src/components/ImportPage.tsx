import { useCallback, useRef, useState } from 'react'
import { uploadData } from '../api'
import type { User } from '../types'

interface Props {
  users: User[]
  onUploaded: (userId: string) => void
  onCancel?: () => void
}

type Stage = 'idle' | 'uploading' | 'error'

export default function ImportPage({ users, onUploaded, onCancel }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [userName, setUserName] = useState('')
  const [targetUserId, setTargetUserId] = useState('')
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFile = (f: File) => {
    if (!f.name.match(/\.xlsx?$/i)) {
      setError('仅支持 .xlsx / .xls 格式')
      return
    }
    setFile(f)
    setError('')
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }, [])

  const handleSubmit = async () => {
    if (!file) return setError('请先选择文件')
    if (!userName.trim() && !targetUserId) return setError('请填写用户名称或选择已有用户')

    const name = userName.trim() || users.find(u => u.id === targetUserId)?.name || '未命名用户'
    setError('')

    try {
      setStage('uploading')
      const uploaded = await uploadData(file, name, targetUserId || undefined)
      onUploaded(uploaded.user_id)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? '上传失败，请重试'
      setError(msg)
      setStage('error')
    }
  }

  return (
    <div className="flex items-center justify-center min-h-full p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-lg p-5">
        {/* Title */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-800">录入数据</h2>
            <p className="text-sm text-slate-500 mt-0.5">上传 xlsx 后系统将自动完成训练</p>
          </div>
          {onCancel && (
            <button
              onClick={onCancel}
              className="text-slate-400 hover:text-slate-600 transition-colors p-1"
              title="取消"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Drop zone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`cursor-pointer border-2 border-dashed rounded-xl p-5 text-center transition-colors mb-4
            ${dragging ? 'border-blue-400 bg-blue-50' : file ? 'border-emerald-400 bg-emerald-50' : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'}`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]) }}
          />
          {file ? (
            <div>
              <p className="text-2xl mb-2">📊</p>
              <p className="text-sm font-semibold text-emerald-700">{file.name}</p>
              <p className="text-xs text-slate-400 mt-1">{(file.size / 1024).toFixed(1)} KB · 点击重新选择</p>
            </div>
          ) : (
            <div>
              <p className="text-3xl mb-2 opacity-30">📂</p>
              <p className="text-sm font-medium text-slate-600">拖拽或点击选择 xlsx 文件</p>
              <p className="text-xs text-slate-400 mt-1">
                列格式：采集时间 / 当日用气量(m³) / 压力（MPa） / 温度(℃)
              </p>
            </div>
          )}
        </div>

        {/* Form */}
        <div className="space-y-3 mb-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">用户/区域名称</label>
            <input
              type="text"
              value={userName}
              onChange={e => setUserName(e.target.value)}
              placeholder="例如：中航锂电"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
            />
          </div>

          {users.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                或更新已有用户数据
              </label>
              <select
                value={targetUserId}
                onChange={e => {
                  setTargetUserId(e.target.value)
                  const u = users.find(u => u.id === e.target.value)
                  if (u) setUserName(u.name)
                }}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:border-blue-400"
              >
                <option value="">— 新建用户 —</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.name}（{u.rows} 条）</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {error && (
          <div className="mb-3 px-3 py-2 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100">
            {error}
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={stage === 'uploading'}
          className={`w-full py-2.5 rounded-xl font-semibold text-sm transition-all
            ${stage === 'uploading'
              ? 'bg-blue-300 text-white cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-700 text-white'}`}
        >
          {stage === 'uploading' ? (
            <>
              <svg className="inline animate-spin w-4 h-4 mr-2 -mt-0.5" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              上传中…
            </>
          ) : '上传数据'}
        </button>
      </div>
    </div>
  )
}
