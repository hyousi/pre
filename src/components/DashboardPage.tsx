import { useCallback, useEffect, useState } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { fetchHistory, fetchPredictions } from '../api'
import type { DataPoint, ModelType, PredictionResult, User } from '../types'
import CommentPanel from './CommentPanel'

interface Props {
  user: User
  onImport: () => void
}

interface ChartPoint {
  date: string
  actual?: number
  predicted?: number
}

function buildChartData(
  history: DataPoint[],
  predictions: DataPoint[],
  field: 'gas' | 'pressure',
): ChartPoint[] {
  const map = new Map<string, ChartPoint>()

  history.forEach(h => map.set(h.date, { date: h.date, actual: h[field] }))

  // Overlap last history point into predictions for visual continuity
  if (history.length > 0) {
    const last = history[history.length - 1]
    map.set(last.date, { ...map.get(last.date)!, predicted: last[field] })
  }

  predictions.forEach(p => {
    const existing = map.get(p.date) ?? { date: p.date }
    map.set(p.date, { ...existing, predicted: p[field] })
  })

  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date))
}

function StatCard({ label, value, unit, color }: { label: string; value: string; unit: string; color: string }) {
  return (
    <div className={`rounded-xl p-4 border ${color}`}>
      <p className="text-xs font-medium opacity-70 mb-1">{label}</p>
      <p className="text-2xl font-bold">
        {value} <span className="text-sm font-normal opacity-60">{unit}</span>
      </p>
    </div>
  )
}

const tickFmt = (d: string) => d.slice(5)
const gasFmt = (v: number) => `${(v / 1000).toFixed(0)}k`
const presFmt = (v: number) => v.toFixed(3)

export default function DashboardPage({ user, onImport }: Props) {
  const [history, setHistory] = useState<DataPoint[]>([])
  const [predResult, setPredResult] = useState<PredictionResult | null>(null)
  const [model, setModel] = useState<ModelType>('lstm')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (m: ModelType) => {
    if (!user.has_model) return
    setLoading(true)
    setError('')
    try {
      const [hist, pred] = await Promise.all([
        fetchHistory(user.id, 30),
        fetchPredictions(user.id, m),
      ])
      setHistory(hist)
      setPredResult(pred)
    } catch {
      setError('获取数据失败，请检查后端服务是否运行')
    } finally {
      setLoading(false)
    }
  }, [user.id, user.has_model])

  useEffect(() => { load(model) }, [load, model])

  const handleModelChange = (m: ModelType) => {
    setModel(m)
    load(m)
  }

  const gasData = predResult ? buildChartData(history, predResult.predictions, 'gas') : []
  const presData = predResult ? buildChartData(history, predResult.predictions, 'pressure') : []
  const lastKnown = predResult?.last_known_date ?? ''

  const latestPred = predResult?.predictions.slice(-1)[0]
  const latestHist = history.at(-1)

  return (
    <div className="space-y-5">
      {/* Top row: stats + controls */}
      <div className="flex flex-wrap items-start gap-4">
        {/* User info card */}
        <div className="flex-1 min-w-[220px] bg-white rounded-2xl shadow p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold text-slate-800">{user.name}</h2>
              <p className="text-xs text-slate-400">{user.rows} 条历史数据</p>
            </div>
            <button
              onClick={onImport}
              className="text-xs px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg transition-colors"
            >
              重新导入
            </button>
          </div>

          {/* Model toggle */}
          <div className="flex rounded-lg overflow-hidden border border-gray-200 mb-4">
            {(['lstm', 'prophet'] as ModelType[]).map(m => (
              <button
                key={m}
                onClick={() => handleModelChange(m)}
                className={`flex-1 py-1.5 text-xs font-semibold transition-colors
                  ${model === m ? 'bg-blue-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
              >
                {m === 'lstm' ? 'LSTM（主）' : 'Prophet'}
              </button>
            ))}
          </div>

          {!user.has_model ? (
            <div className="text-center py-6 text-slate-400">
              <p className="text-sm">尚未训练模型</p>
              <button onClick={onImport} className="mt-2 text-xs text-blue-600 hover:underline">前往导入并训练 →</button>
            </div>
          ) : user.metrics ? (
            <div className="space-y-1 text-xs">
              <div className="flex justify-between text-slate-500">
                <span>用气量 MAPE</span>
                <span className="font-mono">{user.metrics.lstm.test_mape_gas.toFixed(2)}%</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>压力 MAPE</span>
                <span className="font-mono">{user.metrics.lstm.test_mape_pressure.toFixed(2)}%</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>训练集 / 测试集</span>
                <span className="font-mono">{user.metrics.n_train} / {user.metrics.n_test}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>8% 要求</span>
                <span>{user.metrics.passes_8pct ? '✓ 达标' : '✗ 未达标'}</span>
              </div>
            </div>
          ) : null}
        </div>

        {/* Prediction stat cards */}
        {latestPred && (
          <div className="flex flex-wrap gap-3 flex-1">
            <StatCard
              label="14 天后预测用气量"
              value={latestPred.gas.toLocaleString()}
              unit="m³"
              color="bg-blue-50 border-blue-100 text-blue-800"
            />
            <StatCard
              label="14 天后预测压力"
              value={latestPred.pressure.toFixed(3)}
              unit="MPa"
              color="bg-emerald-50 border-emerald-100 text-emerald-800"
            />
            {latestHist && (
              <StatCard
                label="今日实际用气量"
                value={latestHist.gas.toLocaleString()}
                unit="m³"
                color="bg-slate-50 border-slate-200 text-slate-700"
              />
            )}
          </div>
        )}
      </div>

      {/* Charts */}
      {!user.has_model ? (
        <div className="bg-white rounded-2xl shadow p-16 text-center text-slate-400">
          <p className="text-4xl mb-3 opacity-20">📈</p>
          <p className="font-medium">请先导入数据并完成训练，即可查看预测走势</p>
        </div>
      ) : loading ? (
        <div className="bg-white rounded-2xl shadow p-16 text-center">
          <svg className="animate-spin w-8 h-8 mx-auto text-blue-500" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="mt-3 text-sm text-slate-400">加载预测数据中…</p>
        </div>
      ) : error ? (
        <div className="bg-white rounded-2xl shadow p-8 text-center text-red-500">
          <p>{error}</p>
          <button onClick={() => load(model)} className="mt-3 text-sm text-blue-600 hover:underline">重试</button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Gas chart */}
          <div className="bg-white rounded-2xl shadow p-5">
            <h3 className="text-sm font-bold text-slate-700 mb-4">
              当日用气量走势
              <span className="ml-2 text-xs font-normal text-slate-400">
                历史 {history.length} 天 + 预测 14 天
              </span>
            </h3>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={gasData} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={tickFmt} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={gasFmt} width={36} />
                <Tooltip
                  formatter={(v: number, name: string) => [v.toLocaleString() + ' m³', name === 'actual' ? '实际' : '预测']}
                  labelFormatter={l => `日期：${l}`}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                />
                <Legend formatter={v => v === 'actual' ? '实际用气量' : '预测用气量'} wrapperStyle={{ fontSize: 12 }} />
                {lastKnown && (
                  <ReferenceLine x={lastKnown} stroke="#94a3b8" strokeDasharray="4 4"
                    label={{ value: '当前', position: 'insideTopRight', fontSize: 10, fill: '#94a3b8' }} />
                )}
                <Line type="monotone" dataKey="actual" stroke="#2563eb" strokeWidth={2}
                  dot={false} connectNulls={false} />
                <Line type="monotone" dataKey="predicted" stroke="#f97316" strokeWidth={2}
                  strokeDasharray="6 3" dot={false} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Pressure chart */}
          <div className="bg-white rounded-2xl shadow p-5">
            <h3 className="text-sm font-bold text-slate-700 mb-4">
              管道压力走势
              <span className="ml-2 text-xs font-normal text-slate-400">MPa</span>
            </h3>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={presData} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={tickFmt} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={presFmt} width={44} />
                <Tooltip
                  formatter={(v: number, name: string) => [v.toFixed(4) + ' MPa', name === 'actual' ? '实际' : '预测']}
                  labelFormatter={l => `日期：${l}`}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                />
                <Legend formatter={v => v === 'actual' ? '实际压力' : '预测压力'} wrapperStyle={{ fontSize: 12 }} />
                {lastKnown && (
                  <ReferenceLine x={lastKnown} stroke="#94a3b8" strokeDasharray="4 4" />
                )}
                <Line type="monotone" dataKey="actual" stroke="#10b981" strokeWidth={2}
                  dot={false} connectNulls={false} />
                <Line type="monotone" dataKey="predicted" stroke="#ec4899" strokeWidth={2}
                  strokeDasharray="6 3" dot={false} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* AI Comment */}
          {predResult && (
            <CommentPanel user={user} predictions={predResult.predictions} model={model} />
          )}
        </div>
      )}
    </div>
  )
}
