import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createWasmEncoder, root, fetcher, baseRequest } from './validation-runtime.mjs'
import { encodeQuery } from '../src/guided/online/encoder.ts'
import { OnlineController } from '../src/guided/online/controller.ts'
import { onlineRequest } from '../src/guided/online/request.ts'
import { generateOnlineAnswer } from '../src/guided/online/generate.ts'
import { ONLINE_INSTRUCTION, inspectCitations } from '../src/guided/online/types.ts'
import { LOCAL_MODEL, LOCAL_MODEL_FILE } from '../src/ai/localModel.ts'

const baseline = process.argv.includes('--baseline')
const directory = path.join(root, '.runtime', 'validation-refinement')
await mkdir(directory, { recursive: true })
const report = { checkedAt: new Date().toISOString(), baseline, instruction: ONLINE_INSTRUCTION, runs: [], errors: [] }
const queries = [
  'Por que minha conta pode ficar mais cara mesmo consumindo os mesmos kWh?',
  'Se eu tomar banhos mais curtos, o consumo de energia diminui?',
  'Como usar o ar-condicionado consumindo menos energia?',
  'Aparelhos em standby continuam consumindo energia?',
  'Quem ganhou a Copa do Mundo de 2002?',
]
const encoder = await createWasmEncoder()
let audit = {}, reads = []
const observedFetch = async (input, init) => {
  const response = await fetcher(input, init)
  if (String(input).startsWith('/local-llm/')) {
    const requestBody = init?.body ? JSON.parse(String(init.body)) : null
    reads.push(response.clone().text().then(body => {
      if (String(input).endsWith('/chat/completions')) {
        const events = body.split('\n').filter(line => line.startsWith('data:') && !line.includes('[DONE]')).map(line => JSON.parse(line.slice(5)))
        audit.generation = { request: requestBody, events, done: body.includes('data: [DONE]') }
      } else audit[String(input).split('/').at(-1)] = { request: requestBody, response: JSON.parse(body) }
    }))
  }
  return response
}
const controller = new OnlineController({
  embed: query => encodeQuery(encoder, query),
  search: (q, signal, attempt) => onlineRequest('search', { vector: q.vector, model: q.model }, signal, attempt, fetcher),
  retrieve: (collection, ids, signal, attempt) => onlineRequest('retrieve', { collection, ids }, signal, attempt, fetcher),
  generate: (context, signal, onText) => generateOnlineAnswer(context, signal, onText, observedFetch),
})
try {
  const base = await baseRequest('status', {})
  assert.equal(base.ready, true); assert.equal(base.documents.length, 10); assert.equal(base.chunks.length, 55); assert.equal(base.indexedCount, 55)
  report.base = { collection: base.collection, documents: base.documents.length, chunks: base.chunks.length, indexedCount: base.indexedCount }
  for (const query of queries) {
    audit = {}; reads = []
    controller.setQuery(query)
    await controller.run('context')
    let s = controller.getSnapshot()
    assert.equal(s.error, '')
    assert.equal(s.queryEmbedding.vector.length, 384)
    assert.ok(Math.abs(Math.hypot(...s.queryEmbedding.vector) - 1) < 1e-5)
    assert.equal(s.searchResults.length, 55); assert.equal(s.topK, 5); assert.equal(s.retrievedChunks.length, 5)
    assert.deepEqual(s.retrievedChunks.map(c => c.id), s.searchResults.slice(0, 5).map(h => h.id))
    for (const hit of s.searchResults) {
      const cosine = s.queryEmbedding.vector.reduce((sum, v, i) => sum + v * hit.vector[i], 0) / (Math.hypot(...s.queryEmbedding.vector) * Math.hypot(...hit.vector))
      assert.ok(Math.abs(cosine - hit.score) < 1e-5)
    }
    for (const chunk of s.retrievedChunks) assert.equal(chunk.text, base.chunks.find(c => c.id === chunk.id).text)
    const evidence = JSON.parse(s.context.split('EVIDÊNCIAS RECUPERADAS (JSON)\n')[1])
    assert.ok(evidence.every(c => Object.keys(c).join(',') === 'id,documentId,title,text'))
    await controller.run('answer')
    await Promise.all(reads)
    s = controller.getSnapshot()
    const events = audit.generation?.events ?? []
    const finishReason = events.flatMap(e => e.choices ?? []).find(c => c.finish_reason)?.finish_reason
    const usage = events.find(e => e.usage)?.usage
    const citations = inspectCitations(s.answerText, s.retrievedChunks.map(c => c.id))
    const run = { query, context: s.context, contextChars: s.context.length, chunks: s.retrievedChunks, top: s.searchResults.slice(0, 5).map(({id,score}) => ({id,score})), tokenCount: s.queryEmbedding.tokens.length, answer: s.answer, error: s.error, finishReason, usage, citations, audit }
    report.runs.push(run)
    console.log(JSON.stringify({ query, contextChars: run.contextChars, top: run.top, answer: s.answer?.text, finishReason, usage, error: s.error }))
    assert.equal(s.error, ''); assert.ok(s.answer?.text); assert.equal(s.answer.model, LOCAL_MODEL)
    assert.equal(finishReason, 'stop'); assert.equal(audit.generation.done, true); assert.deepEqual(citations.unknown, [])
    const props = audit.props.response
    assert.equal(path.basename(props.model_path), LOCAL_MODEL_FILE)
    assert.equal(props.model_ftype, 'Q4_K - Medium')
    assert.equal(audit.generation.request.chat_template_kwargs.enable_thinking, false)
    assert.ok(audit.tokenize.response.tokens.length + audit.generation.request.max_tokens <= props.default_generation_settings.n_ctx)
    if (!baseline && query.includes('Copa do Mundo')) {
      assert.match(s.answer.text, /base não (informa|contém|fornece|possui)/i)
      assert.doesNotMatch(s.answer.text, /Brasil|Brazil|seleção brasileira/i)
    }
    await writeFile(path.join(directory, baseline ? 'baseline.json' : 'final.json'), JSON.stringify(report, null, 2))
  }
  report.status = 'passed'
} catch (error) {
  report.status = 'failed'; report.errors.push(error.stack); process.exitCode = 1; console.error(error)
} finally {
  controller.dispose(); await encoder.dispose()
  await writeFile(path.join(directory, baseline ? 'baseline.json' : 'final.json'), JSON.stringify(report, null, 2))
}
