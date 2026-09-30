import assert from 'node:assert/strict'
import { cosineSimilarity } from './cosineSimilarity.ts'
const close = (a:number,b:number) => assert.ok(Math.abs(a-b)<1e-10)
close(cosineSimilarity([1,0],[1,0]),1)
close(cosineSimilarity([1,0],[0,1]),0)
close(cosineSimilarity([1,0],[-1,0]),-1)
close(cosineSimilarity([3,4],[6,8]),1)
close(cosineSimilarity([0,0],[1,0]),0)
assert.throws(()=>cosineSimilarity([1],[1,2]))
assert.throws(()=>cosineSimilarity([],[]))
assert.throws(()=>cosineSimilarity([NaN],[1]))
const a = Array.from({length:384},(_,i)=>Math.sin(i+1))
const b = Array.from({length:384},(_,i)=>Math.cos(i+2))
const expected = a.reduce((s,x,i)=>s+x*b[i],0)/(Math.hypot(...a)*Math.hypot(...b))
close(cosineSimilarity(a,b),expected)

console.log('PASS: cosine e entradas inválidas.');
