import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { onlineApi } from './online-api.ts'
import { prepareDocuments } from './base-ingestion.ts'
import { MODEL } from '../src/guided/corpus.ts'

const prepared=await prepareDocuments(process.cwd())
const vector=[1,...Array(383).fill(0)]
// Synthetic network responses test protocol, never runtime search quality.
const points=prepared.chunks.map((chunk,i)=>({id:i+1,vector,payload:{...chunk,model:MODEL,dimensions:384,tokenCount:10,elapsedMs:1}}))
const originalFetch=globalThis.fetch
test.afterEach(()=>{globalThis.fetch=originalFetch})
function setup(options:{missing?:boolean;malformed?:boolean}={}) {
  const requests:{url:string;body:any;method:string}[]=[]
  globalThis.fetch=async(input,init)=>{
    const url=String(input),body=init?.body?JSON.parse(String(init.body)):null
    requests.push({url,body,method:init?.method??'GET'})
    if(url.endsWith('/points/scroll'))return Response.json({result:{points,next_page_offset:null}})
    if(url.endsWith('/points/query'))return Response.json({result:{points:[...points].reverse().map((p,i)=>({...p,score:.9-i*.01,...(options.malformed&&i===0?{payload:{...p.payload,text:'tampered'}}:{})}))}})
    if(url.endsWith('/points'))return Response.json({result:body.ids.map((id:number)=>points[id-1]).reverse()})
    if(options.missing)return Response.json({result:null},{status:404})
    return Response.json({result:{config:{params:{vectors:{size:384,distance:'Cosine'}}}}})
  }
  let handler:any
  const plugin=onlineApi('http://qdrant.test','test-secret')
  ;(plugin.configureServer as Function)({config:{root:process.cwd()},middlewares:{use:(value:unknown)=>{handler=value}}})
  async function call(route:string,body:unknown,headers:Record<string,string>={},method='POST') {
    const request=Readable.from([JSON.stringify(body)]) as any
    Object.assign(request,{url:`/api/online/${route}`,method,headers:{'content-type':'application/json',host:'localhost',...headers}})
    let status=0,data:any
    const response={writeHead:(code:number)=>{status=code},end:(value:string)=>{data=JSON.parse(value)}}
    await handler(request,response,()=>assert.fail('unexpected next'))
    return {status,data}
  }
  return {call,requests}
}
test('API consulta coleção atual, preserva scores/ordem Qdrant e não grava pontos',async()=>{
  const {call,requests}=setup()
  const result=await call('search',{vector,model:MODEL})
  assert.equal(result.status,200);assert.equal(result.data.collection,prepared.collection)
  assert.equal(result.data.results.length,prepared.chunks.length)
  assert.equal(result.data.results[0].pointId,points.length);assert.equal(result.data.results[0].score,.9)
  const search=requests.find(r=>r.url.endsWith('/query'))!
  assert.deepEqual(search.body.params,{exact:true});assert.equal(search.body.limit,points.length)
  assert.ok(requests.every(r=>!['PUT','DELETE','PATCH'].includes(r.method)))
  assert.equal(result.data.results[0].text,undefined)
})
test('retrieval relê payloads no Qdrant e restaura ordem solicitada',async()=>{
  const {call}=setup()
  const result=await call('retrieve',{ids:[5,2],collection:prepared.collection})
  assert.equal(result.status,200)
  assert.deepEqual(result.data.chunks.map((c:any)=>c.pointId),[5,2])
  assert.equal(result.data.chunks[0].text,points[4].payload.text)
})
test('API rejeita dimensão, modelo, norma, IDs duplicados e coleção antiga',async()=>{
  const {call}=setup()
  for(const body of [{vector:[1],model:MODEL},{vector:Array(384).fill(0),model:MODEL},{vector,model:'other'}])assert.equal((await call('search',body)).status,400)
  assert.equal((await call('retrieve',{ids:[1,1]})).status,400)
  assert.equal((await call('retrieve',{ids:[1],collection:'old'})).status,409)
  assert.equal((await call('search',{}, {origin:'https://external.test'})).status,403)
})
test('coleção ausente e payload adulterado nunca viram busca válida',async()=>{
  let api=setup({missing:true});assert.equal((await api.call('search',{vector,model:MODEL})).status,409)
  api=setup({malformed:true});assert.equal((await api.call('search',{vector,model:MODEL})).status,502)
})
