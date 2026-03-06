import { useEffect, useState } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { predictByRange } from '../api'
import type { DataPoint, PredictionResult, User } from '../types'
import CommentPanel from './CommentPanel'

interface Props {
  user: User
  onImport: () => void
}

type PredictMode = 'single' | 'range'

// Day offset helpers (YYYY-MM-DD arithmetic without timezone issues)
function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addDays(base: string, n: number): string {
  const d = new Date(base + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return dateStr(d)
}

// ── Single-day card result ─────────────────────────────────────────────────

function SingleDayResult({ point, completedAt }: { point: DataPoint; completedAt: string }) {
  const weekday = new Date(point.date + 'T00:00:00').toLocaleDateString('zh-CN', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  return (
    <div className="space-y-4">
      {/* Date header */}
      <div className="flex items-center gap-2">
        <div className="w-1 h-5 bg-blue-500 rounded-full" />
        <span className="text-sm font-semibold text-slate-700">{weekday}</span>
        <span className="ml-auto text-[10px] bg-blue-50 text-blue-600 border border-blue-100 px-2 py-0.5 rounded-full font-medium">
          已完成 {completedAt}
        </span>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-2 gap-4">
        {/* Gas card */}
        <div className="relative overflow-hidden bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl p-5 text-white shadow-md shadow-blue-200">
          <div className="absolute -top-4 -right-4 w-20 h-20 bg-white/10 rounded-full" />
          <div className="absolute -bottom-6 -right-2 w-28 h-28 bg-white/5 rounded-full" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 bg-white/20 rounded-lg flex items-center justify-center">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9.879 16.121A3 3 0 1012.015 11L11 14H9c0 .768.293 1.536.879 2.121z" />
                </svg>
              </div>
              <span className="text-xs font-medium text-blue-100">当日用气量</span>
            </div>
            <div className="text-3xl font-bold tracking-tight">
              {point.gas.toFixed(1)}
            </div>
            <div className="text-sm font-medium text-blue-100 mt-0.5">m³</div>
          </div>
        </div>

        {/* Pressure card */}
        <div className="relative overflow-hidden bg-gradient-to-br from-amber-400 to-orange-500 rounded-2xl p-5 text-white shadow-md shadow-amber-200">
          <div className="absolute -top-4 -right-4 w-20 h-20 bg-white/10 rounded-full" />
          <div className="absolute -bottom-6 -right-2 w-28 h-28 bg-white/5 rounded-full" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 bg-white/20 rounded-lg flex items-center justify-center">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <span className="text-xs font-medium text-amber-100">管道压力</span>
            </div>
            <div className="text-3xl font-bold tracking-tight">
              {point.pressure.toFixed(3)}
            </div>
            <div className="text-sm font-medium text-amber-100 mt-0.5">MPa</div>
          </div>
        </div>
      </div>

      {/* Footnote */}
      <p className="text-[11px] text-slate-400 text-center">
        以上数值为 Prophet 时序模型预测结果，仅供参考
      </p>
    </div>
  )
}

// ── Multi-day chart helpers ────────────────────────────────────────────────

interface ChartPoint {
  date: string
  gas?: number
  pressure?: number
}

function buildChartData(predictions: DataPoint[]): { gas: ChartPoint[]; pressure: ChartPoint[] } {
  const gas = predictions.map(p => ({ date: p.date, gas: p.gas }))
  const pressure = predictions.map(p => ({ date: p.date, pressure: p.pressure }))
  return { gas, pressure }
}

function MiniChart({
  data,
  field,
  color,
  unit,
}: {
  data: ChartPoint[]
  field: string
  color: string
  unit: string
}) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: '#94a3b8' }}
          tickFormatter={v => v.slice(5)}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 10, fill: '#94a3b8' }}
          tickFormatter={v => String(Number(v).toFixed(field === 'pressure' ? 3 : 0))}
          width={52}
        />
        <Tooltip
          formatter={(v: number) => [`${v.toFixed(field === 'pressure' ? 4 : 1)} ${unit}`, field === 'pressure' ? '压力' : '用气量']}
          labelFormatter={l => `日期：${l}`}
        />
        <Legend formatter={() => field === 'pressure' ? `压力 (${unit})` : `用气量 (${unit})`} />
        <Line
          type="monotone"
          dataKey={field}
          stroke={color}
          strokeWidth={2}
          dot={{ r: 3 }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

export default function PredictPage({ user, onImport }: Props) {
  const [mode, setMode] = useState<PredictMode>('range')
  const [singleDate, setSingleDate] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<PredictionResult | null>(null)
  const [completedAt, setCompletedAt] = useState('')

  // The authoritative last-known date: prefer server-confirmed (from a predict result),
  // fall back to what the users list already tells us.
  const lastKnown: string =
    result?.last_known_date ??
    user.last_date ??
    dateStr(new Date())

  const minDate = addDays(lastKnown, 1)
  // Prophet supports up to 365 days ahead
  const maxDate = addDays(lastKnown, 365)

  // Reset date inputs whenever the user changes
  useEffect(() => {
    setSingleDate('')
    setStartDate('')
    setEndDate('')
    setResult(null)
    setError('')
    setCompletedAt('')
  }, [user.id, lastKnown])

  const handlePredict = async () => {
    setError('')
    setResult(null)

    const start = mode === 'single' ? singleDate : startDate
    const end = mode === 'single' ? singleDate : endDate

    if (!start) return setError('请选择预测日期')
    if (mode === 'range' && !end) return setError('请选择结束日期')
    if (mode === 'range' && end < start) return setError('结束日期不能早于开始日期')

    setLoading(true)
    try {
      const res = await predictByRange(user.id, start, end)
      setResult(res)
      setCompletedAt(new Date().toLocaleTimeString('zh-CN', { hour12: false }))
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail ?? '预测失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  const chartData = result ? buildChartData(result.predictions) : null

  return (
    <div className="p-5 space-y-5 max-w-4xl mx-auto">
      {/* User info bar */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-800">{user.name}</h2>
          <p className="text-xs text-slate-500">
            历史数据 {user.rows} 条
            {result ? ` · 最后一条：${result.last_known_date}` : ''}
          </p>
        </div>
        <button
          onClick={onImport}
          className="text-xs text-blue-600 hover:text-blue-700 border border-blue-200 hover:border-blue-400 px-3 py-1.5 rounded-lg transition-colors"
        >
          + 更新数据
        </button>
      </div>

      {/* Prediction form */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">预测设置</h3>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Mode selector */}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">预测类型</label>
            <div className="flex rounded-lg border border-slate-200 overflow-hidden">
              {(['single', 'range'] as PredictMode[]).map(m => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`flex-1 py-2 text-xs font-medium transition-colors
                    ${mode === m ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                >
                  {m === 'single' ? '单日' : '区间'}
                </button>
              ))}
            </div>
          </div>

          {/* Date inputs */}
          {mode === 'single' ? (
            <div className="sm:col-span-1">
              <label className="block text-xs font-medium text-slate-500 mb-1.5">预测日期</label>
              <input
                type="date"
                value={singleDate}
                min={minDate}
                max={maxDate}
                onChange={e => setSingleDate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
              />
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">开始日期</label>
                <input
                  type="date"
                  value={startDate}
                  min={minDate}
                  max={maxDate}
                  onChange={e => setStartDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">结束日期</label>
                <input
                  type="date"
                  value={endDate}
                  min={startDate || minDate}
                  max={maxDate}
                  onChange={e => setEndDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                />
              </div>
            </>
          )}
        </div>

        {/* Submit */}
        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={handlePredict}
            disabled={loading}
            className={`px-5 py-2 rounded-lg text-sm font-semibold transition-colors
              ${loading ? 'bg-blue-300 text-white cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}
          >
            {loading ? (
              <>
                <svg className="inline animate-spin w-4 h-4 mr-1.5 -mt-0.5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                预测中…
              </>
            ) : '开始预测'}
          </button>

          {result && (
            <span className="text-xs text-slate-400">
              {result.predictions.length} 天预测结果 · Prophet 模型
            </span>
          )}
        </div>

        {error && (
          <div className="mt-3 px-3 py-2 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100">
            {error}
          </div>
        )}
      </div>

      {/* Results */}
      {result && (
        <>
          {/* Single-day: card UI */}
          {mode === 'single' && result.predictions.length === 1 ? (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
              <SingleDayResult point={result.predictions[0]} completedAt={completedAt} />
            </div>
          ) : (
            /* Multi-day: charts + table */
            chartData && (
              <>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                  <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
                    <h4 className="text-sm font-semibold text-slate-700 mb-3">用气量预测（m³）</h4>
                    <MiniChart data={chartData.gas} field="gas" color="#3b82f6" unit="m³" />
                  </div>
                  <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
                    <h4 className="text-sm font-semibold text-slate-700 mb-3">压力预测（MPa）</h4>
                    <MiniChart data={chartData.pressure} field="pressure" color="#f59e0b" unit="MPa" />
                  </div>
                </div>

                <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
                  <h4 className="text-sm font-semibold text-slate-700 mb-3">预测数据明细</h4>
                  <div className="overflow-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-100">
                          <th className="text-left py-2 text-xs font-semibold text-slate-500">日期</th>
                          <th className="text-right py-2 text-xs font-semibold text-blue-600">用气量 (m³)</th>
                          <th className="text-right py-2 text-xs font-semibold text-amber-600">压力 (MPa)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {result.predictions.map(p => (
                          <tr key={p.date} className="hover:bg-slate-50 transition-colors">
                            <td className="py-2 font-mono text-xs text-slate-600">{p.date}</td>
                            <td className="py-2 text-right font-mono text-xs text-blue-700">{p.gas.toFixed(1)}</td>
                            <td className="py-2 text-right font-mono text-xs text-amber-600">{p.pressure.toFixed(4)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )
          )}

          {/* AI Comment Panel — shown for both modes */}
          <CommentPanel
            user={user}
            predictions={result.predictions}
          />
        </>
      )}
    </div>
  )
}
