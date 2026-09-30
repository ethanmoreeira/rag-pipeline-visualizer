import test from 'node:test'
import assert from 'node:assert/strict'
import { OnlineController, type OnlineDependencies } from './controller.ts'
import { OnlineHttpError, onlineRequest } from './request.ts'
import { generateOnlineAnswer } from './generate.ts'
import type { QueryEmbedding, RetrievedChunk } from './types.ts'
import { inspectCitations } from './types.ts'

// Deliberately artificial dependency fixtures: confined to automated tests.
const vector=[1,...Array(383).fill(0)]
const embedding=(text:string):QueryEmbedding=>({text,model:'test',elapsedMs:1,attentionMask:[1],pooled:vector,vector,tokens:[{id:1,piece:'test',special:false,hidden:vector}]})
function fixture(overrides:Partial<OnlineDependencies>={}) {
  const calls:string[]=[]
  const hits=Array.from({length:5},(_,i)=>({pointId:i+1,id:`D1-C${i+1}`,documentId:'D1',title:`chunk ${i+1}`,score:.9-i*.1,vector}))
  const deps:OnlineDependencies={
    embed:async q=>{calls.push('embed');return embedding(q)},
    search:async()=>{calls.push('search');return {collection:'test-collection',metric:'Cosine',model:'test',dimensions:384,documentCount:1,chunkCount:5,results:hits}},
    retrieve:async(collection,ids)=>{calls.push('retrieve');return {collection,chunks:ids.map(id=>({pointId:id,id:`D1-C${id}`,text:`payload ${id}`,title:`chunk ${id}`,documentId:'D1',source:'fixture',url:'https://example.test',section:'test'} as RetrievedChunk))}},
    generate:async(context,_signal,onText)=>{calls.push('generate');assert.match(context,/consulta real/);onText('parcial');return {text:'Resposta de teste [D1-C1]',model:'test',firstTextMs:1,totalMs:2}},
    ...overrides,
  }
  const controller=new OnlineController(deps);controller.setQuery('consulta real')
  return {controller,calls,hits,deps}
}
test('uma inferência, ranking reutilizado, payload e consulta no contexto até a resposta',async()=>{
  const {controller:c,calls,hits}=fixture()
  await c.run('embedding');await c.run('search');await c.run('search');await c.run('retrieval');await c.run('context');await c.run('answer')
  assert.deepEqual(calls,['embed','search','retrieve','generate'])
  assert.deepEqual(c.getSnapshot().searchResults,hits)
  assert.equal(c.getSnapshot().topK,5);assert.match(c.getSnapshot().context,/payload 5/)
  assert.ok(c.getSnapshot().answer)
})
test('trocar query invalida todos os resultados; top-k preserva embedding e ranking',async()=>{
  const {controller:c,calls}=fixture();await c.run('answer')
  c.setTopK(1)
  assert.equal(c.getSnapshot().searchResults.length,5);assert.equal(c.getSnapshot().retrievedChunks.length,0);assert.equal(c.getSnapshot().answer,null)
  await c.run('context');assert.equal(c.getSnapshot().retrievedChunks.length,1);assert.equal(calls.filter(x=>x==='embed').length,1)
  c.setQuery('outra consulta');assert.equal(c.getSnapshot().queryEmbedding,null);assert.equal(c.getSnapshot().searchResults.length,0);assert.equal(c.getSnapshot().context,'')
  assert.throws(()=>c.setTopK(9),/Top-k/)
})
test('resposta atrasada não contamina query nova; reentrância não duplica execução',async()=>{
  let finish!:(value:QueryEmbedding)=>void
  let count=0
  const {controller:c}=fixture({embed:()=>{count++;return new Promise(resolve=>{finish=resolve})}})
  const job=c.run('embedding');await c.run('embedding');assert.equal(count,1)
  c.setQuery('nova');finish(embedding('consulta real'));await job
  assert.equal(c.getSnapshot().selectedQuery,'nova');assert.equal(c.getSnapshot().queryEmbedding,null);assert.equal(c.getSnapshot().busy,null)
})
test('retry reexecuta a etapa que falhou; não refaz embedding nem inventa resultado',async()=>{
  let attempt=0
  const {deps}=fixture()
  const {controller:c,calls}=fixture({search:async(...args)=>{if(++attempt===1)throw new Error('Qdrant offline');return deps.search(...args)}})
  await c.run('context');assert.equal(c.getSnapshot().failedStage,'search');assert.equal(c.getSnapshot().context,'')
  await c.retry();assert.equal(attempt,2);assert.equal(calls.filter(x=>x==='embed').length,1)
  await c.run('context');assert.match(c.getSnapshot().context,/payload/)
})
test('cancelamento preserva texto parcial sem declarar resposta pronta',async()=>{
  let finish!:(value:never)=>void
  const {controller:c}=fixture({generate:async(_context,_signal,onText)=>{onText('texto parcial');return new Promise(resolve=>{finish=resolve})}})
  const job=c.run('answer');await new Promise(resolve=>setTimeout(resolve,0));c.cancel();finish({text:'atrasada'} as never);await job
  assert.equal(c.getSnapshot().answer,null);assert.equal(c.getSnapshot().answerText,'texto parcial');assert.match(c.getSnapshot().error,/interrompida/)
})
test('mudança de Base no retrieval exige nova busca e limpa contexto',async()=>{
  const {controller:c}=fixture({retrieve:async()=>{throw new OnlineHttpError('A Base mudou',409)}})
  await c.run('context');assert.equal(c.getSnapshot().failedStage,'search');assert.equal(c.getSnapshot().searchResults.length,0);assert.equal(c.getSnapshot().context,'')
})
test('payload fora de ordem ou ID incorreto impede contexto e geração',async()=>{
  const {deps}=fixture()
  const {controller:c,calls}=fixture({retrieve:async(...args)=>{const r=await deps.retrieve(...args);r.chunks.reverse();return r}})
  await c.run('answer');assert.match(c.getSnapshot().error,/top-k/);assert.equal(c.getSnapshot().context,'');assert.ok(!calls.includes('generate'))
})
test('retry HTTP faz novo request após 503; não repete 400/409',async()=>{
  let count=0
  const fetcher:typeof fetch=async()=>++count===1?Response.json({error:'offline'},{status:503}):Response.json({ok:true})
  assert.deepEqual(await onlineRequest('search',{},new AbortController().signal,undefined,fetcher),{ok:true});assert.equal(count,2)
  for(const status of [400,409]){count=0;await assert.rejects(onlineRequest('search',{},new AbortController().signal,undefined,async()=>{count++;return Response.json({error:'invalid'},{status})}));assert.equal(count,1)}
})
test('cancelamento durante espera de retry não faz nova chamada',async()=>{
  const abort=new AbortController();let count=0
  const job=onlineRequest('search',{},abort.signal,undefined,async()=>{count++;return Response.json({error:'offline'},{status:503})})
  setTimeout(()=>abort.abort(),10);await assert.rejects(job);assert.equal(count,1)
})
test('janela de contexto insuficiente bloqueia geração sem cortar chunks',async()=>{
  const calls:string[]=[]
  const fetcher:typeof fetch=async input=>{calls.push(String(input));return Response.json(String(input).endsWith('/props')?{default_generation_settings:{n_ctx:300}}:String(input).endsWith('/apply-template')?{prompt:'real prompt'}:{tokens:Array(100).fill(1)})}
  await assert.rejects(generateOnlineAnswer('contexto',new AbortController().signal,()=>{},fetcher),/Nenhum chunk foi cortado/)
  assert.equal(calls.length,3)
})
test('citação com letra errada, ID truncado ou referência externa é sinalizada',()=>{
  assert.deepEqual(inspectCitations('Texto [A4-C4] [D4] [D4-C4, D6-C1] [fonte]', ['D4-C4','D6-C1']),{cited:['A4-C4','D4','D4-C4','D6-C1','fonte'],unknown:['A4-C4','D4','fonte']})
})

test('execução ponta a ponta mede apenas etapas reais e preserva tempos ao reutilizar',async()=>{
  const {controller:c,calls}=fixture()
  await c.run('answer')
  const timings={...c.getSnapshot().timings}
  assert.deepEqual(Object.keys(timings),['embedding','search','retrieval','context','answer'])
  assert.ok(Object.values(timings).every(ms=>Number.isFinite(ms)&&ms>=0))
  await c.run('answer')
  assert.deepEqual(c.getSnapshot().timings,timings)
  assert.deepEqual(calls,['embed','search','retrieve','generate'])
  c.setTopK(2)
  assert.deepEqual(c.getSnapshot().timings,{embedding:timings.embedding,search:timings.search})
  await c.run('answer')
  assert.equal(c.getSnapshot().retrievedChunks.length,2)
  assert.equal(calls.filter(x=>x==='embed').length,1)
  c.setQuery('nova consulta')
  assert.deepEqual(c.getSnapshot().timings,{})
  assert.equal(c.getSnapshot().answerText,'')
})

test('etapa que falha não recebe tempo de sucesso e pode ser retomada',async()=>{
  let tries=0
  const {deps}=fixture()
  const {controller:c}=fixture({search:async(...args)=>{if(++tries===1)throw new Error('falha');return deps.search(...args)}})
  await c.run('answer')
  assert.equal(c.getSnapshot().timings.search,undefined)
  assert.equal(c.getSnapshot().answer,null)
  await c.run('answer')
  assert.ok(c.getSnapshot().answer)
  assert.ok(c.getSnapshot().timings.search!>=0)
})
