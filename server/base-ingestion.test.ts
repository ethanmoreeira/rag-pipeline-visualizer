import { readFile, writeFile, mkdtemp, cp, rm } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareDocuments, readDocuments, computeChunkOffsets, parseCatalog, validateRecords, validateConfig, normalizeText } from './base-ingestion.ts'

test('Document Loader: carrega exatamente 10 documentos com metadados corretos', async () => {
  const documents = await readDocuments(process.cwd())
  assert.equal(documents.length, 10, 'Deve carregar 10 documentos')
  assert.equal(documents.filter(d => d.category === 'consumo').length, 10, '10 documentos de consumo')
  for (const [index, doc] of documents.entries()) {
    assert.equal(doc.id, `D${index + 1}`, `ID deve ser D${index + 1}`)
    assert.ok(doc.title.length > 0, `${doc.id} deve ter título`)
    assert.ok(doc.text.length >= 500, `${doc.id} deve ter pelo menos 500 caracteres`)
    assert.ok(doc.origin.startsWith('data/base/'), `${doc.id} deve ter origin correto`)
    assert.ok(doc.sha256.length === 64, `${doc.id} deve ter sha256`)
    assert.equal(doc.characters, doc.text.length, `${doc.id} characters deve corresponder ao text.length`)
    assert.ok(doc.institution.length > 0, `${doc.id} deve ter instituição`)
  }
})

test('Normalização: preserva acentos e conteúdo semântico', () => {
  assert.equal(normalizeText('\uFEFFa\r\n\r\n\r\nb  c'), 'a\n\nb c')
  assert.equal(normalizeText('café résumé naïve'), 'café résumé naïve')
  assert.equal(normalizeText('  espaço   duplo  '), 'espaço duplo')
  assert.equal(normalizeText('a\r\nb\rc'), 'a\nb\nc')
  // NFC normalization
  const decomposed = 'e\u0301' // é in NFD
  const normalized = normalizeText(decomposed)
  assert.equal(normalized, 'é', 'NFD deve ser convertido para NFC')
})

test('Chunking: RecursiveCharacterTextSplitter produz chunks corretos', async () => {
  const prepared = await prepareDocuments(process.cwd())
  assert.equal(prepared.documents.length, 10)
  assert.ok(prepared.chunks.length > 10, 'Deve produzir mais de 10 chunks')
  // All chunk IDs unique
  assert.equal(new Set(prepared.chunks.map(c => c.id)).size, prepared.chunks.length, 'IDs devem ser únicos')

  for (const doc of prepared.documents) {
    const docChunks = prepared.chunks.filter(c => c.documentId === doc.id)
    assert.ok(docChunks.length > 1, `${doc.id} deve ter mais de 1 chunk`)
    for (const [i, c] of docChunks.entries()) {
      assert.equal(c.id, `${doc.id}-C${i + 1}`, `Chunk ID correto: ${c.id}`)
      assert.equal(c.origin, doc.origin, `Origem correta: ${c.id}`)
      assert.ok(c.text.length <= prepared.config.chunkSize, `${c.id} não deve ultrapassar chunkSize`)
      assert.ok(c.text.length > 0, `${c.id} não deve ser vazio`)
    }
  }
})

test('Offsets: mapeamento sequencial correto com overlap', async () => {
  const prepared = await prepareDocuments(process.cwd())

  for (const doc of prepared.documents) {
    const docChunks = prepared.chunks.filter(c => c.documentId === doc.id)
    let previousEnd = -1

    for (const chunk of docChunks) {
      const offset = prepared.offsets[chunk.id]
      assert.ok(offset, `${chunk.id} deve ter offset`)
      assert.ok(offset.startChar >= 0, `${chunk.id} startChar >= 0`)
      assert.ok(offset.endChar > offset.startChar, `${chunk.id} endChar > startChar`)
      assert.ok(offset.endChar <= doc.text.length, `${chunk.id} endChar <= text.length`)

      // Verify the text at the offset position matches the chunk text
      const highlighted = doc.text.slice(offset.startChar, offset.endChar)
      assert.equal(highlighted, chunk.text, `${chunk.id}: texto destacado deve corresponder ao chunk`)

      // Verify overlap detection
      if (offset.overlapStart !== undefined && offset.overlapEnd !== undefined) {
        assert.ok(offset.overlapStart >= offset.startChar, `${chunk.id}: overlapStart >= startChar`)
        assert.ok(offset.overlapEnd <= offset.endChar, `${chunk.id}: overlapEnd <= endChar`)
        assert.ok(offset.overlapEnd > offset.overlapStart, `${chunk.id}: overlap deve ter tamanho positivo`)
        // The overlap region must be part of the previous chunk too
        assert.ok(previousEnd > offset.startChar, `${chunk.id}: overlap detectado implica previousEnd > startChar`)
      }

      // Verify sequential ordering — start must not be before previous start
      if (previousEnd > 0) {
        // With overlap, startChar can be before previousEnd, but not too far back
        assert.ok(offset.startChar >= previousEnd - prepared.config.chunkOverlap - 10,
          `${chunk.id}: startChar não deve recuar muito além do overlap configurado`)
      }

      previousEnd = offset.endChar
    }

    // Last chunk should reach near the end of the document
    const lastChunk = docChunks[docChunks.length - 1]
    const lastOffset = prepared.offsets[lastChunk.id]
    const remainingText = doc.text.slice(lastOffset.endChar).trim()
    assert.equal(remainingText, '', `${doc.id}: não deve haver texto significativo depois do último chunk`)
  }
})

test('Offsets: texto repetido não confunde mapeamento', async () => {
  const prepared = await prepareDocuments(process.cwd())
  // For documents that might have repeated phrases, check that offsets are monotonically advancing
  for (const doc of prepared.documents) {
    const docChunks = prepared.chunks.filter(c => c.documentId === doc.id)
    let lastStart = -1
    for (const chunk of docChunks) {
      const offset = prepared.offsets[chunk.id]
      assert.ok(offset.startChar > lastStart || lastStart === -1,
        `${chunk.id}: startChar (${offset.startChar}) deve avançar (lastStart: ${lastStart})`)
      lastStart = offset.startChar
    }
  }
})

test('Overlap visual corresponde ao overlap real', async () => {
  const prepared = await prepareDocuments(process.cwd())
  for (const doc of prepared.documents) {
    const docChunks = prepared.chunks.filter(c => c.documentId === doc.id)
    for (let i = 1; i < docChunks.length; i++) {
      const prev = prepared.offsets[docChunks[i - 1].id]
      const curr = prepared.offsets[docChunks[i].id]
      if (curr.startChar < prev.endChar) {
        // There IS real overlap
        assert.ok(curr.overlapStart !== undefined, `${docChunks[i].id}: overlap visual deve existir quando há sobreposição real`)
        assert.equal(curr.overlapStart, curr.startChar, `${docChunks[i].id}: overlapStart deve ser startChar`)
        assert.equal(curr.overlapEnd, prev.endChar, `${docChunks[i].id}: overlapEnd deve ser endChar do chunk anterior`)
        // Verify overlap text matches
        const overlapText = doc.text.slice(curr.overlapStart!, curr.overlapEnd!)
        assert.ok(docChunks[i - 1].text.endsWith(overlapText), `${docChunks[i].id}: overlap text deve ser sufixo do chunk anterior`)
        assert.ok(docChunks[i].text.startsWith(overlapText), `${docChunks[i].id}: overlap text deve ser prefixo do chunk atual`)
      } else {
        // No overlap — there should be no overlap markers
        assert.equal(curr.overlapStart, undefined, `${docChunks[i].id}: sem overlap real, sem marcador`)
      }
    }
  }
})

test('Configuração: validação rejeita valores inválidos', () => {
  for (const config of [{chunkSize:0,chunkOverlap:0},{chunkSize:350,chunkOverlap:350},{chunkSize:350,chunkOverlap:-1}]) {
    assert.throws(() => validateConfig(config))
  }
})

test('Fingerprint: configurações diferentes produzem collections diferentes', async () => {
  const a = await prepareDocuments(process.cwd())
  const b = await prepareDocuments(process.cwd(), { chunkSize: 250, chunkOverlap: 40 })
  assert.notEqual(a.collection, b.collection)
  assert.notEqual(a.chunks.length, b.chunks.length)
})

test('validateRecords rejeita array vazio', async () => {
  const prepared = await prepareDocuments(process.cwd())
  assert.throws(() => validateRecords([], prepared))
})

test('Contagens reais da execução', async () => {
  const prepared = await prepareDocuments(process.cwd())
  console.log(`Documentos: ${prepared.documents.length}`)
  console.log(`Chunks: ${prepared.chunks.length}`)
  console.log(`Offsets: ${Object.keys(prepared.offsets).length}`)
  console.log(`Collection: ${prepared.collection}`)
  const overlapping = Object.values(prepared.offsets).filter(o => o.overlapStart !== undefined).length
  console.log(`Chunks com overlap detectado: ${overlapping}`)
  for (const doc of prepared.documents) {
    const docChunks = prepared.chunks.filter(c => c.documentId === doc.id)
    console.log(`  ${doc.id} ${doc.title}: ${docChunks.length} chunks`)
  }
})


test('Catálogo: IDs independem da ordem; metadados obrigatórios e arquivos seguros', async () => {
  const raw = await readFile('data/base/catalogo.json','utf8')
  const original = JSON.parse(raw)
  const reversed = structuredClone(original)
  reversed.documents.reverse()
  assert.deepEqual(parseCatalog(JSON.stringify(reversed)),parseCatalog(raw))
  for (const mutate of [
    (c:any)=>{c.documents[1].id=c.documents[0].id},
    (c:any)=>{c.documents[0].file='../outside.md'},
    (c:any)=>{delete c.documents[0].source},
    (c:any)=>{c.documents[0].url='javascript:alert(1)'},
    (c:any)=>{c.documents[0].accessedAt='2026-02-30'},
  ]) {const changed=structuredClone(original);mutate(changed);assert.throws(()=>parseCatalog(JSON.stringify(changed)))}
})

test('Fonte e títulos ficam fora do conteúdo semântico; chunks preservam referência', async () => {
  const base=await prepareDocuments(process.cwd())
  for (const doc of base.documents) {
    assert.ok(doc.url.startsWith('https://'))
    assert.equal(doc.text,normalizeText(doc.originalText))
    assert.ok(!doc.text.startsWith('# '))
    for(const chunk of base.chunks.filter(c=>c.documentId===doc.id)){
      assert.notEqual(chunk.text,doc.title)
      assert.equal(chunk.characters,chunk.text.length)
      assert.equal(chunk.url,doc.url)
      assert.equal(chunk.accessedAt,doc.accessedAt)
      assert.equal(chunk.license,doc.license)
      assert.equal(doc.text.slice(chunk.startChar,chunk.endChar),chunk.text)
      assert.ok(!('originalText' in chunk))
    }
  }
})

test('Uma alteração apenas na referência gera outra versão da coleção', async () => {
  const fixture=await mkdtemp(join(tmpdir(),'rag-base-catalog-test-'))
  try {
    await cp('data',join(fixture,'data'),{recursive:true})
    const before=await prepareDocuments(fixture)
    const path=join(fixture,'data/base/catalogo.json')
    const catalog=JSON.parse(await readFile(path,'utf8'))
    catalog.documents[0].section+=' (revisada)'
    await writeFile(path,JSON.stringify(catalog))
    assert.notEqual((await prepareDocuments(fixture)).collection,before.collection)
  } finally {
    assert.equal(dirname(resolve(fixture)),resolve(tmpdir()))
    assert.ok(fixture.includes('rag-base-catalog-test-'))
    await rm(fixture,{recursive:true,force:true})
  }
})

test('Offsets cobrem conteúdo repetido e recusam perda de texto', () => {
  const offsets=computeChunkOffsets('abc def abc def',[{id:'C1',text:'abc def'},{id:'C2',text:'abc def'}])
  assert.deepEqual(offsets,{C1:{startChar:0,endChar:7},C2:{startChar:8,endChar:15}})
  assert.throws(()=>computeChunkOffsets('abc omitted def',[{id:'C1',text:'abc'},{id:'C2',text:'def'}]))
})
