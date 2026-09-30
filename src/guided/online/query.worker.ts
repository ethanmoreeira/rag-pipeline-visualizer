import { env, pipeline } from '@huggingface/transformers'
import { MODEL } from '../corpus.ts'
import { encodeQuery, type QueryEncoder } from './encoder.ts'
env.allowRemoteModels = false
env.allowLocalModels = true
env.localModelPath = '/models/'
if (env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = '/onnx-runtime/'
let encoder: Promise<QueryEncoder> | null = null
self.onmessage = async ({data}: MessageEvent<{query:string}>) => {
  try {
    self.postMessage({type:'phase',text:'Carregando MiniLM local…'})
    encoder ??= pipeline('feature-extraction',MODEL,{dtype:'q8',device:'wasm'}) as unknown as Promise<QueryEncoder>
    const loaded = await encoder
    self.postMessage({type:'phase',text:'Executando a consulta uma vez no MiniLM…'})
    self.postMessage({type:'ready',embedding:await encodeQuery(loaded,data.query)})
  } catch(error) {
    encoder = null
    self.postMessage({type:'error',text:error instanceof Error?error.message:'Falha no MiniLM local.'})
  }
}
