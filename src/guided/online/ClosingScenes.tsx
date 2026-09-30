import { Panel, Title } from '../ui'
import type { OnlinePipeline } from './useOnlinePipeline'


type Props = { pipeline: OnlinePipeline }
export function RagScene({pipeline:{state:s}}:Props) {
  return <><Title eyebrow="07 · ISSO É RAG" title="Retrieval → Augmented Context → Generation">Evidências recuperadas ampliam o contexto usado para gerar a resposta.</Title>
    <section className="rag-together">
      <div data-kind="retrieval"><Panel label="R · RETRIEVAL"><h2>{s.retrievedChunks.length} chunks</h2><p>{s.retrievedChunks.map(c=>c.id).join(' · ')||'Recuperação pendente'}</p><small>Texto recuperado do payload.</small></Panel></div>
      <div data-kind="context"><Panel label="A · AUGMENTED CONTEXT"><h2>Consulta + evidências</h2><p>{s.selectedQuery||'Consulta pendente'}</p><small>{s.context?`${s.context.length} caracteres de contexto`:'Contexto pendente'}</small></Panel></div>
      <div data-kind="success"><Panel label="G · GENERATION"><h2>{s.answer?'Resposta gerada':'Geração pendente'}</h2><p className="s-answer">{s.answer?s.answerText:'Geração pendente na página 06.'}</p></Panel></div>
    </section><small>Os pesos do modelo não mudam; a resposta usa as evidências recuperadas.</small></>
}
