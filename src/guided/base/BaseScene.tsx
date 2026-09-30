import { useEffect, useState, useRef, type CSSProperties } from 'react'
import { Play, AlertCircle } from 'lucide-react'
import { MODEL, DIMENSIONS } from '../corpus'
import { Modal, Title } from '../ui'
import { type useBasePreparation, type Phase } from './useBasePreparation.ts'
import type { BaseDocument, Chunk, ChunkOffset } from './preparation.ts'
import './base.css'
import { useReplay } from '../online/useReplay'

function ChunkingVisualizer({ doc, chunks, offsets, onComplete, live }: { doc: BaseDocument, chunks: Chunk[], offsets: Record<string, ChunkOffset>, onComplete: () => void, live: boolean }) {
  const replay = useReplay(doc, chunks.length + 1, 2100)
  const revealed = replay.frame
  const scrollRef = useRef<HTMLDivElement>(null)
  const originalRef = useRef<HTMLDivElement>(null)
  const finished = useRef(false)

  useEffect(() => {
    const active = originalRef.current?.querySelector('mark.b0-active') as HTMLElement | null
    if (active && originalRef.current) originalRef.current.scrollTop = active.offsetTop - originalRef.current.offsetTop - 48
    if (scrollRef.current && revealed > 0) {
      const activeEl = scrollRef.current.querySelector('.b0-chunk-active')
      if (activeEl) scrollRef.current.scrollTop = (activeEl as HTMLElement).offsetTop - scrollRef.current.offsetTop - 12
    }
  }, [revealed])
  useEffect(() => {
    if (live && chunks.length && revealed === chunks.length && !finished.current) {
      finished.current = true
      onComplete()
    }
  }, [live, chunks.length, revealed, onComplete])

  // Build the original text with highlights
  const textNodes = []
  let cursor = 0
  
  // To avoid overlapping highlights incorrectly in React, we just highlight based on the active chunk.
  // The active chunk is chunks[revealed - 1]
  const activeChunk = revealed > 0 && revealed <= chunks.length ? chunks[revealed - 1] : null
  const activeOffset = activeChunk ? offsets[activeChunk.id] : null

  if (activeOffset) {
    if (activeOffset.startChar > cursor) {
      textNodes.push(<span key="before">{doc.text.slice(cursor, activeOffset.startChar)}</span>)
    }
    if (activeOffset.overlapStart !== undefined && activeOffset.overlapEnd !== undefined) {
      // highlight overlap
      textNodes.push(<mark key="overlap" className="b0-overlap" title="Overlap">{doc.text.slice(activeOffset.overlapStart, activeOffset.overlapEnd)}</mark>)
      textNodes.push(<mark key="active" className="b0-active">{doc.text.slice(activeOffset.overlapEnd, activeOffset.endChar)}</mark>)
    } else {
      textNodes.push(<mark key="active" className="b0-active">{doc.text.slice(activeOffset.startChar, activeOffset.endChar)}</mark>)
    }
    cursor = activeOffset.endChar
  }
  if (cursor < doc.text.length) {
    textNodes.push(<span key="after">{doc.text.slice(cursor)}</span>)
  }

  return (
    <div className="b0-chunking-viz">
      <div className="b0-cut-progress" aria-live="polite"><strong>{revealed ? `Corte ${revealed} de ${chunks.length}` : 'Texto inteiro'}</strong><span>{activeOffset ? `caracteres ${activeOffset.startChar}–${activeOffset.endChar}` : 'Limites dos chunks no texto.'}</span></div>
      <section>
        <div className="b0-chunking-header">
          <b>{doc.id} · Texto normalizado</b>
          <small>{doc.characters} caracteres</small>
        </div>
        <div className="b0-original-text" ref={originalRef}>{textNodes}</div>
      </section>
      <section>
        <div className="b0-chunking-header">
          <b>Trechos que saem do texto</b>
          <small>{revealed} / {chunks.length}</small>
        </div>
        <div className="b0-chunk-list" ref={scrollRef}>
          {chunks.slice(0, revealed).map((c, i) => {
            const isActive = i === revealed - 1
            const isOverlap = offsets[c.id]?.overlapStart !== undefined
            return (
              <div key={c.id} style={{'--chunk-accent':chunkAccents[i%chunkAccents.length]} as CSSProperties} className={`b0-chunk-card ${isActive ? 'b0-chunk-active' : 'b0-chunk-done'}`}>
                <header>
                  <b>{c.id}</b>
                  <small>{c.text.length} caracteres {isOverlap && '· com overlap'}</small>
                </header>
                <p>{c.text}</p>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}

const stepOrder: Phase[] = ['parsing','normalizing','metadata','chunking','embedding','saving','ready']
const steps = [
  {phase:'parsing',verb:'CARREGAR',technical:'Ingestão/parsing',help:'LangChain · TextLoader lê o arquivo; catálogo fornece origem.'},
  {phase:'normalizing',verb:'PREPARAR',technical:'Normalização',help:'Código próprio · Unicode, espaços e quebras de linha.'},
  {phase:'metadata',verb:'IDENTIFICAR',technical:'Metadados',help:'Título, origem e fonte do documento.'},
  {phase:'chunking',verb:'DIVIDIR',technical:'Chunking',help:'LangChain · RecursiveCharacterTextSplitter calcula os cortes.'},
  {phase:'embedding',verb:'REPRESENTAR',technical:'Embeddings',help:'MiniLM / Transformers.js · um vetor 384D por chunk.'},
  {phase:'saving',verb:'INDEXAR',technical:'Qdrant',help:'Qdrant · persiste ID, vetor e payload de cada chunk.'},
  {phase:'ready',verb:'BASE PRONTA',technical:'Validação concluída',help:'ID, vetor e texto no Qdrant.'},
] as const
const nextLabels: Partial<Record<Phase,string>> = {parsing:'Normalização',normalizing:'Metadados',metadata:'Dividir documentos',chunked:'Gerar embeddings',awaitingSave:'Salvar no Qdrant'}

export function BaseScene({ onBusy, base }: { onBusy: (busy: boolean) => void; base: ReturnType<typeof useBasePreparation> }) {
  const [selected,setSelected]=useState<string|null>(null)
  const [inspection,setInspection]=useState<Phase|null>(null)
  const displayPhase=base.phase==='ready'?(inspection??'idle'):base.phase
  useEffect(()=>{onBusy(base.busy);return()=>onBusy(false)},[base.busy,onBusy])
  const doc=base.documents.find(d=>d.id===selected)
  const example=base.documents.find(d=>d.id==='D1')
  const metadataDocument=doc??example
  const chunks=base.prepared?.chunks??[]
  const ready=base.phase==='ready'
  const showingChunks=['chunking','chunked'].includes(displayPhase)
  const phase=base.phase==='reading'?'parsing':base.phase==='splitting'?'chunking':base.phase==='loading'?'embedding':base.phase==='chunked'?'chunking':['awaitingSave','saving','validating'].includes(base.phase)?'saving':base.phase
  const current=stepOrder.indexOf(phase)
  const stepState=(index:number)=>ready?(steps[index].phase===displayPhase?'active':'waiting'):current<0?'waiting':index<current?'done':index===current?'active':'waiting'
  const activeRecord=ready?base.records.find(record=>record.documentId==='D1'):base.records.at(-1)
  const embeddingReplay=useReplay(displayPhase==='embedding'&&ready?base.prepared:null,chunks.length+1,85)
  const visibleEmbeddings=ready?Math.min(embeddingReplay.frame,base.records.length):base.records.length
  const [vectorOpen,setVectorOpen]=useState(false)
  return <>
    <Title eyebrow="00 · BASE" title="Documentos → chunks → vetores → Qdrant">
      RAG especializado em consumo residencial de energia elétrica: consumo, conta, tarifas, eficiência, aparelhos e hábitos de uso.
    </Title>
    <div className="b0-workspace">
      <aside className="b0-sources">
        <h2>Fonte documental <span>{base.documents.length}</span></h2>
        <p>{base.documents.length} documentos locais preparados a partir de fontes públicas.</p>
        <div className="b0-cards" aria-label="Documentos da Base">
          {base.documents.map(item=><button key={item.id} title={`${item.id} · ${item.title}`} aria-label={`Abrir ${item.id}: ${item.title}`} aria-pressed={selected===item.id} className={base.currentId.startsWith(`${item.id}-`)?'b0-processing':''} onClick={()=>setSelected(item.id)}>
            <span className="s-id">{item.id}</span><span><strong>{item.title}</strong><small>{item.institution}</small></span>
          </button>)}
        </div>
      </aside>
      <section className="b0-process" aria-label="Preparação da base">
        <div className="b0-section-heading"><h2>{displayPhase==='idle'?'Fontes da Base':steps.find(step=>step.phase===displayPhase)?.technical??'Preparação da Base'}</h2></div>
        <nav className="b0-pipeline" aria-label="Etapas da Base">
          <button className="b0-source-step" aria-current={displayPhase==='idle'?'step':undefined} onClick={()=>setInspection(null)} disabled={!ready&&base.busy}><span>00</span><b>FONTES <em>· documentos</em></b></button>
          {steps.map((step,index)=><article key={step.phase} className="b0-pipeline-step" data-step={step.phase} data-state={stepState(index)}>
            <button className="b0-inspect-step" disabled={!ready} onClick={()=>setInspection(step.phase)} aria-current={displayPhase===step.phase?'step':undefined} aria-label={`Mostrar ${step.technical}`}><span>{String(index+1).padStart(2,'0')}</span><b>{step.verb} <em>· {step.technical}</em></b></button>
          </article>)}
        </nav>
        {displayPhase==='idle'&&example&&<section className="b0-evidence b0-source-preview"><span className="s-label">DOCUMENTO ORIGINAL</span><h3>{example.id} · {example.title}</h3><p>{example.originalText.split('.')[0].trim()}.</p><small>Fonte: {example.institution}</small></section>}
        {!ready&&<div className="s-actions b0-actions">{!base.busy&&<button className="s-primary" disabled={base.phase==='checking'} onClick={()=>{setSelected(null);setInspection(null);void base.prepare()}}><Play size={18}/>Preparar Base</button>}{nextLabels[base.phase]&&<button className="s-primary" onClick={base.advance}>{nextLabels[base.phase]}</button>}{base.busy&&<span role="status">{base.phase==='embedding'?`MiniLM: ${base.currentId}`:base.phase==='saving'?'Salvando no Qdrant…':base.phase==='validating'?'Conferindo os registros…':'Preparando a Base…'}</span>}</div>}
        {base.error&&<p className="b0-error" role="alert"><AlertCircle size={16}/> {base.error}</p>}
        {example&&['parsing','normalizing','metadata'].includes(displayPhase)&&<section className="b0-evidence">
          <h3>{displayPhase==='parsing'?'Arquivo local → Document':displayPhase==='normalizing'?'Texto carregado → texto normalizado':'Documento → conteúdo + metadados'}</h3>
          <p className="b0-stage-caption">{steps.find(step=>step.phase===displayPhase)?.help}</p>
          {displayPhase==='parsing'&&<><div className="b0-evidence-pair b0-loader-flow"><article><b>Arquivo local</b><strong>{example.file}</strong><small>Formato: Markdown (.md)<br/>Codificação: UTF-8<br/>Tamanho: {example.originalText.length} caracteres</small><label>Prévia do arquivo</label><pre>{example.originalText.slice(0,180)}{example.originalText.length>180?'…':''}</pre><button className="b0-text-button" onClick={()=>setSelected(example.id)}>Ver arquivo completo</button></article><div className="b0-flow-arrow">↓</div><article><b>TextLoader</b><small>Lê o conteúdo do arquivo.</small><small className="b0-loader-tech">LangChain<br/>UTF-8 · Markdown</small></article><div className="b0-flow-arrow">↓</div><article><b>Document</b><ul className="b0-document-tree"><li>pageContent: texto carregado</li><li>metadata: origem preservada</li></ul></article></div></>}
          {displayPhase==='normalizing'&&<><div className="b0-normalize-summary"><article><b>Arquivo lido</b><strong>{example.originalText.length}</strong><small>caracteres</small></article><span>→</span><article><b>Texto preparado</b><strong>{example.characters}</strong><small>caracteres</small></article></div><div className="b0-evidence-pair b0-normalize-comparison"><article><b>Antes · formatação irregular</b><NormalizationText before={example.originalText} after={example.text} side="before"/></article><article><b>Depois · formatação padronizada</b><NormalizationText before={example.originalText} after={example.text} side="after"/></article></div><small>Espaços, tabulações e linhas vazias são padronizados. As palavras e os números permanecem iguais.</small></>}
          {displayPhase==='metadata'&&metadataDocument&&<><h3>Identidade do documento</h3><div className="b0-identity-grid"><div><span>ID</span><strong>{metadataDocument.id}</strong></div><div className="b0-identity-title"><span>Título</span><strong>{metadataDocument.title}</strong></div><div><span>Instituição</span><strong>{metadataDocument.institution}</strong></div><div><span>Categoria</span><strong>{metadataDocument.category}</strong></div><div><span>Fonte</span><strong><a href={metadataDocument.url} target="_blank" rel="noreferrer">Publicação original ↗</a></strong></div><div className="b0-identity-origin"><span>Origem do arquivo</span><strong>{metadataDocument.origin}</strong></div></div><details><summary>Origem dos metadados</summary><p>Título, origem e instituição vêm do catálogo. Hash e tamanho são calculados na leitura; IDs e posições dos chunks são acrescentados depois.</p></details></>}
        </section>}
        {showingChunks&&example&&base.prepared&&<section className="b0-chunk-demonstration"><h3>Texto → cortes → chunks</h3><AllChunks key={base.prepared.collection} documents={base.documents} chunks={chunks} onComplete={base.completeChunking} live={!ready}/><details><summary>Ver cortes e overlap</summary><ChunkingVisualizer doc={example} chunks={chunks.filter(c=>c.documentId==='D1')} offsets={base.prepared.offsets} live={false} onComplete={base.completeChunking}/></details></section>}
        {activeRecord&&displayPhase==='embedding'&&<section className="b0-evidence b0-embedding-stage">
          <h3>Chunks → MiniLM → vetores 384D</h3>
          <div className="b0-embedding-progress" aria-label="Embeddings"><progress max={chunks.length} value={visibleEmbeddings}/><b>{visibleEmbeddings}/{chunks.length} embeddings</b></div>
          <div className="b0-vector-grid">{chunks.map((chunk,i)=><span key={chunk.id} data-ready={i<visibleEmbeddings}>{chunk.id}<small>{i<visibleEmbeddings?'→ 384D':'→ vetor'}</small></span>)}</div>
          <button onClick={()=>setVectorOpen(true)}>Abrir vetor · {activeRecord.id}</button>
        </section>}
        {activeRecord&&['awaitingSave','saving','validating'].includes(displayPhase)&&<section className="b0-evidence"><h3>1 chunk = 1 embedding = 1 point</h3><p>Point é o registro do Qdrant: ID, vetor e payload. O payload guarda o texto e sua origem.</p><div className="b0-point"><article><b>ID do point</b><p>{chunks.findIndex(c=>c.id===activeRecord.id)+1}</p></article><article><b>Vetor · {activeRecord.dimensions}D</b><p>[{activeRecord.embedding.slice(0,4).map(v=>v.toFixed(4)).join(', ')}, …]</p></article><article><b>Payload · {activeRecord.id}</b><p>{activeRecord.text}</p><small>{activeRecord.source} · {activeRecord.documentId}</small></article></div><p className="b0-stage-result">{base.savedCount} points indexados</p></section>}
        {displayPhase==='ready'&&<section className="b0-evidence"><h3>Base pronta para recuperação semântica</h3><p>{base.documents.length} documentos → {chunks.length} chunks → {base.records.length} embeddings → {base.savedCount} points</p><small>A consulta usa o mesmo MiniLM.</small></section>}
        {!base.busy&&!ready&&!base.error&&<p className="b0-intro">A Base reúne documentos sobre consumo residencial e uso eficiente da energia.</p>}
        {displayPhase!=='idle'&&<details className="b0-details"><summary>Modelo e chunking</summary><div>
          {base.persistenceNotice&&<p>Verificação inicial indisponível: {base.persistenceNotice}</p>}
          <p>Split: {base.config.chunkSize} caracteres; sobreposição máxima de {base.config.chunkOverlap}. Separadores: parágrafos, linhas, espaços e caracteres. A sobreposição efetiva depende dos cortes.</p>
          <p>{MODEL} · ONNX q8 · WASM · mean pooling · L2 · {DIMENSIONS} dimensões. Limite verificado: 128 tokens, sem truncamento silencioso.</p>
          {base.prepared&&<p>Coleção: <code>{base.prepared.collection}</code></p>}
        </div></details>}
      </section>
    </div>
    {vectorOpen&&activeRecord&&<Modal title={`Vetor · ${activeRecord.id} · ${activeRecord.dimensions} dimensões`} close={()=>setVectorOpen(false)}><pre>{activeRecord.embedding.map((v,i)=>`d${i+1}: ${v}`).join('\n')}</pre></Modal>}
    {doc&&<Modal title={`${doc.id} · ${doc.title}`} close={()=>setSelected(null)}><div className="b0-document-detail">
      <p><b>{doc.source}</b> · {doc.section}<br/><a href={doc.url} target="_blank" rel="noreferrer">Publicação original ↗</a> · acesso em {doc.accessedAt}<br/>{doc.licenseUrl ? <a href={doc.licenseUrl} target="_blank" rel="noreferrer">{doc.license}</a> : 'Licença da fonte não declarada; síntese local do projeto.'}</p>
      <small>{doc.adaptation}</small>
      <details open><summary>Documento local usado na base</summary><div className="b0-original">{doc.originalText}</div></details>
      <details><summary>Procedência e metadados</summary><pre>{JSON.stringify({id:doc.id,title:doc.title,file:doc.file,institution:doc.institution,url:doc.url,source:doc.source,section:doc.section},null,2)}</pre></details>

    </div></Modal>}
  </>
}

function NormalizationText({before,after,side}:{before:string;after:string;side:'before'|'after'}) {
  const text=side==='before'?before:after
  return <><pre className="b0-readable-text">{text.slice(0,740)}{text.length>740?'…':''}</pre><details><summary>Texto completo</summary><pre className="b0-readable-text">{text}</pre></details></>
}

const chunkAccents=['#87a8cc','#a9b9cc','#73999e','#999ebd','#b4bbc8','#829eae','#a0afb8']
function AllChunks({documents,chunks,live,onComplete}:{documents:BaseDocument[];chunks:Chunk[];live:boolean;onComplete:()=>void}) {
  const [index,setIndex]=useState(0)
  const [playing,setPlaying]=useState(true)
  const active=chunks[index]
  useEffect(()=>{
    if(!playing||index>=chunks.length-1)return
    const timer=window.setTimeout(()=>setIndex(i=>Math.min(i+1,chunks.length-1)),900)
    return()=>window.clearTimeout(timer)
  },[playing,index,chunks.length])
  const inspect=(next:number)=>{setPlaying(false);setIndex(next)}
  useEffect(()=>{if(live&&chunks.length&&index===chunks.length-1)onComplete()},[index,chunks.length,live,onComplete])
  return <><div className="b0-chunk-controls"><strong>{index+1}/{chunks.length}</strong></div><div className="b0-chunk-explorer"><div className="b0-all-chunks">{documents.map(doc=><div key={doc.id}><button className="b0-doc-jump" aria-label={`Chunks de ${doc.id}`} onClick={()=>inspect(chunks.findIndex(c=>c.documentId===doc.id))}>{doc.id}</button><div>{chunks.filter(c=>c.documentId===doc.id).map((chunk,i)=><button key={chunk.id} style={{'--chunk-accent':chunkAccents[i%chunkAccents.length]} as CSSProperties} aria-label={`Mostrar chunk ${chunk.id}`} aria-pressed={chunk.id===active?.id} data-visible={true} onClick={()=>inspect(chunks.indexOf(chunk))}>{chunk.chunkIndex}</button>)}</div></div>)}</div>{active&&<article className="b0-chunk-text" aria-live="polite"><span className="s-label">{active.documentId} · {active.title}</span><h3>{active.id}</h3><p>{active.text}</p><small>{active.characters} caracteres · posições {active.startChar}–{active.endChar}</small></article>}</div><p className="b0-stage-result">{documents.length} documentos → {chunks.length} chunks</p></>
}
