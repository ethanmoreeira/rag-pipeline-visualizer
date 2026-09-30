import { cp, mkdir, access } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'node_modules', '@huggingface', 'transformers', 'dist')
const target = path.join(root, 'public', 'runtime')
await mkdir(target, { recursive: true })
for (const file of ['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm']) await cp(path.join(dist, file), path.join(target, file))
const modelDir = path.join(root, 'public', 'models', 'paraphrase-multilingual-MiniLM-L12-v2', 'onnx')
try { await access(path.join(modelDir, 'model_quantized.onnx')) }
catch { try { await cp(path.join(modelDir, 'model_q8.onnx'), path.join(modelDir, 'model_quantized.onnx')) } catch { /* Models are installed separately; no remote fallback. */ } }
console.log('Runtime WASM preparado para execução local.')
