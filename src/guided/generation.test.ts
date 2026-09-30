import assert from 'node:assert/strict'
import { generateLocalAnswer, LOCAL_MODEL } from './generation.ts'
// Dados artificiais são exclusivos do teste de protocolo, nunca usados na UI.
const events=(text:string,reason='stop',done=true)=>`data: ${JSON.stringify({choices:[{delta:{content:text}}]})}\r\n\r\ndata: ${JSON.stringify({choices:[{delta:{},finish_reason:reason}]})}\n\n${done?'data: [DONE]\n\n':''}`
function fixture(sse:string,model=LOCAL_MODEL):typeof fetch{return async(input,init)=>{
  init?.signal?.throwIfAborted()
  if(String(input).endsWith('/models'))return Response.json({data:[{id:model}]})
  const body=JSON.parse(String(init?.body));assert.equal(body.messages[1].content,'contexto de teste');assert.equal(body.stream,true)
  const bytes=new TextEncoder().encode(sse)
  return new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=7)c.enqueue(bytes.slice(i,i+7));c.close()}}))
}}
const partial:string[]=[]
const result=await generateLocalAnswer('contexto de teste',{fetcher:fixture(events('Ação válida [D1].')),onText:t=>partial.push(t)})
assert.equal(result.text,'Ação válida [D1].');assert.deepEqual(partial,['Ação válida [D1].']);assert.ok(result.totalMs>=result.firstTextMs)
await assert.rejects(generateLocalAnswer('',{fetcher:fixture('')}),/contexto/)
await assert.rejects(generateLocalAnswer('contexto de teste',{fetcher:fixture(events(''),'outro modelo')}),/esperado/)
await assert.rejects(generateLocalAnswer('contexto de teste',{fetcher:fixture(events('parcial','length'))}),/incompleta/)
await assert.rejects(generateLocalAnswer('contexto de teste',{fetcher:fixture(events('texto','stop',false))}),/confirmação/)
await assert.rejects(generateLocalAnswer('contexto de teste',{fetcher:fixture(events(''))}),/não produziu/)
await assert.rejects(generateLocalAnswer('contexto de teste',{fetcher:async()=>new Response('',{status:503})}),/não está pronto/)
const abort=new AbortController();abort.abort()
await assert.rejects(generateLocalAnswer('contexto de teste',{signal:abort.signal,fetcher:fixture(events('nunca'))}),/abort/i)
console.log('PASS: SSE fragmentado/UTF-8, modelo, fim de fluxo, limite, vazio, erro e cancelamento.')
