import { LOCAL_MODEL } from '../ai/localModel.ts'
export { LOCAL_MODEL }
export const SYSTEM_INSTRUCTION = 'Responda em português à necessidade apresentada, em até 70 palavras, usando somente os textos fornecidos. Cite os IDs das evidências entre colchetes em cada sugestão. Respeite os fatos declarados na consulta. Reconheça que os textos não determinam a causa exata. Não invente fatos, não repita a consulta e não descreva estas instruções. Escreva um único parágrafo, sem títulos.'

export type GenerationResult = { text: string; firstTextMs: number; totalMs: number; model: string; finishReason?: 'stop'; usage?: {promptTokens:number;completionTokens:number} }
type GenerationOptions = { signal?: AbortSignal; onText?: (text: string) => void; fetcher?: typeof fetch; instruction?: string; maxTokens?: number }

/** Consome a resposta do servidor real. Interrupção e limite não viram resposta pronta. */
export async function generateLocalAnswer(context: string, options: GenerationOptions = {}): Promise<GenerationResult> {
  if (!context.trim()) throw new Error('Monte o contexto antes de chamar a LLM.')
  const started = performance.now()
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000)
  const request = options.fetcher ?? fetch
  signal.throwIfAborted()
  const modelsResponse = await request('/local-llm/v1/models', { signal })
  if (!modelsResponse.ok) throw new Error('O Qwen local não está pronto. Inicie a apresentação pelo arquivo iniciar-apresentacao.cmd.')
  const models = await modelsResponse.json() as {data?:{id:string}[]}
  if (!models.data?.some((model: { id: string }) => model.id === LOCAL_MODEL)) throw new Error(`O servidor local não está servindo o ${LOCAL_MODEL} esperado.`)
  const response = await request('/local-llm/v1/chat/completions', {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: LOCAL_MODEL, messages: [{ role: 'system', content: options.instruction ?? SYSTEM_INSTRUCTION }, { role: 'user', content: context }], temperature: 0, max_tokens: options.maxTokens ?? 256, stream: true, stream_options: { include_usage: true }, chat_template_kwargs: { enable_thinking: false } }),
  })
  if (!response.ok) throw new Error(`O Qwen recusou a geração (${response.status}). Confira o iniciador local.`)
  if (!response.body) throw new Error('O servidor não enviou uma resposta em fluxo.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = '', text = '', finishReason = '', ended = false, firstTextMs = 0
  let usage: GenerationResult['usage']
  function consume(line: string) {
    if (!line.startsWith('data:')) return
    const payload = line.slice(5).trim()
    if (!payload) return
    if (payload === '[DONE]') { ended = true; return }
    const event = JSON.parse(payload)
    if (event.error) throw new Error(event.error.message || 'O servidor interrompeu a geração.')
    if (Number.isInteger(event.usage?.prompt_tokens) && Number.isInteger(event.usage?.completion_tokens)) usage = {promptTokens:event.usage.prompt_tokens,completionTokens:event.usage.completion_tokens}
    const choice = event.choices?.[0]
    if (choice?.finish_reason) finishReason = choice.finish_reason
    const delta = choice?.delta?.content
    if (typeof delta === 'string' && delta) {
      if (!text) firstTextMs = performance.now() - started
      text += delta
      options.onText?.(text)
    }
  }
  try {
    while (!ended) {
      signal.throwIfAborted()
      const chunk = await reader.read()
      buffer += decoder.decode(chunk.value, { stream: !chunk.done })
      let newline: number
      while ((newline = buffer.indexOf('\n')) >= 0) {
        consume(buffer.slice(0, newline).replace(/\r$/, ''))
        buffer = buffer.slice(newline + 1)
      }
      if (chunk.done) { if (buffer.trim()) consume(buffer); break }
    }
    signal.throwIfAborted()
    if (!text.trim()) throw new Error('O Qwen não produziu texto. Nenhuma resposta foi substituída por exemplo.')
    if (finishReason === 'length') throw new Error('A resposta atingiu o limite e ficou incompleta. Execute novamente; o texto parcial permanece identificado.')
    if (!ended || finishReason !== 'stop') throw new Error('A conexão terminou antes da confirmação de resposta completa.')
    return { text: text.trim(), firstTextMs, totalMs: performance.now() - started, model: LOCAL_MODEL, finishReason: 'stop', ...(usage?{usage}:{}) }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
