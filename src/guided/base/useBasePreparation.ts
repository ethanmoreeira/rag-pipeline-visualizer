import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_SPLIT, type BaseDocument, type ChunkRecord, type PreparedBase, type IndexedBase, type PreparationMessage } from './preparation.ts'
import { isActivePreparation } from './preparationLifecycle.ts'

export type Phase = 'checking'|'idle'|'reading'|'parsing'|'normalizing'|'metadata'|'splitting'|'chunking'|'chunked'|'loading'|'embedding'|'awaitingSave'|'saving'|'validating'|'ready'|'error'
export { isActivePreparation }
export async function baseRequest<T>(path:string, body?:unknown, signal?:AbortSignal):Promise<T> {
  let response: Response
  try {
    response=await fetch(`/api/base/${path}`,{signal,...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})})
  } catch(error) {
    if(signal?.aborted)throw error
    const detail=error instanceof Error&&error.message?` (${error.message})`: ''
    throw new Error(`Não foi possível conectar à API local da Base em "/api/base/${path}". O servidor Vite da apresentação está parado ou desatualizado; reinicie o iniciador.${detail}`,{cause:error})
  }
  if(!response.headers.get('content-type')?.includes('application/json'))throw new Error('Reinicie o servidor para carregar a API da Base.')
  const data=await response.json()
  if(!response.ok)throw new Error(data.error||'Falha na API da Base.')
  return data
}
export function useBasePreparation(){
  const [phase,setPhaseState]=useState<Phase>('checking')
  const phaseRef=useRef<Phase>('checking')
  const mounted=useRef(true)
  const setPhase=useCallback((next:Phase|((previous:Phase)=>Phase))=>{
    const resolved=typeof next==='function'?next(phaseRef.current):next
    phaseRef.current=resolved
    setPhaseState(resolved)
  },[])
  const [documents,setDocuments]=useState<BaseDocument[]>([])
  const [prepared,setPrepared]=useState<PreparedBase|null>(null)
  const [records,setRecords]=useState<ChunkRecord[]>([])
  const [savedCount,setSavedCount]=useState(0)
  const [currentId,setCurrentId]=useState('')
  const [persisted,setPersisted]=useState(false)
  const [persistenceNotice,setPersistenceNotice]=useState('')
  const [error,setError]=useState('')
  const worker=useRef<Worker|null>(null)
  const embeddedRecords=useRef<ChunkRecord[]>([])
  const controller=useRef<AbortController|null>(null)
  const initialController=useRef<AbortController|null>(null)
  const serial=useRef(0)
  const config=DEFAULT_SPLIT
  const busy=!['checking','idle','ready','error'].includes(phase)
  useEffect(()=>{
    mounted.current=true
    const abort=new AbortController()
    initialController.current=abort
    const generation=serial, background=worker
    const checkTicket=serial.current
    void (async()=>{
      try{
        const catalog=await baseRequest<{documents:BaseDocument[]}>('documents',undefined,abort.signal)
        if(abort.signal.aborted)return
        setDocuments(catalog.documents);setPhase('idle')
        // Reuse validated persisted data; inspection never requires a fresh indexing run.
        try {
          const saved=await baseRequest<IndexedBase>('status',{config:DEFAULT_SPLIT},abort.signal)
          if(!abort.signal.aborted&&serial.current===checkTicket){
            setPersisted(saved.ready)
            if(saved.ready){setPrepared(saved);setRecords(saved.records);setSavedCount(saved.indexedCount);setPhase('ready')}
          }
        } catch(e) {if(!abort.signal.aborted&&serial.current===checkTicket)setPersistenceNotice((e as Error).message)}
      }catch(e){if(!abort.signal.aborted){setError((e as Error).message);setPhase('error')}}
    })()
    return()=>{mounted.current=false;abort.abort();initialController.current=null;generation.current++;controller.current?.abort();controller.current=null;background.current?.terminate();background.current=null}
  },[setPhase])
  function cancel(){
    // Only a user cancellation of an active run is a visible outcome. Cleanup
    // and stale callbacks abort the same resources without entering this path.
    const activeController:AbortController|null=controller.current
    if(activeController===null||!isActivePreparation(phaseRef.current,true))return
    serial.current++;activeController.abort();controller.current=null;worker.current?.terminate();worker.current=null
    if(!mounted.current)return
    setCurrentId('');setPhase('error');setError('Preparação interrompida. Os resultados desta execução não foram confirmados como prontos.')
  }
  function fail(message:string){controller.current?.abort();controller.current=null;worker.current?.terminate();worker.current=null;if(!mounted.current)return;setError(message);setPhase('error');setCurrentId('')}
  async function prepare(){
    if(controller.current||['checking','reading','parsing','normalizing','metadata','splitting','chunking','loading','embedding','awaitingSave','saving','validating'].includes(phaseRef.current))return
    const ticket=++serial.current
    const abort=new AbortController();controller.current=abort
    setPrepared(null);setRecords([]);embeddedRecords.current=[];setSavedCount(0);setCurrentId('');setError('');setPhase('reading')
    try{
      const result=await baseRequest<{documents:BaseDocument[]}>('ingest',{},abort.signal)
      if(ticket!==serial.current||abort.signal.aborted)return
      setDocuments(result.documents);setPhase('parsing')
    }catch(e){if(!abort.signal.aborted)fail((e as Error).message)}
  }
  async function split(){
    const abort=controller.current
    if(!abort||phase!=='metadata')return
    setPhase('splitting')
    try{
      const result=await baseRequest<PreparedBase>('prepare',{config},abort.signal)
      if(abort.signal.aborted)return
      if(result.documents.some(d=>JSON.stringify(d)!==JSON.stringify(documents.find(previous=>previous.id===d.id))))throw new Error('A fonte mudou durante a demonstração. Prepare novamente.')
      setPrepared(result);setPhase('chunking')
    }catch(e){if(!abort.signal.aborted)fail((e as Error).message)}
  }
  const completeChunking=useCallback(()=>setPhase(previous=>previous==='chunking'?'chunked':previous),[setPhase])
  async function saveIndexed(result: PreparedBase, abort: AbortController, ticket: number, recordsToSave: ChunkRecord[]){
    const active=()=>ticket===serial.current&&!abort.signal.aborted
    if(!active())return
    setPhase('saving')
    try{
      const saved=await baseRequest<IndexedBase>('index',{config:result.config,collection:result.collection,records:recordsToSave},abort.signal)
      if(!active())return
      if(!saved.ready||saved.indexedCount!==result.chunks.length)throw new Error('O Qdrant não confirmou todos os chunks.')
      setPhase('validating')
      // Independent reread also verifies persistence after the completed write request.
      const verified=await baseRequest<IndexedBase>('status',{config:result.config},abort.signal)
      if(!active())return
      const expected=new Map(recordsToSave.map(record=>[record.id,record]))
      if(!verified.ready||verified.collection!==result.collection||verified.indexedCount!==result.chunks.length||verified.records.some(record=>{
        const original=expected.get(record.id)
        return !original||record.embedding.some((value,index)=>Math.abs(value-original.embedding[index])>1e-6)
      }))throw new Error('A releitura do Qdrant não corresponde à execução atual.')
      setPrepared(verified);setRecords(verified.records);setSavedCount(verified.indexedCount);setPersisted(true);setPersistenceNotice('');setPhase('ready')
      worker.current?.terminate();worker.current=null;controller.current=null
    }catch(e){if(active())fail((e as Error).message)}
  }
  function embed(){
    const result=prepared, abort=controller.current, ticket=serial.current
    if(!result||!abort||phase!=='chunked'||worker.current)return
    const active=()=>ticket===serial.current&&!abort.signal.aborted
    setPhase('loading')
    try {worker.current=new Worker(new URL('./base.worker.ts',import.meta.url),{type:'module'})}
    catch(e){fail((e as Error).message);return}
    worker.current.onerror=e=>{if(active())fail(e.message||'Falha no MiniLM local.')}
    worker.current.onmessage=async({data}:MessageEvent<PreparationMessage>)=>{
      if(!active())return
      if(data.type==='loading')setPhase('loading')
      if(data.type==='processing'){setPhase('embedding');setCurrentId(data.id)}
      if(data.type==='document')setRecords(previous=>[...previous,data.record])
      if(data.type==='error')fail(data.message)
      if(data.type==='complete'){
        embeddedRecords.current=data.records
        setRecords(data.records);setCurrentId('');setPhase('awaitingSave')
        worker.current?.terminate();worker.current=null
      }
    }
    worker.current.postMessage({documents:result.chunks})
  }
  function advance(){
    if(phase==='parsing')setPhase('normalizing')
    else if(phase==='normalizing')setPhase('metadata')
    else if(phase==='metadata')void split()
    else if(phase==='chunked')embed()
    else if(phase==='awaitingSave'&&prepared&&controller.current)void saveIndexed(prepared,controller.current,serial.current,embeddedRecords.current)
  }
  return {phase,documents,prepared,records,config,savedCount,currentId,persisted,persistenceNotice,error,busy,prepare,cancel,advance,completeChunking}
}
