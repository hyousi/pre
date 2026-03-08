interface Props {
  onStart: () => void
}

export default function EmptyState({ onStart }: Props) {
  return (
    <div className="flex items-center justify-center h-full min-h-[400px]">
      <div className="text-center max-w-sm px-6">
        {/* Icon */}
        <div className="mx-auto w-20 h-20 rounded-full bg-blue-50 flex items-center justify-center mb-6">
          <svg className="w-10 h-10 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        </div>

        <h1 className="text-xl font-bold text-slate-800 mb-2">燃气管网预测平台</h1>
        <p className="text-slate-500 text-sm mb-8 leading-relaxed">
          还没有任何用气模型。<br />
          请先录入用户/区域的历史数据，系统将自动完成训练。
        </p>

        <button
          onClick={onStart}
          className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm rounded-xl shadow-sm transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          录入数据
        </button>

        <p className="text-xs text-slate-400 mt-4">支持导入 Excel (.xlsx) 格式的采集数据</p>
      </div>
    </div>
  )
}
