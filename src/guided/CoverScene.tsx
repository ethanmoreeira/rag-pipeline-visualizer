import { ArrowRight } from 'lucide-react'

export function CoverScene({ onStart }: { onStart: () => void }) {
  return (
    <div className="cover-scene">
      <span className="cover-group">GRUPO 7</span>
      <h1 className="cover-title">Embeddings, busca semântica e RAG</h1>
      <p className="cover-flow">Documentos → Embeddings → Busca → Recuperação → Contexto → Geração</p>
      <span className="cover-seminar">RAG e Transformers</span>
      <button className="cover-cta" onClick={onStart}><ArrowRight size={20}/>Iniciar</button>
    </div>
  )
}
