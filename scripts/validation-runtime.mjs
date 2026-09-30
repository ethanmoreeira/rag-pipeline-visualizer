import { env, AutoTokenizer, Tensor } from '@huggingface/transformers'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MODEL } from '../src/guided/corpus.ts'

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const address = process.env.VERIFY_BASE_URL || 'http://127.0.0.1:5173'
export const fetcher = (input, init) => fetch(new URL(String(input), address), init)
export async function baseRequest(route, body) {
  const response = await fetcher(`/api/base/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || `Base HTTP ${response.status}`)
  return result
}
export async function createWasmEncoder() {
  env.allowRemoteModels = false
  env.allowLocalModels = true
  env.localModelPath = path.join(root, 'public', 'models') + path.sep
  const require = createRequire(import.meta.resolve('@huggingface/transformers'))
  const ort = require('onnxruntime-web/wasm')
  ort.env.wasm.numThreads = 1
  const session = await ort.InferenceSession.create(await readFile(path.join(root, 'public', 'models', MODEL, 'onnx', 'model_quantized.onnx')), { executionProviders: ['wasm'] })
  return { tokenizer: await AutoTokenizer.from_pretrained(MODEL), model: async inputs => {
    const feeds = Object.fromEntries(session.inputNames.map(name => [name, new ort.Tensor(inputs[name].type, inputs[name].data, inputs[name].dims)]))
    const outputs = await session.run(feeds)
    return Object.fromEntries(Object.entries(outputs).map(([name, tensor]) => [name, new Tensor(tensor.type, tensor.data, tensor.dims)]))
  }, dispose: () => session.release() }
}
