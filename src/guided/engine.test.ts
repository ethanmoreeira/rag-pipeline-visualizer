import assert from 'node:assert/strict'
import test from 'node:test'
import { meanRows, normalizeVector, validateSnapshot, type GuidedSnapshot } from './engine.ts'
import { MODEL, DIMENSIONS } from './corpus.ts'

test('Mean pooling calcula a média por dimensão e L2 mantém direção',()=>{
  assert.deepEqual(meanRows([[1,3],[3,5]]),[2,4])
  assert.deepEqual(normalizeVector([3,4]),[0.6,0.8])
  assert.throws(()=>meanRows([]),/Matriz/)
  assert.throws(()=>meanRows([[1],[1,2]]),/Matriz/)
  assert.throws(()=>normalizeVector([0,0]),/norma/)
})
test('Snapshot rejeita dimensão, estados, média e vetor incoerentes',()=>{
  const hidden=Array(DIMENSIONS).fill(1)
  const snapshot:GuidedSnapshot={query:{text:'teste',tokens:[{id:1,piece:'teste',special:false,hidden}],pooled:hidden,vector:normalizeVector(hidden)},documents:[],model:MODEL,dimension:DIMENSIONS,elapsedMs:1}
  assert.doesNotThrow(()=>validateSnapshot(snapshot))
  assert.throws(()=>validateSnapshot({...snapshot,dimension:3}),/Dimensão/)
  assert.throws(()=>validateSnapshot({...snapshot,query:{...snapshot.query,pooled:Array(DIMENSIONS).fill(2)}}),/média/)
  assert.throws(()=>validateSnapshot({...snapshot,query:{...snapshot.query,vector:hidden}}),/vetor/)
  assert.throws(()=>validateSnapshot({...snapshot,query:{...snapshot.query,tokens:[{...snapshot.query.tokens[0],hidden:[1]}]}}),/contextual/)
})
