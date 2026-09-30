import { DIMENSIONS } from '../src/guided/corpus.ts'
import { validateRecords } from './base-ingestion.ts'
import type { ChunkRecord, IndexedBase, PreparedBase } from '../src/guided/base/preparation.ts'

type Point = { id: number; vector: number[]; payload: Omit<ChunkRecord,'embedding'> }
export function qdrantBase(url: string, apiKey: string) {
  const base = url.replace(/\/+$/, '')
  async function request(path: string, method = 'GET', body?: unknown, allowMissing = false) {
    if (!base) throw new Error('Qdrant não configurado. Defina QDRANT_URL no ambiente e reinicie o servidor.')
    const response = await fetch(`${base}${path}`, {method,headers:{'Content-Type':'application/json',...(apiKey?{'api-key':apiKey}:{})},signal:AbortSignal.timeout(30000),...(body?{body:JSON.stringify(body)}:{})})
    if (allowMissing && response.status===404) return null
    if (!response.ok) throw new Error(`Qdrant respondeu HTTP ${response.status}. A indexação não foi confirmada.`)
    const data = await response.json() as { result: any }
    return data.result
  }
  function validateCollection(info: {config?:{params?:{vectors?:{size?:number;distance?:string}}}}) {
    const vectors = info?.config?.params?.vectors
    if (vectors?.size!==DIMENSIONS||vectors.distance!=='Cosine') throw new Error('A coleção da Base não possui configuração 384D / Cosine.')
  }
  async function read(prepared: PreparedBase): Promise<IndexedBase> {
    const path = `/collections/${prepared.collection}`
    const info = await request(path,'GET',undefined,true)
    if (!info) return {...prepared,records:[],indexedCount:0,ready:false}
    validateCollection(info)
    const points: Point[] = []
    let offset: number | string | null = null
    do {
      const result = await request(`${path}/points/scroll`,'POST',{limit:256,with_payload:true,with_vector:true,...(offset!==null?{offset}:{})})
      points.push(...result.points)
      offset = result.next_page_offset
      if (points.length>prepared.chunks.length) throw new Error('A coleção contém registros inesperados.')
    } while (offset!==null && offset!==undefined)
    const ids = new Map(prepared.chunks.map((chunk,index)=>[chunk.id,index+1]))
    if (points.some(point=>point.id!==ids.get(point.payload.id))) throw new Error('IDs nativos do Qdrant não correspondem aos chunks.')
    const records = points.map(p=>({...p.payload,embedding:p.vector})) as ChunkRecord[]
    if (!records.length) return {...prepared,records:[],indexedCount:0,ready:false}
    if (records.length !== prepared.chunks.length) return {...prepared,records:[],indexedCount:0,ready:false}
    validateRecords(records,prepared)
    records.sort((a,b)=>Number(a.documentId.slice(1))-Number(b.documentId.slice(1))||a.chunkIndex-b.chunkIndex)
    return {...prepared,records,indexedCount:records.length,ready:true}
  }
  async function save(prepared: PreparedBase, records: ChunkRecord[]): Promise<IndexedBase> {
    validateRecords(records,prepared)
    const path = `/collections/${prepared.collection}`
    let info = await request(path,'GET',undefined,true)
    if (!info) {
      await request(path,'PUT',{vectors:{size:DIMENSIONS,distance:'Cosine'}})
      info = await request(path)
    }
    validateCollection(info)
    // Versioned collections preserve previous preparations and the extra pathway.
    const ordered = prepared.chunks.map(c=>records.find(r=>r.id===c.id)!)
    const points = ordered.map((r,index)=>{const {embedding,...payload}=r;return {id:index+1,vector:embedding,payload}})
    const operation = await request(`${path}/points?wait=true`,'PUT',{points})
    if (operation?.status !== 'completed') throw new Error('O Qdrant não concluiu a gravação.')
    const saved = await read(prepared)
    if (!saved.ready || saved.records.some(r=>r.embedding.some((v,i)=>Math.abs(v-records.find(x=>x.id===r.id)!.embedding[i])>1e-6))) throw new Error('Falha na conferência dos vetores relidos do Qdrant.')
    return saved
  }
  return {read,save}
}
