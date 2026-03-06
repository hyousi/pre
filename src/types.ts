export interface Metrics {
  n_train: number
  n_test: number
  test_mape_gas: number
  test_mape_pressure: number
  test_max_ape_gas: number
  test_max_ape_pressure: number
  passes_8pct: boolean
}

// Legacy alias kept so older references compile
export type CombinedMetrics = Metrics

export interface User {
  id: string
  name: string
  rows: number
  is_default: boolean
  has_model: boolean
  last_date: string | null
  metrics: Metrics | null
}

export interface DataPoint {
  date: string
  gas: number
  pressure: number
}

export interface PredictionResult {
  user_id: string
  model_used: string
  last_known_date: string
  predictions: DataPoint[]
}

export type ModelType = 'prophet'
