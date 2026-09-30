import { generateLocalAnswer, LOCAL_MODEL } from '../generation.ts'
import { ONLINE_INSTRUCTION } from './types.ts'
const ANSWER_TOKENS = 320

/** Count the actual Qwen chat template before generation; never silently trim evidence. */
export async function generateOnlineAnswer(context:string, signal:AbortSignal, onText:(text:string)=>void, fetcher:typeof fetch=fetch) {
  const bounded=AbortSignal.any([signal,AbortSignal.timeout(120_000)])
  async function request(path:string,body?:unknown) {
    const response=await fetcher(`/local-llm${path}`,{signal:bounded,...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})})
    if(!response.ok)throw new Error(`Qwen local indisponível (${response.status}). Inicie o servidor local e tente novamente.`)
    return await response.json() as Record<string,any>
  }
  const props=await request('/props')
  const capacity=props.default_generation_settings?.n_ctx
  if(!Number.isInteger(capacity)||capacity<1)throw new Error('Não foi possível confirmar a janela de contexto do Qwen local.')
  const {prompt}=await request('/apply-template',{model:LOCAL_MODEL,messages:[{role:'system',content:ONLINE_INSTRUCTION},{role:'user',content:context}],add_generation_prompt:true,chat_template_kwargs:{enable_thinking:false}})
  if(typeof prompt!=='string'||!prompt)throw new Error('O Qwen não retornou o template usado para contar o contexto.')
  const {tokens}=await request('/tokenize',{content:prompt,add_special:true})
  if(!Array.isArray(tokens))throw new Error('O Qwen não confirmou a contagem de tokens.')
  if(tokens.length+ANSWER_TOKENS>capacity)throw new Error(`Contexto com ${tokens.length} tokens + ${ANSWER_TOKENS} de resposta excede a janela de ${capacity}. Reduza o top-k. Nenhum chunk foi cortado.`)
  return generateLocalAnswer(context,{signal:bounded,onText,instruction:ONLINE_INSTRUCTION,maxTokens:ANSWER_TOKENS,fetcher})
}
