import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { LOCAL_MODEL, LOCAL_MODEL_FILE, LOCAL_LLM_PORT, LOCAL_LLM_URL, LOCAL_CONTEXT_SIZE } from '../src/ai/localModel.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const executable = path.join(root, '.runtime', 'llama', 'llama-server.exe')
const model = path.join(root, '.runtime', 'models', LOCAL_MODEL_FILE)
const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')
const address = 'http://127.0.0.1:5173'
const children = []
let stopping = false
function stop(code = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) child.kill()
  process.exitCode = code
}
process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())
process.on('exit', () => { for (const child of children) child.kill() })
async function health() {
  try { return (await fetch(`${LOCAL_LLM_URL}/health`, {signal: AbortSignal.timeout(1500)})).ok } catch { return false }
}
async function existingUI() {
  try {
    const response = await fetch(address, {signal: AbortSignal.timeout(1500)})
    const html = await response.text()
    if (response.ok && html.includes('Grupo 7 | Embeddings, Busca Semântica e RAG')) {
      const api = await fetch(`${address}/api/base/documents`, {signal: AbortSignal.timeout(1500)})
      const contentType = api.headers.get('content-type') ?? ''
      if (api.ok && contentType.includes('application/json')) return true
      throw new Error('A apresentação está aberta, mas a API local da Base não está disponível. Reinicie o iniciador para carregar o servidor Vite atual.')
    }
    throw new Error('A porta 5173 está ocupada por outro aplicativo. Nenhum processo foi encerrado.')
  } catch (error) {
    if (error.message?.includes('outro aplicativo') || error.message?.includes('API local da Base')) throw error
    return false
  }
}
function launch(command, args) {
  const child = spawn(command, args, {cwd: root, stdio: 'inherit', windowsHide: true})
  children.push(child)
  child.on('error', error => {console.error(error.message); stop(1)})
  return child
}

if (!existsSync(vite)) throw new Error('Dependências ausentes na pasta do projeto.')
// Conferir a interface ANTES de iniciar processos; reutilizar o Vite aberto é normal.
const reuseUI = await existingUI()
if (!await health()) {
  if (!existsSync(executable) || !existsSync(model)) throw new Error('Motor ou modelo ausente. Confira a pasta .runtime.')
  console.log(`Preparando ${LOCAL_MODEL} local · Q4_K_M…`)
  const motor = launch(executable, ['-m', model, '--alias', LOCAL_MODEL, '-c', String(LOCAL_CONTEXT_SIZE), '-t', '8', '--host', '127.0.0.1', '--port', String(LOCAL_LLM_PORT), '--cors-origins', 'localhost', '--parallel', '1', '--jinja', '-ngl', '0'])
  motor.on('exit', code => {if (!stopping) {console.error(`Motor local encerrou (${code}).`); stop(1)}})
  let ready = false
  for (let i = 0; i < 120 && !stopping; i++) {
    if (await health()) {ready = true; break}
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  if (!ready) {console.error('Qwen não ficou pronto. Verifique os registros acima.'); stop(1)}
} else {
  const response = await fetch(`${LOCAL_LLM_URL}/v1/models`, {signal: AbortSignal.timeout(2000)})
  const models = await response.json()
  if (!response.ok || !models.data?.some(item => item.id === LOCAL_MODEL)) throw new Error(`A porta ${LOCAL_LLM_PORT} está servindo outro modelo. Nenhum processo foi encerrado.`)
  console.log('Qwen local já está pronto.')
}
if (!stopping) {
  if (reuseUI) console.log(`React já está aberto. Apresentação pronta em ${address}`)
  else {
    const args = [vite, '--configLoader', 'runner', '--host', '127.0.0.1', '--port', '5173', '--strictPort']
    if (!process.argv.includes('--no-open')) args.push('--open')
    const ui = launch(process.execPath, args)
    ui.on('exit', code => stop(code ?? 0))
  }
  console.log('Mantenha este iniciador aberto durante o ensaio. Ctrl+C encerra somente os processos iniciados aqui.')
}
