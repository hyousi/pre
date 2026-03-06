import { useState } from 'react'
import type { DataPoint, User } from '../types'

interface Props {
  user: User
  predictions: DataPoint[]
  model?: string   // optional, for display only
}

const API_KEY_STORAGE = 'gas_llm_api_key'
const API_URL_STORAGE = 'gas_llm_api_url'

function buildPrompt(user: User, predictions: DataPoint[]): string {
  const first = predictions[0]
  const last = predictions[predictions.length - 1]
  const avgGas = predictions.reduce((s, p) => s + p.gas, 0) / predictions.length
  const maxGas = Math.max(...predictions.map(p => p.gas))
  const minGas = Math.min(...predictions.map(p => p.gas))
  const avgPres = predictions.reduce((s, p) => s + p.pressure, 0) / predictions.length

  return `你是一位城市燃气管网运营专家，请根据以下 AI 预测数据，用简洁专业的中文写一段 2-3 句话的分析点评（不超过 150 字），重点关注供气安全和调度建议。

用户：${user.name}
预测模型：Prophet
预测时段：${first.date} 至 ${last.date}
用气量摘要：平均 ${Math.round(avgGas).toLocaleString()} m³，峰值 ${Math.round(maxGas).toLocaleString()} m³，谷值 ${Math.round(minGas).toLocaleString()} m³
压力摘要：平均 ${avgPres.toFixed(3)} MPa

请直接输出点评文字，无需标题或前缀。`
}

export default function CommentPanel({ user, predictions }: Props) {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(API_KEY_STORAGE) ?? '')
  const [apiUrl, setApiUrl] = useState(() => localStorage.getItem(API_URL_STORAGE) ?? 'https://api.openai.com/v1')
  const [comment, setComment] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showSettings, setShowSettings] = useState(false)

  const saveSettings = () => {
    localStorage.setItem(API_KEY_STORAGE, apiKey)
    localStorage.setItem(API_URL_STORAGE, apiUrl)
    setShowSettings(false)
  }

  const generate = async () => {
    if (!apiKey) { setShowSettings(true); return }
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${apiUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: buildPrompt(user, predictions) }],
          max_tokens: 200,
          temperature: 0.7,
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setComment(data.choices[0].message.content.trim())
    } catch (e: unknown) {
      setError((e as Error).message ?? '请求失败，请检查 API Key 和网络')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-slate-700">
          AI 点评
          <span className="ml-1.5 text-xs font-normal text-slate-400">（可选 · 需联网）</span>
        </h3>
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="text-xs text-slate-400 hover:text-slate-600 px-2 py-1 rounded-lg hover:bg-slate-50"
        >
          ⚙ 设置 API Key
        </button>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="mb-4 p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">API Base URL</label>
            <input
              type="text"
              value={apiUrl}
              onChange={e => setApiUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
              className="w-full px-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="sk-..."
              className="w-full px-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400"
            />
          </div>
          <p className="text-xs text-slate-400">支持 OpenAI 兼容接口（OpenAI / DeepSeek / 讯飞等）。Key 仅存储在本地。</p>
          <button onClick={saveSettings} className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700">保存</button>
        </div>
      )}

      {/* Comment output */}
      {comment && (
        <div className="mb-3 p-3.5 bg-blue-50 border border-blue-100 rounded-xl text-sm text-slate-700 leading-relaxed">
          {comment}
        </div>
      )}

      {error && (
        <div className="mb-3 text-xs text-red-500 bg-red-50 p-2.5 rounded-lg">{error}</div>
      )}

      <button
        onClick={generate}
        disabled={loading}
        className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-xs font-semibold rounded-xl hover:opacity-90 disabled:opacity-50 transition-all"
      >
        {loading ? (
          <>
            <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            生成中…
          </>
        ) : (
          <>{comment ? '重新生成' : '✨ 生成 AI 点评'}</>
        )}
      </button>
    </div>
  )
}
