import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { prepareDocuments, readDocuments } from './base-ingestion.ts'
import { qdrantBase } from './base-qdrant.ts'

export function baseDocumentsApi(url: string, apiKey: string): Plugin {
  const store = qdrantBase(url,apiKey)
  const attach = (server: {config:{root:string};middlewares:{use:(handler:(request:IncomingMessage,response:ServerResponse,next:()=>void)=>void)=>void}}) => {
    server.middlewares.use(async (request,response,next)=>{
      const path=request.url?.split('?')[0]
      if (!path?.startsWith('/api/base/')) return next()
      const reply=(status:number,data:unknown)=>{response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});response.end(JSON.stringify(data))}
      try {
        if (request.headers['sec-fetch-site']==='cross-site'||(request.headers.origin&&new URL(request.headers.origin).host!==request.headers.host)) return reply(403,{error:'Use a apresentação no servidor local.'})
        if(path==='/api/base/documents'&&request.method==='GET') return reply(200,{documents:await readDocuments(server.config.root)})
        if(request.method!=='POST') return reply(405,{error:'Método não permitido.'})
        if(!request.headers['content-type']?.startsWith('application/json')) return reply(415,{error:'Envie JSON.'})
        let raw=''
        for await(const chunk of request){raw+=chunk;if(Buffer.byteLength(raw)>8_000_000)return reply(413,{error:'Solicitação grande demais.'})}
        const body=JSON.parse(raw||'{}')
        if(path==='/api/base/ingest') return reply(200,{documents:await readDocuments(server.config.root)})
        const prepared=await prepareDocuments(server.config.root,body.config)
        if(path==='/api/base/prepare') return reply(200,prepared)
        if(path==='/api/base/status') return reply(200,await store.read(prepared))
        if(path==='/api/base/index') {
          if(body.collection!==prepared.collection) return reply(409,{error:'Os documentos mudaram durante a preparação. Prepare novamente.'})
          return reply(200,await store.save(prepared,body.records))
        }
        return reply(404,{error:'Rota não encontrada.'})
      }catch(error){return reply(500,{error:error instanceof Error?error.message:'Falha na preparação da Base.'})}
    })
  }
  return {name:'seminario-base-qdrant',configureServer:attach,configurePreviewServer:attach}
}
