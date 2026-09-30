import { readdir, readFile, realpath } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { TextLoader } from '@langchain/classic/document_loaders/fs/text'
import { MultiFileLoader } from '@langchain/classic/document_loaders/fs/multi_file'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { MODEL, DIMENSIONS } from '../src/guided/corpus.ts'
import { DEFAULT_SPLIT, type DocumentMetadata, type BaseDocument, type Chunk, type ChunkRecord, type ChunkOffset, type PreparedBase, type SplitConfig } from '../src/guided/base/preparation.ts'

export const DEFAULT_CONFIG = DEFAULT_SPLIT
export const SEPARATORS = ['\n\n', '\n', ' ', '']
export function validateConfig(value: SplitConfig): SplitConfig {
  if (!value || !Number.isInteger(value.chunkSize) || value.chunkSize < 100 || value.chunkSize > 450 || !Number.isInteger(value.chunkOverlap) || value.chunkOverlap < 0 || value.chunkOverlap >= value.chunkSize) throw new Error('Use tamanho de 100 a 450 caracteres e sobreposição menor que o tamanho.')
  return { chunkSize: value.chunkSize, chunkOverlap: value.chunkOverlap }
}
export const normalizeText = (text: string) => text.replace(/^\uFEFF/, '').normalize('NFC').replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim()
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const fields = ['id','file','title','category','institution','source','url','section','accessedAt','adaptation','sourceSnapshotSha256'] as const

/** The catalogue is curated provenance, not a semantic classification guessed by the loader. */
export function parseCatalog(raw: string): DocumentMetadata[] {
  const catalog = JSON.parse(raw)
  if (catalog.version !== 1 || !Array.isArray(catalog.documents) || catalog.documents.length !== 10) throw new Error('O catálogo deve declarar exatamente dez documentos e versão 1.')
  const documents: DocumentMetadata[] = catalog.documents.map((entry: Record<string, unknown>) => {
    if (!entry || fields.some(key => typeof entry[key] !== 'string' || !(entry[key] as string).trim())) throw new Error('Metadados obrigatórios ausentes no catálogo.')
    if (!/^D(?:[1-9]|10)$/.test(entry.id as string) || !/^[a-z0-9-]+\.md$/.test(entry.file as string)) throw new Error('ID ou nome de arquivo inválido no catálogo.')
    if (!(entry.category as string).trim()) throw new Error('Categoria inválida.')
    if (new URL(entry.url as string).protocol !== 'https:') throw new Error('Referências devem usar HTTPS.')
    if (entry.licenseUrl !== undefined && (typeof entry.licenseUrl !== 'string' || new URL(entry.licenseUrl).protocol !== 'https:')) throw new Error('Referência de licença deve usar HTTPS.')
    const date = entry.accessedAt as string
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date) throw new Error('Data de acesso inválida.')
    if (!/^[a-f0-9]{64}$/.test(entry.sourceSnapshotSha256 as string)) throw new Error('Assinatura da fonte inválida.')
    return Object.fromEntries(fields.map(key => [key, entry[key]])) as DocumentMetadata
  })
  if (new Set(documents.map(d => d.id)).size !== 10 || new Set(documents.map(d => d.file)).size !== 10) throw new Error('IDs ou arquivos repetidos no catálogo.')
  return documents.sort((a,b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))
}

export async function readDocuments(root: string): Promise<BaseDocument[]> {
  const dir = await realpath(resolve(root, 'data/base'))
  const catalog = parseCatalog(await readFile(resolve(dir, 'catalogo.json'), 'utf8'))
  const files = (await readdir(dir)).filter(name => name.endsWith('.md'))
  if (files.length !== catalog.length || files.some(name => !catalog.some(d => d.file === name))) throw new Error('Arquivos Markdown e catálogo não correspondem.')
  const paths = await Promise.all(catalog.map(async entry => {
    const path = await realpath(resolve(dir,entry.file))
    if (dirname(path) !== dir) throw new Error('Documento fora do diretório da Base.')
    return path
  }))
  const loader = new MultiFileLoader(paths, { '.md': (path: string) => new TextLoader(path) })
  const loaded = await loader.load()
  if (loaded.length !== catalog.length) throw new Error('O loader não retornou todos os documentos.')
  return catalog.map((metadata,index) => {
    const document = loaded.find(d => resolve(d.metadata.source) === paths[index])
    if (!document) throw new Error(`${metadata.id}: arquivo não retornado pelo loader.`)
    const originalText = document.pageContent
    const text = normalizeText(originalText)
    if (text.length < 500 || /^#\s/m.test(text)) throw new Error(`${metadata.id}: conteúdo curto ou título dentro do corpo. Guarde o título no catálogo.`)
    return {...metadata, text, originalText, origin:`data/base/${metadata.file}`, sha256:hash(originalText), characters:text.length}
  })
}

/** Locate splitter results, never choose cuts here. Reject a mapping that loses non-whitespace. */
export function computeChunkOffsets(documentText: string, chunks: Pick<Chunk,'id'|'text'>[]): Record<string, ChunkOffset> {
  const offsets: Record<string, ChunkOffset> = {}
  let previousStart = -1
  let previousEnd = 0
  for (const chunk of chunks) {
    const startChar = documentText.indexOf(chunk.text, previousStart + 1)
    const endChar = startChar + chunk.text.length
    if (startChar < 0 || endChar <= previousEnd || (startChar > previousEnd && documentText.slice(previousEnd,startChar).trim())) throw new Error(`${chunk.id}: mapeamento dos chunks perdeu a ordem ou conteúdo.`)
    offsets[chunk.id] = {startChar,endChar,...(previousEnd > startChar ? {overlapStart:startChar,overlapEnd:previousEnd} : {})}
    previousStart = startChar
    previousEnd = endChar
  }
  if (documentText.slice(previousEnd).trim()) throw new Error('O splitter deixou conteúdo sem mapeamento.')
  return offsets
}

export async function prepareDocuments(root: string, input: SplitConfig = DEFAULT_CONFIG): Promise<PreparedBase> {
  const config = validateConfig(input)
  const documents = await readDocuments(root)
  const splitter = new RecursiveCharacterTextSplitter({...config, separators:SEPARATORS, keepSeparator:true})
  const chunks: Chunk[] = []
  const offsets: Record<string, ChunkOffset> = {}
  for (const document of documents) {
    const pieces = await splitter.splitText(document.text)
    const {originalText: _originalText, ...metadata} = document
    const mapped = pieces.map((text,index) => ({...metadata,id:`${document.id}-C${index+1}`,documentId:document.id,chunkIndex:index+1,text,characters:text.length,startChar:0,endChar:0}))
    const positions = computeChunkOffsets(document.text,mapped)
    chunks.push(...mapped.map(chunk => ({...chunk,startChar:positions[chunk.id].startChar,endChar:positions[chunk.id].endChar})))
    Object.assign(offsets,positions)
  }
  const fingerprint = hash(JSON.stringify({documents:documents.map(({originalText: _originalText,text: _text,...metadata}) => metadata),config,MODEL,DIMENSIONS,separators:SEPARATORS,splitter:'langchain-1.0.1-recursive-v2',dtype:'q8',pooling:'mean',normalization:'L2'})).slice(0,24)
  return {documents,chunks,config,collection:`seminario_base_${fingerprint}`,offsets}
}

export function validateRecords(value: unknown, prepared: PreparedBase): asserts value is ChunkRecord[] {
  if (!Array.isArray(value) || value.length !== prepared.chunks.length || new Set(value.map(r=>r?.id)).size !== value.length) throw new Error('A quantidade ou os IDs dos embeddings não correspondem aos chunks reais.')
  const byId = new Map(value.map(r=>[r.id,r]))
  for (const chunk of prepared.chunks) {
    const r = byId.get(chunk.id)
    if (!r || Object.entries(chunk).some(([key,v]) => r[key] !== v)) throw new Error(`${chunk.id}: texto ou metadados diferentes dos arquivos lidos.`)
    if (r.model !== MODEL || r.dimensions !== DIMENSIONS || !Array.isArray(r.embedding) || r.embedding.length !== DIMENSIONS || r.embedding.some((n:unknown)=>typeof n !== 'number'||!Number.isFinite(n)) || Math.abs(Math.hypot(...r.embedding)-1)>1e-4) throw new Error(`${chunk.id}: embedding inválido.`)
    if (!Number.isInteger(r.tokenCount)||r.tokenCount<1||r.tokenCount>128||!Number.isFinite(r.elapsedMs)||r.elapsedMs<0) throw new Error(`${chunk.id}: dados da inferência inválidos.`)
  }
}
