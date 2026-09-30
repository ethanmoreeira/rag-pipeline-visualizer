import { buildOnlineContext, type OnlineState, type QueryEmbedding, type RetrievedChunk, type SearchResponse, type Stage } from './types.ts'
import type { GenerationResult } from '../generation.ts'
import { OnlineHttpError } from './request.ts'

export type OnlineDependencies = {
  embed: (query:string,signal:AbortSignal,phase:(text:string)=>void)=>Promise<QueryEmbedding>
  search: (embedding:QueryEmbedding,signal:AbortSignal,attempt:(n:number)=>void)=>Promise<SearchResponse>
  retrieve: (collection:string,ids:number[],signal:AbortSignal,attempt:(n:number)=>void)=>Promise<{collection:string;chunks:RetrievedChunk[]}>
  generate: (context:string,signal:AbortSignal,onText:(text:string)=>void)=>Promise<GenerationResult>
}
const initial = (selectedQuery='',topK=5): OnlineState => ({selectedQuery,topK,queryEmbedding:null,searchResults:[],base:null,retrievedChunks:[],context:'',answer:null,answerText:'',busy:null,failedStage:null,error:'',phase:'Consulta pendente.',attempt:0,timings:{}})
const steps: Stage[] = ['embedding','search','retrieval','context','answer']

/** The single online store survives scene navigation. No legacy corpus or local ranking. */
export class OnlineController {
  private state = initial()
  private listeners = new Set<()=>void>()
  private active: AbortController | null = null
  private version = 0
  constructor(privateDeps: OnlineDependencies) { this.deps = privateDeps }
  private deps: OnlineDependencies
  getSnapshot = () => this.state
  subscribe = (listener:()=>void) => { this.listeners.add(listener); return () => {this.listeners.delete(listener)} }
  private patch(patch:Partial<OnlineState>) { this.state={...this.state,...patch}; this.listeners.forEach(listener=>listener()) }
  private stop() { this.version++; this.active?.abort(); this.active=null }
  setQuery = (query:string) => {
    if (query === this.state.selectedQuery) return
    this.stop(); this.state=initial(query,this.state.topK); this.listeners.forEach(listener=>listener())
  }
  setTopK = (topK:number) => {
    if (!Number.isInteger(topK)||topK<1||topK>5) throw new Error('Top-k deve ficar entre 1 e 5.')
    if (topK===this.state.topK) return
    this.stop(); this.patch({topK,timings:Object.fromEntries(Object.entries(this.state.timings).filter(([stage])=>stage==='embedding'||stage==='search')),retrievedChunks:[],context:'',answer:null,answerText:'',busy:null,error:'',failedStage:null,phase:'Top-k alterado; recupere os textos novamente.'})
  }
  cancel = () => { const stage=this.state.busy; this.stop(); if(stage)this.patch({busy:null,failedStage:stage,error:'Execução interrompida. Texto parcial não é resposta concluída.',phase:'Interrompido.'}) }
  dispose = () => { this.stop() }
  private invalidate(stage:Stage) {
    const position=steps.indexOf(stage)
    this.patch({timings:Object.fromEntries(Object.entries(this.state.timings).filter(([key])=>steps.indexOf(key as Stage)<position)),...(position<=0?{queryEmbedding:null}:{}),...(position<=1?{searchResults:[],base:null}:{}),...(position<=2?{retrievedChunks:[]}:{}),...(position<=3?{context:''}:{}),answer:null,answerText:''})
  }
  run = async (target:Stage, force=false): Promise<void> => {
    if (this.active) return
    if (!this.state.selectedQuery.trim()) {this.patch({error:'Escolha uma consulta na página 01.',failedStage:null});return}
    if (force) this.invalidate(target)
    const abort = new AbortController(), ticket=++this.version
    this.active=abort
    const valid=()=>{abort.signal.throwIfAborted();if(ticket!==this.version)throw new Error('Execução substituída.')}
    const update=(patch:Partial<OnlineState>)=>{if(ticket===this.version&&!abort.signal.aborted)this.patch(patch)}
    let stage: Stage = 'embedding'
    this.patch({error:'',failedStage:null,attempt:1})
    try {
      for (const step of steps.slice(0,steps.indexOf(target)+1)) {
        stage=step; valid()
        const started=performance.now()
        let executed=false
        if(step==='embedding'&&!this.state.queryEmbedding){
          executed=true
          update({busy:step,phase:'Preparando MiniLM…'})
          const result=await this.deps.embed(this.state.selectedQuery,abort.signal,text=>update({phase:text}))
          valid(); if(result.text!==this.state.selectedQuery)throw new Error('Embedding de uma consulta diferente.')
          update({queryEmbedding:result})
        }
        if(step==='search'&&!this.state.searchResults.length){
          executed=true
          update({busy:step,phase:'Consultando a coleção atual no Qdrant…'})
          const {results,...base}=await this.deps.search(this.state.queryEmbedding!,abort.signal,n=>update({attempt:n}))
          valid(); if(!results.length||results.length!==base.chunkCount)throw new Error('O Qdrant não devolveu o ranking completo.')
          update({searchResults:results,base})
        }
        if(step==='retrieval'&&!this.state.retrievedChunks.length){
          executed=true
          update({busy:step,phase:'Recuperando payloads pelos IDs…'})
          const selected=this.state.searchResults.slice(0,this.state.topK)
          const result=await this.deps.retrieve(this.state.base!.collection,selected.map(r=>r.pointId),abort.signal,n=>update({attempt:n}))
          valid();if(result.collection!==this.state.base!.collection||result.chunks.length!==selected.length||result.chunks.some((c,i)=>c.pointId!==selected[i].pointId||c.id!==selected[i].id))throw new Error('Payloads não correspondem ao top-k.')
          update({retrievedChunks:result.chunks})
        }
        if(step==='context'&&!this.state.context){
          executed=true
          update({busy:step,phase:'Montando consulta e evidências…',context:buildOnlineContext(this.state.selectedQuery,this.state.retrievedChunks)})
        }
        if(step==='answer'&&!this.state.answer){
          executed=true
          update({busy:step,phase:'Qwen local está gerando a resposta…',answerText:''})
          const result=await this.deps.generate(this.state.context,abort.signal,text=>update({answerText:text}))
          valid(); update({answer:result,answerText:result.text})
        }
        if(executed) update({timings:{...this.state.timings,[step]:performance.now()-started}})
      }
      update({busy:null,phase:'Etapa concluída.'})
    } catch(error) {
      if (ticket===this.version&&!abort.signal.aborted&&error instanceof OnlineHttpError&&error.status===409&&stage==='retrieval') {
        this.invalidate('search'); stage='search'
      }
      update({busy:null,error:error instanceof Error?error.message:'Falha na execução.',failedStage:stage})
    } finally { if(ticket===this.version)this.active=null }
  }
  retry = () => this.state.failedStage ? this.run(this.state.failedStage,true) : Promise.resolve()
}
