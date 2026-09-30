import { useEffect, useState, useSyncExternalStore } from 'react'
import { OnlineController } from './controller.ts'
import { onlineRequest } from './request.ts'
import { generateOnlineAnswer } from './generate.ts'
import { type QueryEmbedding, type SearchResponse, type RetrievedChunk } from './types.ts'

export function useOnlinePipeline() {
  const [controller] = useState(()=>new OnlineController({
    embed: (query,signal,phase)=>new Promise<QueryEmbedding>((resolve,reject)=>{
      const worker=new Worker(new URL('./query.worker.ts',import.meta.url),{type:'module'})
      const timer=setTimeout(()=>finish(new Error('O MiniLM excedeu 120 segundos. Tente novamente.')),120_000)
      const abort=()=>finish(new Error('Cálculo interrompido.'))
      function finish(error?:Error,value?:QueryEmbedding){clearTimeout(timer);signal.removeEventListener('abort',abort);worker.terminate();if(error)reject(error);else resolve(value!)}
      signal.addEventListener('abort',abort,{once:true})
      worker.onmessage=({data})=>{if(data.type==='phase')phase(data.text);if(data.type==='ready')finish(undefined,data.embedding);if(data.type==='error')finish(new Error(data.text))}
      worker.onerror=e=>finish(new Error(e.message||'Falha no worker MiniLM.'))
      if(signal.aborted)abort();else worker.postMessage({query})
    }),
    search:(embedding,signal,attempt)=>onlineRequest<SearchResponse>('search',{vector:embedding.vector,model:embedding.model},signal,attempt),
    retrieve:(collection,ids,signal,attempt)=>onlineRequest<{collection:string;chunks:RetrievedChunk[]}>('retrieve',{collection,ids},signal,attempt),
    generate:generateOnlineAnswer,
  }))
  const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot)
  useEffect(()=>()=>controller.dispose(),[controller])
  return {state,controller}
}
export type OnlinePipeline = ReturnType<typeof useOnlinePipeline>
