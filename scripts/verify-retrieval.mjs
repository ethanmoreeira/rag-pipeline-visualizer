import assert from 'node:assert/strict'
import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { root, fetcher, createWasmEncoder } from './validation-runtime.mjs'
import { encodeQuery } from '../src/guided/online/encoder.ts'
import { onlineRequest } from '../src/guided/online/request.ts'

const queries = [
  'Por que minha conta pode ficar mais cara mesmo consumindo os mesmos kWh?',
  'Como o tempo do banho influencia o consumo do chuveiro elétrico?',
  'Uma TV em modo de espera ainda gasta eletricidade? Como evitar esse consumo?',
  'Por que limpar os filtros do ar-condicionado ajuda a economizar energia?',
  'Como usar o ar-condicionado consumindo menos energia?',
  'Se eu tomar banhos mais curtos, o consumo de energia diminui?',
  'Minha conta de energia aumentou nos últimos meses, mesmo sem novos aparelhos. O que pode estar causando isso e como reduzir o gasto?',
  'Qual sistema fotovoltaico devo comprar e quantas placas solares preciso?',
]
const encoder = await createWasmEncoder(), runs = []
try {
  for (const query of queries) {
    const signal = AbortSignal.timeout(60000)
    const embedding = await encodeQuery(encoder, query)
    const search = await onlineRequest('search', { vector: embedding.vector, model: embedding.model }, signal, undefined, fetcher)
    const top = search.results.slice(0, 5)
    const payloads = await onlineRequest('retrieve', { collection: search.collection, ids: top.map(hit => hit.pointId) }, signal, undefined, fetcher)
    assert.deepEqual(payloads.chunks.map(c => c.id), top.map(hit => hit.id))
    const run = { query, collection: search.collection, embedding, top: top.map((hit, i) => ({ id: hit.id, score: hit.score, text: payloads.chunks[i].text })), search, payloads: payloads.chunks }
    runs.push(run)
    console.log(JSON.stringify({ query, top: run.top }, null, 2))
  }
  await mkdir(path.join(root, '.runtime', 'validation-final'), { recursive: true })
  await writeFile(path.join(root, '.runtime', 'validation-final', 'retrieval.json'), JSON.stringify({ at: new Date().toISOString(), backend: 'MiniLM q8 WASM + Qdrant reais', runs }, null, 2))
} finally { await encoder.dispose() }
