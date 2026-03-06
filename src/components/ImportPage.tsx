import { useCallback, useRef, useState } from 'react'
import { trainModel, uploadData } from '../api'
import type { CombinedMetrics, User } from '../types'

interface Props {
  users: User[]
  onDone: (userId: string) => void
}

type Stage = 'idle' | 'uploading' | 'training' | 'done' | 'error'

function MetricsTable({ metrics }: { metrics: CombinedMetrics }) {
  const pct = (v: number) => `${v.toFixed(2)}%`
  const check = (v: boolean) => v
    ? <span className="text-emerald-600 font-bold">✓</span>
    : <span className="text-red-500">✗</span>

  return (
    <div className="mt-4 bg-slate-50 rounded-xl p-4 border border-slate-200">
      <h4 className="text-sm font-bold text-slate-700 mb-3">训练完成 · 评估指标</h4>
      <p className="text-xs text-slate-500 mb-3">
        训练集 {metrics.n_train} 条 / 测试集 {metrics.n_test} 条（时间分割 80/20）
      </p>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-200">
            <th className="text-left py-1.5 text-slate-500 font-medium">指标</th>
            <th className="text-right py-1.5 text-blue-600 font-medium">LSTM</th>
            <th className="text-right py-1.5 text-amber-600 font-medium">Prophet</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          <tr>
            <td className="py-1.5 text-slate-600">用气量 MAPE</td>
            <td className="text-right py-1.5 font-mono">{pct(metrics.lstm.test_mape_gas)}</td>
            <td className="text-right py-1.5 font-mono">{pct(metrics.prophet.test_mape_gas)}</td>
          </tr>
          <tr>
            <td className="py-1.5 text-slate-600">压力 MAPE</td>
            <td className="text-right py-1.5 font-mono">{pct(metrics.lstm.test_mape_pressure)}</td>
            <td className="text-right py-1.5 font-mono">{pct(metrics.prophet.test_mape_pressure)}</td>
          </tr>
          <tr>
            <td className="py-1.5 text-slate-600">用气量最大 APE</td>
            <td className="text-right py-1.5 font-mono">{pct(metrics.lstm.test_max_ape_gas)}</td>
            <td className="text-right py-1.5 font-mono">{pct(metrics.prophet.test_max_ape_gas)}</td>
          </tr>
          <tr>
            <td className="py-1.5 text-slate-600">压力最大 APE</td>
            <td className="text-right py-1.5 font-mono">{pct(metrics.lstm.test_max_ape_pressure)}</td>
            <td className="text-right py-1.5 font-mono">{pct(metrics.prophet.test_max_ape_pressure)}</td>
          </tr>
          <tr>
            <td className="py-1.5 text-slate-600">达到 8% 要求</td>
            <td className="text-right py-1.5">{check(metrics.lstm.passes_8pct)}</td>
            <td className="text-right py-1.5">{check(metrics.prophet.passes_8pct)}</td>
          </tr>
        </tbody>
      </table>
      {!metrics.passes_8pct && (
        <p className="mt-3 text-xs text-amber-600 bg-amber-50 rounded-lg p-2.5">
          提示：误差超过 8% 通常是训练数据不足（建议 ≥ 6 个月），导入更多历史数据后重新训练可改善精度。
        </p>
      )}
    </div>
  )
}

export default function ImportPage({ users, onDone }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [userName, setUserName] = useState('')
  const [targetUserId, setTargetUserId] = useState('')
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState('')
  const [metrics, setMetrics] = useState<CombinedMetrics | null>(null)
  const [doneUserId, setDoneUserId] = useState('')
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
    setMetrics(null)

    try {
      setStage('uploading')
      const uploaded = await uploadData(file, name, targetUserId || undefined)

      setStage('training')
      const result = await trainModel(uploaded.user_id)
      setMetrics(result.metrics)
      setDoneUserId(uploaded.user_id)
      setStage('done')
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? '操作失败，请重试'
      setError(msg)
      setStage('error')
    }
  }

  const stageLabel: Record<Stage, string> = {
    idle: '上传并训练',
    uploading: '上传中…',
    training: '训练中（约 30 秒）…',
    done: '✓ 训练完成',
    error: '重试',
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-white rounded-2xl shadow-lg p-8">
        <h2 className="text-xl font-bold text-slate-800 mb-1">导入数据</h2>
        <p className="text-sm text-slate-500 mb-6">
          上传 xlsx 文件后系统将自动完成 LSTM + Prophet 双模型训练
        </p>

        {/* Drop zone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`cursor-pointer border-2 border-dashed rounded-xl p-8 text-center transition-colors mb-6
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
              <p className="text-xs text-slate-400 mt-1">列格式：采集时间 / 当日用气量(m³) / 压力（MPa） / 温度(℃)</p>
            </div>
          )}
        </div>

        {/* Form */}
        <div className="space-y-4 mb-6">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">用户名称</label>
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
          <div className="mb-4 px-3 py-2.5 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100">
            {error}
          </div>
        )}

        <button
          onClick={stage === 'done' ? () => onDone(doneUserId) : handleSubmit}
          disabled={stage === 'uploading' || stage === 'training'}
          className={`w-full py-2.5 rounded-xl font-semibold text-sm transition-all
            ${stage === 'done'
              ? 'bg-emerald-500 hover:bg-emerald-600 text-white'
              : stage === 'uploading' || stage === 'training'
                ? 'bg-blue-300 text-white cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700 text-white'}`}
        >
          {(stage === 'uploading' || stage === 'training') && (
            <svg className="inline animate-spin w-4 h-4 mr-2 -mt-0.5" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
          {stage === 'done' ? '→ 查看预测' : stageLabel[stage]}
        </button>

        {/* Training progress hint */}
        {stage === 'training' && (
          <div className="mt-3 space-y-1">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
              正在训练 LSTM 模型…
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              正在训练 Prophet 模型…
            </div>
          </div>
        )}

        {stage === 'done' && metrics && <MetricsTable metrics={metrics} />}
      </div>
    </div>
  )
}
