import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { mkdir, open, rename, stat, statfs, writeFile } from 'node:fs/promises'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const directory = path.join(root, '.runtime', 'models')
const repository = 'Qwen/Qwen3-4B-GGUF'
const revision = 'bc640142c66e1fdd12af0bd68f40445458f3869b'
const file = 'Qwen3-4B-Q4_K_M.gguf'
const expectedBytes = 2497280256
const expectedSha256 = '7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5'
const url = `https://huggingface.co/${repository}/resolve/${revision}/${file}`
const destination = path.join(directory, file), partial = `${destination}.part`
await mkdir(directory, { recursive: true })
const capacity = await statfs(directory)
if (!existsSync(destination)) {
  if (capacity.bavail * capacity.bsize < expectedBytes + 1024 ** 3) throw new Error('Espaço insuficiente para download e margem de segurança.')
  if (existsSync(partial)) throw new Error('Download parcial já existe; preserve-o e confira a tentativa anterior.')
  const response = await fetch(url, { signal: AbortSignal.timeout(15 * 60 * 1000) })
  if (!response.ok || !response.body || !response.url.startsWith('https://')) throw new Error(`Download HTTP ${response.status}`)
  let bytes = 0, progress = 0
  await pipeline(Readable.fromWeb(response.body), new Transform({ transform(chunk, _encoding, callback) {
    bytes += chunk.length
    if (bytes > expectedBytes) return callback(new Error('Download maior que o arquivo publicado.'))
    const percent = Math.floor(bytes / expectedBytes * 10) * 10
    if (percent > progress) { progress = percent; console.log(`Download: ${percent}%`) }
    callback(null, chunk)
  } }), createWriteStream(partial, { flags: 'wx' }))
}
const candidate = existsSync(destination) ? destination : partial
const bytes = (await stat(candidate)).size
const hash = createHash('sha256')
for await (const chunk of createReadStream(candidate)) hash.update(chunk)
const sha256 = hash.digest('hex')
if (bytes !== expectedBytes || sha256 !== expectedSha256) throw new Error('Tamanho ou SHA-256 diferente do modelo oficial. Arquivo não ativado.')
const handle = await open(candidate, 'r')
const magic = Buffer.alloc(4)
try { await handle.read(magic, 0, 4, 0) } finally { await handle.close() }
if (magic.toString() !== 'GGUF') throw new Error('Cabeçalho GGUF ausente.')
if (candidate === partial) await rename(partial, destination)
const manifest = { downloadedAt: new Date().toISOString(), repository, revision, url, file, bytes, sha256, verifiedAgainstPublishedLfs: true, quantization: 'Q4_K_M', runtime: 'llama.cpp b10793 existente', previousModelRemoved: false }
await writeFile(path.join(root, '.runtime', 'qwen4b-download.json'), JSON.stringify(manifest, null, 2))
console.log(JSON.stringify(manifest, null, 2))
