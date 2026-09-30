import { env, pipeline, mean_pooling, type Tensor } from '@huggingface/transformers'
import { DIMENSIONS, MODEL } from '../corpus'
import type { Chunk, ChunkRecord, PreparationMessage } from './preparation'

env.allowRemoteModels = false
env.allowLocalModels = true
env.localModelPath = '/models/'
if (env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = '/onnx-runtime/'
type Encoder = { tokenizer: {
  (texts:string[], options:{padding:boolean;truncation:boolean}): {input_ids:Tensor;attention_mask:Tensor}
  encode:(text:string,options:{add_special_tokens:boolean})=>(number|bigint)[]
};model:(inputs:{input_ids:Tensor;attention_mask:Tensor})=>Promise<Record<string,Tensor>> }
let encoderPromise: Promise<Encoder> | null = null
let running = false
const send = (message:PreparationMessage) => self.postMessage(message)
self.onmessage = async ({data}:MessageEvent<{documents:Chunk[]}>) => {
  if (running) return
  running = true
  try {
    send({type:'loading'})
    encoderPromise ??= pipeline('feature-extraction', MODEL, {dtype:'q8',device:'wasm'}) as unknown as Promise<Encoder>
    const encoder = await encoderPromise
    const records:ChunkRecord[] = []
    // Somente documentos: nenhuma consulta é criada ou codificada nesta cena.
    for (const document of data.documents) {
      send({type:'processing',id:document.id})
      const started = performance.now()
      const tokenCount = encoder.tokenizer.encode(document.text,{add_special_tokens:true}).length
      if (tokenCount > 128 || tokenCount < 1) throw new Error(`${document.id}: tamanho inválido; o texto não foi truncado.`)
      const inputs = encoder.tokenizer([document.text],{padding:true,truncation:false})
      const outputs = await encoder.model(inputs)
      const hidden = outputs.last_hidden_state ?? outputs.token_embeddings ?? outputs.logits
      if (!hidden || hidden.dims.length !== 3 || hidden.dims[2] !== DIMENSIONS) throw new Error(`${document.id}: o modelo não retornou 384 dimensões.`)
      const embedding = (mean_pooling(hidden,inputs.attention_mask).normalize(2,-1).tolist() as number[][])[0]
      if (embedding.length !== DIMENSIONS || embedding.some(n=>!Number.isFinite(n)) || Math.abs(Math.hypot(...embedding)-1)>1e-4) throw new Error(`${document.id}: vetor inválido.`)
      const record:ChunkRecord = {...document,embedding,dimensions:embedding.length,model:MODEL,tokenCount,elapsedMs:performance.now()-started}
      records.push(record)
      send({type:'document',record})
    }
    send({type:'complete',records})
  } catch (error) { encoderPromise=null;send({type:'error',message:error instanceof Error?error.message:'Falha no MiniLM local.'}) }
  finally { running=false }
}
