import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { prepareDocuments } from './base-ingestion.ts'
import { qdrantBase } from './base-qdrant.ts'
import { DEFAULT_SPLIT } from '../src/guided/base/preparation.ts'
import { DIMENSIONS, MODEL } from '../src/guided/corpus.ts'
import type { SearchResponse, RetrievedChunk } from '../src/guided/online/types.ts'

class ApiError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}
export function onlineApi(url: string, key: string): Plugin {
  const store = qdrantBase(url, key)
  const attach = (server: {config:{root:string};middlewares:{use:(handler:(req:IncomingMessage,res:ServerResponse,next:()=>void)=>void)=>void}}) => {
    server.middlewares.use(async (req,res,next) => {
      const path = req.url?.split('?')[0]
      if (!path?.startsWith('/api/online/')) return next()
      const reply = (status: number, value: unknown) => { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(value)) }
      try {
        if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)) throw new ApiError(403,'Use o servidor local da apresentação.')
        if (!['/api/online/search','/api/online/retrieve'].includes(path)) throw new ApiError(404,'Rota não encontrada.')
        if (req.method !== 'POST') throw new ApiError(405,'Envie POST.')
        if (!req.headers['content-type']?.startsWith('application/json')) throw new ApiError(415,'Envie JSON.')
        let raw = ''
        for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 100_000) throw new ApiError(413,'Solicitação grande demais.') }
        let body: Record<string, any>
        try { body = JSON.parse(raw); if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error() } catch { throw new ApiError(400,'JSON inválido.') }
        if (path.endsWith('/search') && (body.model !== MODEL || !Array.isArray(body.vector) || body.vector.length !== DIMENSIONS || body.vector.some((v:unknown)=>typeof v !== 'number'||!Number.isFinite(v)) || Math.abs(Math.hypot(...body.vector)-1)>1e-4)) throw new ApiError(400,'Use um embedding MiniLM normalizado de 384 dimensões.')
        if (path.endsWith('/retrieve') && (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > 5 || new Set(body.ids).size !== body.ids.length || body.ids.some((id:unknown)=>!Number.isInteger(id)))) throw new ApiError(400,'Selecione de 1 a 5 IDs únicos do ranking.')
        const prepared = await prepareDocuments(server.config.root, DEFAULT_SPLIT)
        if (path.endsWith('/retrieve') && body.collection !== prepared.collection) throw new ApiError(409,'A Base mudou. Execute a busca novamente.')
        if (!url) throw new ApiError(503,'Qdrant não configurado no servidor.')
        const saved = await store.read(prepared)
        if (!saved.ready) throw new ApiError(409,'A coleção atual não está pronta. Prepare e salve a Base na página 00.')
        const request = async (suffix: string, data: unknown) => {
          let response: Response
          try { response = await fetch(`${url.replace(/\/+$/, '')}/collections/${prepared.collection}/points${suffix}`, {method:'POST', headers:{'Content-Type':'application/json',...(key?{'api-key':key}:{})}, body:JSON.stringify(data),signal:AbortSignal.timeout(30_000)}) }
          catch { throw new ApiError(503,'Não foi possível consultar o Qdrant.') }
          if (!response.ok) throw new ApiError([429,502,503,504].includes(response.status)?response.status:502,`Qdrant respondeu HTTP ${response.status}.`)
          return (await response.json() as {result:any}).result
        }
        if (path.endsWith('/search')) {
          // Full exact ranking of this small teaching base, computed exclusively by Qdrant.
          const result = await request('/query', {query:body.vector,limit:prepared.chunks.length,params:{exact:true},with_payload:true,with_vector:true})
          const points = result?.points
          if (!Array.isArray(points) || points.length !== saved.indexedCount || new Set(points.map(p=>p.id)).size !== points.length) throw new ApiError(502,'Ranking incompleto retornado pelo Qdrant.')
          const results = points.map((point,index) => {
            const chunk = prepared.chunks[point.id-1]
            if (!chunk || !point.payload || Object.entries(chunk).some(([k,v])=>point.payload[k]!==v) || !Number.isFinite(point.score) || point.score < -1.00001 || point.score > 1.00001 || (index>0 && points[index-1].score < point.score) || !Array.isArray(point.vector) || point.vector.length!==DIMENSIONS || point.vector.some((v:unknown)=>typeof v!=='number'||!Number.isFinite(v))) throw new ApiError(502,'Resultado Qdrant inconsistente.')
            return {pointId:point.id,id:point.payload.id,documentId:point.payload.documentId,title:point.payload.title,score:point.score,vector:point.vector}
          })
          const answer: SearchResponse = {collection:prepared.collection,metric:'Cosine',model:MODEL,dimensions:DIMENSIONS,documentCount:prepared.documents.length,chunkCount:saved.indexedCount,results}
          return reply(200,answer)
        }
        if (body.ids.some((id:number)=>!prepared.chunks[id-1])) throw new ApiError(400,'ID fora da coleção atual.')
        const points = await request('', {ids:body.ids,with_payload:true,with_vector:false})
        if (!Array.isArray(points) || points.length !== body.ids.length || new Set(points.map(p=>p.id)).size !== points.length) throw new ApiError(502,'Payloads incompletos retornados pelo Qdrant.')
        const chunks: RetrievedChunk[] = body.ids.map((id:number) => {
          const point = points.find(p=>p.id===id)
          const expected = saved.records.find(r=>r.id===prepared.chunks[id-1].id)!
          const {embedding:_embedding,...metadata} = expected
          if (!point?.payload || Object.entries(metadata).some(([k,v])=>point.payload[k]!==v)) throw new ApiError(409,'O payload mudou durante a recuperação. Execute a busca novamente.')
          return {...point.payload,pointId:id}
        })
        return reply(200,{collection:prepared.collection,chunks})
      } catch(error) {
        const status = error instanceof ApiError ? error.status : error instanceof TypeError || (error instanceof Error && /HTTP|timeout|fetch/i.test(error.message)) ? 503 : 500
        return reply(status,{error:error instanceof Error?error.message:'Falha no pipeline online.'})
      }
    })
  }
  return {name:'seminario-online-real',configureServer:attach,configurePreviewServer:attach}
}
