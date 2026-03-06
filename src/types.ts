export interface ModelMetrics {
  test_mape_gas: number
  test_mape_pressure: number
  test_max_ape_gas: number
  test_max_ape_pressure: number
  passes_8pct: boolean
  train_loss?: number
  epochs_trained?: number
}

export interface CombinedMetrics {
  n_train: number
  n_test: number
  lstm: ModelMetrics
  prophet: ModelMetrics
  test_mape_gas: number
  test_mape_pressure: number
  test_max_ape_gas: number
  test_max_ape_pressure: number
  passes_8pct: boolean
}

export interface User {
  id: string
  name: string
  rows: number
  is_default: boolean
  has_model: boolean
  metrics: CombinedMetrics | null
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

export type ModelType = 'lstm' | 'prophet'
