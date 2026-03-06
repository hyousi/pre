import axios from 'axios'
import type { CombinedMetrics, DataPoint, ModelType, PredictionResult, User } from './types'

const BASE: string = import.meta.env.VITE_API_BASE ?? 'http://localhost:8765'

const http = axios.create({ baseURL: BASE })

export async function checkHealth(): Promise<boolean> {
  try {
    await http.get('/health', { timeout: 2000 })
    return true
  } catch {
    return false
  }
}

export async function fetchUsers(): Promise<User[]> {
  const res = await http.get<{ users: User[] }>('/api/users')
  return res.data.users
}

export async function uploadData(
  file: File,
  userName: string,
  userId?: string,
): Promise<{ user_id: string; rows: number }> {
  const form = new FormData()
  form.append('file', file)
  form.append('user_name', userName)
  if (userId) form.append('user_id', userId)
  const res = await http.post('/api/upload', form)
  return res.data
}

export async function trainModel(userId: string): Promise<{ user_id: string; metrics: CombinedMetrics }> {
  const res = await http.post('/api/train', { user_id: userId })
  return res.data
}

export async function fetchPredictions(
  userId: string,
  model: ModelType = 'lstm',
): Promise<PredictionResult> {
  const res = await http.get<PredictionResult>(`/api/predict/${userId}`, {
    params: { model },
  })
  return res.data
}

export async function fetchHistory(
  userId: string,
  days = 30,
): Promise<DataPoint[]> {
  const res = await http.get<{ history: DataPoint[] }>(`/api/history/${userId}`, {
    params: { days },
  })
  return res.data.history
}

export async function deleteUser(userId: string): Promise<void> {
  await http.delete(`/api/users/${userId}`)
}
