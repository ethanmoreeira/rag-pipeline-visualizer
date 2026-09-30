import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFileSync, cpSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { baseDocumentsApi } from './server/base-api.ts'
import { onlineApi } from './server/online-api.ts'
import { LOCAL_LLM_URL } from './src/ai/localModel.ts'

/**
 * Serve the ONNX runtime files (.mjs + .wasm) from node_modules under
 * /onnx-runtime/ so that the dynamic import() issued by onnxruntime-web
 * inside the workers is never intercepted by Vite's /public guard.
 *
 * In dev/preview: middleware reads the files from disk and responds with
 * the correct MIME type and SharedArrayBuffer-required CORP headers.
 *
 * In build: copies the two files into dist/onnx-runtime/ so the production
 * bundle works identically without any CDN or internet.
 */
function onnxRuntimePlugin(): Plugin {
  const ONNX_FILES: Record<string, { file: string; mime: string }> = {
    'ort-wasm-simd-threaded.jsep.mjs':  { file: 'ort-wasm-simd-threaded.jsep.mjs',  mime: 'text/javascript' },
    'ort-wasm-simd-threaded.jsep.wasm': { file: 'ort-wasm-simd-threaded.jsep.wasm', mime: 'application/wasm' },
  }
  const distDir = resolve('node_modules', '@huggingface', 'transformers', 'dist')
  const PREFIX = '/onnx-runtime/'

  const middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith(PREFIX)) return next()
    const name = req.url.slice(PREFIX.length).split('?')[0]
    const entry = ONNX_FILES[name]
    if (!entry) return next()
    try {
      const content = readFileSync(join(distDir, entry.file))
      res.writeHead(200, {
        'Content-Type': entry.mime,
        'Content-Length': content.byteLength,
        'Cache-Control': 'no-cache',
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Resource-Policy': 'same-origin',
      })
      res.end(content)
    } catch {
      res.writeHead(404)
      res.end('ONNX runtime file not found.')
    }
  }

  return {
    name: 'onnx-runtime-server',
    configureServer(server) { server.middlewares.use(middleware) },
    configurePreviewServer(server) { server.middlewares.use(middleware) },
    writeBundle(options) {
      const outDir = options.dir ?? 'dist'
      const target = join(outDir, 'onnx-runtime')
      mkdirSync(target, { recursive: true })
      for (const entry of Object.values(ONNX_FILES)) {
        cpSync(join(distDir, entry.file), join(target, entry.file))
      }
    },
  }
}

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), '')
  return {
    optimizeDeps: { include: ['@huggingface/transformers'] },
    plugins: [react(), onnxRuntimePlugin(), baseDocumentsApi(environment.QDRANT_URL ?? '', environment.QDRANT_API_KEY ?? ''), onlineApi(environment.QDRANT_URL ?? '', environment.QDRANT_API_KEY ?? '')],
    server: { host: '127.0.0.1', headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }, proxy: { '/local-llm': { target: LOCAL_LLM_URL, rewrite: path => path.replace(/^\/local-llm/, '') } } },
    preview: { host: '127.0.0.1', headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }, proxy: { '/local-llm': { target: LOCAL_LLM_URL, rewrite: path => path.replace(/^\/local-llm/, '') } } },
  }
})
