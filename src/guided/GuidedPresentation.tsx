import { EmbeddingScene, SearchScene, SimilarityScene, RetrievalScene, ContextScene } from './online/Scenes'
import { useEffect, useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, BookOpen, Maximize } from 'lucide-react'
import { MODEL } from './corpus'
import { QueryScene } from './QueryScene'
import { RagScene } from './online/ClosingScenes'
import { Modal } from './ui'
import { BaseScene } from './base/BaseScene'
import { useBasePreparation } from './base/useBasePreparation'
import './seminar.css'
import './studio.css'
import './studio-refinements.css'
import { useOnlinePipeline } from './online/useOnlinePipeline'
import { CoverScene } from './CoverScene'

export function GuidedPresentation() {
  const [scene, setScene] = useState(-1)
  const [sources, setSources] = useState(false)
  const [draftQuery, setDraftQuery] = useState('')
  const [locked, setLocked] = useState(false)
  const pipeline = useOnlinePipeline()
  const base = useBasePreparation()
  const selectedQuery = pipeline.state.selectedQuery
  const setSelectedQuery = pipeline.controller.setQuery
  const chapters = ['Base', 'Consulta', 'Embedding', 'Busca Semântica', 'Similaridade', 'Recuperação', 'Contexto e LLM', 'Isso é RAG']
  const navigate = (index: number) => { if (!locked) setScene(Math.max(-1, Math.min(chapters.length - 1, index))) }
  const advanceFromQuery = () => { if (selectedQuery) navigate(2) }
  const scenes: ReactNode[] = [<BaseScene key="base" base={base} onBusy={setLocked}/>, <QueryScene key="query" draftQuery={draftQuery} setDraftQuery={setDraftQuery} selectedQuery={selectedQuery} setSelectedQuery={setSelectedQuery} onAdvance={advanceFromQuery}/>, <EmbeddingScene key="embedding" pipeline={pipeline}/>, <SearchScene key="search" pipeline={pipeline}/>, <SimilarityScene key="similarity" pipeline={pipeline}/>, <RetrievalScene key="retrieval" pipeline={pipeline}/>, <ContextScene key="context" pipeline={pipeline}/>, <RagScene key="rag" pipeline={pipeline}/>]
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (sources || (event.target as HTMLElement)?.closest('button,a,input,textarea,select,summary,dialog')) return
      if (event.key === 'ArrowRight') navigate(scene + 1)
      if (event.key === 'ArrowLeft') navigate(scene - 1)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  })
  return <main className={`seminar ${scene === -1 ? 'is-cover' : ''}`}><header className="s-header"><div className="s-brand"><img src="/uniacademia-symbol.svg" alt="UniAcademia"/><span>GRUPO 7 {scene !== -1 && <b>Embeddings, busca semântica e RAG</b>}</span></div><div className="s-header-actions">{scene !== -1 && <>{(pipeline.state.error || pipeline.state.busy) && <span className={`s-status ${pipeline.state.queryEmbedding ? 'ready' : ''}`} role="status">{pipeline.state.error ? 'Pipeline precisa de atenção' : 'Processando…'}</span>}<button aria-label="Referências" onClick={() => setSources(true)}><BookOpen size={17}/><span>Referências</span></button></>}<button aria-label="Tela cheia" onClick={() => void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {})}><Maximize size={18}/></button></div></header>
    {scene > 1 && <details className="s-query-ribbon"><summary>CONSULTA Q <span>{selectedQuery || 'Nenhuma consulta selecionada'}</span></summary><p>{selectedQuery || 'Nenhuma consulta selecionada'}</p></details>}
    <div className="s-stage" key={scene} data-generation-complete={Boolean(pipeline.state.answer)}><div className="s-scene">{scene === -1 ? <CoverScene onStart={() => navigate(0)}/> : scenes[scene]}</div></div>
    {scene >= 0 && <footer className="s-footer"><button disabled={locked || scene === 0} aria-label="Cena anterior" onClick={() => navigate(scene - 1)}><ArrowLeft size={19}/></button><nav aria-label="Cenas da apresentação">{chapters.map((label, index) => <button key={label} disabled={locked} onClick={() => navigate(index)} aria-label={`Cena ${String(index).padStart(2, '0')}: ${label}`} aria-current={index === scene ? 'step' : undefined}><span>{String(index).padStart(2, '0')}</span>{label}</button>)}</nav><button disabled={locked || scene === chapters.length - 1} aria-label="Próxima cena" onClick={() => navigate(scene + 1)}><ArrowRight size={19}/></button></footer>}
    {sources && <Modal title="Referências" close={() => setSources(false)}><p>Material da disciplina: Aula 2 — Tokens, Embeddings e Codificação Posicional, páginas 11–19.</p><p>Na aula, o embedding de entrada representa um token. Nesta demonstração, mostramos também a saída contextualizada do encoder e o pooling que produz um vetor por frase.</p><a href="https://developers.openai.com/api/docs/guides/embeddings" target="_blank" rel="noreferrer">OpenAI · Documentação oficial de embeddings ↗</a><a href="https://developers.openai.com/api/docs/models/text-embedding-3-small" target="_blank" rel="noreferrer">OpenAI · text-embedding-3-small ↗</a><a href="https://developers.openai.com/api/docs/models/text-embedding-3-large" target="_blank" rel="noreferrer">OpenAI · text-embedding-3-large ↗</a><a href="https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2" target="_blank" rel="noreferrer">HuggingFace · MiniLM (ficha do modelo e pooling) ↗</a><p>Modelo usado na demonstração: {MODEL}. Roda localmente no navegador com Transformers.js (ONNX q8). </p><p>A OpenAI documenta a função, os modelos e a API de embeddings. Detalhes internos não publicados não são apresentados como fatos.</p><p>As páginas 00–07 usam a mesma Base de consumo residencial de energia elétrica.</p><p>{pipeline.state.queryEmbedding ? `${pipeline.state.queryEmbedding.vector.length} dimensões, ${pipeline.state.queryEmbedding.tokens.length} tokens na consulta.` : pipeline.state.error || pipeline.state.phase}</p>{pipeline.state.failedStage && <button onClick={() => void pipeline.controller.retry()}>Tentar novamente</button>}</Modal>}
  </main>
}
