export class OnlineHttpError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}
/** Only transient failures repeat. Each retry performs a new HTTP request. */
export async function onlineRequest<T>(path: string, body: unknown, signal: AbortSignal, onAttempt: (attempt: number) => void = () => {}, fetcher: typeof fetch = fetch): Promise<T> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    signal.throwIfAborted(); onAttempt(attempt)
    try {
      const response = await fetcher(`/api/online/${path}`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body), signal: AbortSignal.any([signal, AbortSignal.timeout(90_000)]) })
      if (!response.headers.get('content-type')?.includes('application/json')) throw new OnlineHttpError('API online indisponível. Reinicie o servidor da apresentação.', 400)
      const data = await response.json()
      if (!response.ok) throw new OnlineHttpError(data.error || `Falha HTTP ${response.status}`, response.status)
      return data as T
    } catch (error) {
      signal.throwIfAborted()
      const transient = error instanceof OnlineHttpError ? [429,502,503,504].includes(error.status) : error instanceof TypeError || (error instanceof Error && error.name === 'TimeoutError')
      if (!transient || attempt === 3) throw error
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(signal.reason) }
        const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, attempt * 500)
        signal.addEventListener('abort', abort, {once:true})
      })
    }
  }
  throw new Error('Tentativas esgotadas.')
}
