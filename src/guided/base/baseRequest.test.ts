import assert from 'node:assert/strict'
import test from 'node:test'
import { baseRequest } from './useBasePreparation.ts'

const originalFetch=globalThis.fetch

test.afterEach(()=>{globalThis.fetch=originalFetch})

test('baseRequest informa falha de conexão com o endpoint local',async()=>{
  globalThis.fetch=async()=>{throw new TypeError('fetch failed')}
  await assert.rejects(
    baseRequest('documents'),
    error=>error instanceof Error
      && error.message.includes('API local da Base')
      && error.message.includes('/api/base/documents')
      && error.message.includes('fetch failed'),
  )
})

test('baseRequest preserva erros HTTP retornados pela API',async()=>{
  globalThis.fetch=async()=>new Response(JSON.stringify({error:'Qdrant indisponível'}),{
    status:503,
    headers:{'content-type':'application/json; charset=utf-8'},
  })
  await assert.rejects(baseRequest('status',{}),/Qdrant indisponível/)
})

test('baseRequest rejeita resposta sem JSON para evitar sucesso falso',async()=>{
  globalThis.fetch=async()=>new Response('Vite fallback',{
    status:200,
    headers:{'content-type':'text/html; charset=utf-8'},
  })
  await assert.rejects(baseRequest('documents'),/Reinicie o servidor/)
})
