import type { Metrics } from '../types'

interface Props {
  metrics: Metrics
  onStart: () => void
}

export default function TrainingSuccess({ onStart }: Props) {
  return (
    <div className="flex items-center justify-center min-h-full p-6">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg p-8 text-center">
        <div className="flex justify-center mb-5">
          <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center">
            <svg className="w-8 h-8 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        </div>

        <h2 className="text-lg font-bold text-slate-800 mb-2">训练完成</h2>
        <p className="text-sm text-slate-500 mb-8">模型已就绪，可以开始预测</p>

        <button
          onClick={onStart}
          className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm rounded-xl transition-colors flex items-center justify-center gap-2"
        >
          开始预测
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  )
}
