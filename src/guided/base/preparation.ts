import type { BaseRecord } from './types.ts'
export type DocumentMetadata = { id: string; file: string; title: string; category: string; institution: string; source: string; url: string; section: string; accessedAt: string; license?: string; licenseUrl?: string; adaptation: string; sourceSnapshotSha256: string }
export type BaseDocument = DocumentMetadata & { text: string; origin: string; sha256: string; characters: number; originalText: string }
export type Chunk = Omit<BaseDocument, 'originalText'> & { documentId: string; chunkIndex: number; startChar: number; endChar: number }
export type ChunkRecord = Chunk & BaseRecord
export type SplitConfig = { chunkSize: number; chunkOverlap: number }
export const DEFAULT_SPLIT: SplitConfig = { chunkSize: 350, chunkOverlap: 60 }
export type ChunkOffset = { startChar: number; endChar: number; overlapStart?: number; overlapEnd?: number }
export type PreparedBase = { documents: BaseDocument[]; chunks: Chunk[]; config: SplitConfig; collection: string; offsets: Record<string, ChunkOffset> }
export type IndexedBase = PreparedBase & { records: ChunkRecord[]; ready: boolean; indexedCount: number }
export type PreparationMessage =
  | { type: 'loading' }
  | { type: 'processing'; id: string }
  | { type: 'document'; record: ChunkRecord }
  | { type: 'complete'; records: ChunkRecord[] }
  | { type: 'error'; message: string }
