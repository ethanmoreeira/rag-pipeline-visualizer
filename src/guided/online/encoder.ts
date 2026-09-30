import { mean_pooling, type Tensor } from '@huggingface/transformers'
import { MODEL, DIMENSIONS } from '../corpus.ts'
import { validateSnapshot } from '../engine.ts'
import type { QueryEmbedding } from './types.ts'

export type QueryEncoder = {
  tokenizer: {
    (text: string[], options: {padding:boolean;truncation:boolean}): {input_ids:Tensor;attention_mask:Tensor}
    encode: (text:string, options:{add_special_tokens:boolean}) => (number|bigint)[]
    model: {convert_ids_to_tokens:(ids:number[])=>string[]}
    all_special_ids:number[]
  }
  model: (inputs:{input_ids:Tensor;attention_mask:Tensor}) => Promise<Record<string,Tensor>>
}
/** One forward pass. Its exact states and mask produce every value shown in 02. */
export async function encodeQuery(encoder: QueryEncoder, text: string): Promise<QueryEmbedding> {
  if (!text.trim()) throw new Error('Escolha uma consulta na página 01.')
  const count = encoder.tokenizer.encode(text,{add_special_tokens:true}).length
  if (count > 128) throw new Error(`A consulta tem ${count} tokens. Reduza para até 128; não houve truncamento.`)
  const started = performance.now()
  const inputs = encoder.tokenizer([text],{padding:true,truncation:false})
  const output = await encoder.model(inputs)
  const hidden = output.last_hidden_state ?? output.token_embeddings
  if (!hidden || hidden.dims.length!==3 || hidden.dims[2]!==DIMENSIONS) throw new Error('O MiniLM não retornou estados contextuais 384D.')
  const ids = (inputs.input_ids.tolist() as (number|bigint)[][])[0].map(Number)
  const attentionMask = (inputs.attention_mask.tolist() as (number|bigint)[][])[0].map(Number)
  const states = (hidden.tolist() as number[][][])[0]
  const pieces = encoder.tokenizer.model.convert_ids_to_tokens(ids)
  const pooledTensor = mean_pooling(hidden,inputs.attention_mask)
  const pooled = (pooledTensor.tolist() as number[][])[0]
  const vector = (pooledTensor.normalize(2,-1).tolist() as number[][])[0]
  const result: QueryEmbedding = {text,model:MODEL,elapsedMs:performance.now()-started,attentionMask,pooled,vector,tokens:ids.flatMap((id,i)=>attentionMask[i]===1?[{id,piece:pieces[i],special:encoder.tokenizer.all_special_ids.includes(id),hidden:states[i]}]:[])}
  validateSnapshot({query:result,documents:[],dimension:DIMENSIONS,model:MODEL,elapsedMs:result.elapsedMs})
  return result
}
