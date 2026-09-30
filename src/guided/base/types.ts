export type BaseRecord = {
  id: string
  title: string
  text: string
  source: string
  url: string
  section: string
  category: string
  institution: string
  embedding: number[]
  dimensions: number
  model: string
  tokenCount: number
  elapsedMs: number
  updatedAt?: string
}
export type SavedBase = { records: BaseRecord[]; ready: boolean; storage: string }
export type BaseWorkerMessage =
  | { type: 'loading' }
  | { type: 'processing'; id: string }
  | { type: 'document'; record: BaseRecord }
  | { type: 'complete'; records: BaseRecord[] }
  | { type: 'error'; message: string }
