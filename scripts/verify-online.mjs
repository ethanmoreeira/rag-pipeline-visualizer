import assert from 'node:assert/strict'
import { env, pipeline, AutoTokenizer, Tensor } from '@huggingface/transformers'
import { createRequire } from 'node:module'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MODEL } from '../src/guided/corpus.ts'
import { encodeQuery } from '../src/guided/online/encoder.ts'
import { OnlineController } from '../src/guided/online/controller.ts'
import { onlineRequest } from '../src/guided/online/request.ts'
import { generateOnlineAnswer } from '../src/guided/online/generate.ts'
import { projectPca } from '../src/ai/projectPca.ts'
import { LOCAL_MODEL } from '../src/ai/localModel.ts'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const address=process.env.VERIFY_BASE_URL||'http://127.0.0.1:5173'
const fetcher=(input,init)=>fetch(new URL(String(input),address),init)
const queries=[...((await readFile(path.join(root,'src/guided/QueryScene.tsx'),'utf8')).matchAll(/^  '(.+)',?$/gm))].slice(0,3).map(m=>m[1])
assert.equal(queries.length,3)
env.allowRemoteModels=false;env.allowLocalModels=true;env.localModelPath=path.join(root,'public','models')+path.sep
const wasm=process.argv.includes('--wasm')
let encoder
if(wasm) {
  // Exercise the actual ONNX Runtime Web WASM backend inside Node, without a browser.
  const require=createRequire(import.meta.resolve('@huggingface/transformers'))
  const ort=require('onnxruntime-web/wasm')
  ort.env.wasm.numThreads=1
  const session=await ort.InferenceSession.create(await readFile(path.join(root,'public','models',MODEL,'onnx','model_quantized.onnx')),{executionProviders:['wasm']})
  encoder={tokenizer:await AutoTokenizer.from_pretrained(MODEL),model:async inputs=>{
    const feeds=Object.fromEntries(session.inputNames.map(name=>[name,new ort.Tensor(inputs[name].type,inputs[name].data,inputs[name].dims)]))
    const outputs=await session.run(feeds)
    return Object.fromEntries(Object.entries(outputs).map(([name,tensor])=>[name,new Tensor(tensor.type,tensor.data,tensor.dims)]))
  },dispose:()=>session.release()}
} else encoder=await pipeline('feature-extraction',MODEL,{dtype:'q8',device:'cpu'})
const directory=path.join(root,'.runtime','validation-final',wasm?'online-wasm':'online-cpu')
await mkdir(directory,{recursive:true})
const report={checkedAt:new Date().toISOString(),backend:wasm?'ONNX Runtime Web WASM q8 in Node, with Transformers.js tokenizer and shared encodeQuery; no browser or Web Worker execution':'Transformers.js ONNX q8 CPU in Node; same encodeQuery source as the WASM worker; not a browser execution',runs:[],errors:[]}
let inferenceCount=0
const controller=new OnlineController({
  embed:async(query)=>{inferenceCount++;return encodeQuery(encoder,query)},
  search:(q,signal,attempt)=>onlineRequest('search',{vector:q.vector,model:q.model},signal,attempt,fetcher),
  retrieve:(collection,ids,signal,attempt)=>onlineRequest('retrieve',{collection,ids},signal,attempt,fetcher),
  generate:(context,signal,onText)=>generateOnlineAnswer(context,signal,onText,fetcher),
})
try {
  for(const [index,query] of queries.entries()) {
    controller.setQuery(query)
    await controller.run('context')
    let s=controller.getSnapshot();assert.equal(s.error,'');assert.equal(s.queryEmbedding.text,query);assert.equal(s.queryEmbedding.vector.length,384)
    assert.ok(s.searchResults.length>0);assert.equal(s.searchResults.length,s.base.chunkCount);assert.equal(s.retrievedChunks.length,s.topK)
    assert.ok(s.retrievedChunks.every((chunk,i)=>chunk.id===s.searchResults[i].id&&s.context.includes(chunk.text)))
    const projected=projectPca([s.queryEmbedding.vector,...s.searchResults.map(hit=>hit.vector)])
    assert.equal(projected.points.length,s.base.chunkCount+1);assert.ok(projected.points.flat().every(Number.isFinite))
    await controller.run('answer');s=controller.getSnapshot()
    const run={query,collection:s.base.collection,chunkCount:s.base.chunkCount,tokenCount:s.queryEmbedding.tokens.length,dimensions:s.queryEmbedding.vector.length,top:s.searchResults.slice(0,s.topK).map(({id,score})=>({id,score})),context:s.context,payloads:s.retrievedChunks,answer:s.answer,error:s.error,partial:s.answerText,explained2D:projected.explained,state:s}
    report.runs.push(run);await writeFile(path.join(directory,`query-${index+1}.json`),JSON.stringify(run,null,2))
    console.log(JSON.stringify({query:index+1,tokens:run.tokenCount,top:run.top,answer:s.answer?.text,error:s.error}))
    assert.equal(s.error,'');assert.ok(s.answer?.text);assert.equal(s.answer.model,LOCAL_MODEL)
    await controller.run('context');assert.equal(inferenceCount,index+1,'Scene navigation must reuse the query embedding')
  }
  controller.setTopK(1);await controller.run('context');assert.equal(controller.getSnapshot().retrievedChunks.length,1);assert.equal(controller.getSnapshot().answer,null)
  controller.setTopK(5);await controller.run('context');assert.equal(controller.getSnapshot().retrievedChunks.length,5);assert.equal(inferenceCount,3)
  await assert.rejects(encodeQuery(encoder,'energia '.repeat(150)),/128/)
  for(const [route,body,expected] of [['search',{vector:[0],model:MODEL},400],['retrieve',{ids:[1,1],collection:'x'},400],['retrieve',{ids:[1],collection:'old-version'},409]]) {
    const response=await fetcher(`/api/online/${route}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(response.status,expected)
  }
  const crossSite=await fetcher('/api/online/search',{method:'POST',headers:{'Content-Type':'application/json','Origin':'https://example.invalid'},body:'{}'});assert.equal(crossSite.status,403)
  report.inferenceCount=inferenceCount;report.status='passed'
} catch(error) {report.status='failed';report.errors.push(error.stack);process.exitCode=1;console.error(error)}
finally {controller.dispose();await encoder.dispose();await writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2))}
