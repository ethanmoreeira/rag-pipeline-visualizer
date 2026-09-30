import { ArrowRight } from 'lucide-react'
import { Title } from './ui'
import './query.css'

const PRESET_QUERIES = [
  'Se eu tomar banhos mais curtos, o consumo de energia diminui?',
  'Por que minha conta pode ficar mais cara mesmo consumindo os mesmos kWh?',
  'Como usar o ar-condicionado consumindo menos energia?',
] as const

type Props = {
  draftQuery: string
  setDraftQuery: (query: string) => void
  selectedQuery: string
  setSelectedQuery: (query: string) => void
  onAdvance: () => void
}

export function QueryScene({ draftQuery, setDraftQuery, selectedQuery, setSelectedQuery, onAdvance }: Props) {

  const confirmDraft = () => {
    const trimmed = draftQuery.trim()
    if (!trimmed) return
    setSelectedQuery(trimmed)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      confirmDraft()
    }
  }

  return <>
    <Title eyebrow="01 · CONSULTA" title="Entrada do pipeline online">
      Perguntas sobre consumo residencial de energia elétrica, conta e uso dos aparelhos.
    </Title>

    <div className="q1-layout">
      <div className="q1-options">
        <div className="q1-cards" role="radiogroup" aria-label="Consultas disponíveis">
          {PRESET_QUERIES.map((text, index) => (
            <button
              key={index}
              className="q1-card"
              role="radio"
              aria-pressed={selectedQuery === text}
              aria-checked={selectedQuery === text}
              onClick={() => setSelectedQuery(text)}
            >
              <span className="q1-number">{String(index + 1).padStart(2, '0')}</span>
              <span className="q1-text">{text}</span>
            </button>
          ))}
        </div>

        <div className="q1-free">
          <span className="q1-free-label">Ou faça outra pergunta</span>
          <div className="q1-free-row">
            <input
              type="text"
              value={draftQuery}
              onChange={event => setDraftQuery(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Digite uma pergunta sobre energia residencial..."
              aria-label="Pergunta livre sobre energia residencial"
            />
            <button
              className="q1-free-confirm"
              onClick={confirmDraft}
              disabled={!draftQuery.trim()}
              aria-label="Confirmar pergunta livre"
            >
              Confirmar
            </button>
          </div>
        </div>
      </div>
      <div className="q1-right">
        <div className={`q1-confirmation ${selectedQuery ? 'has-query' : ''}`}>
          <span className="q1-conf-label">CONSULTA SELECIONADA</span>
          {selectedQuery
            ? <p className="q1-conf-text">{selectedQuery}</p>
            : <p className="q1-conf-empty">A consulta é o ponto de partida da busca semântica.</p>
          }
        </div>

        <button
          className="q1-cta"
          disabled={!selectedQuery}
          onClick={onAdvance}
          aria-label="Avançar para inspecionar o embedding"
        >
          Ir para embedding
          <ArrowRight size={19} />
        </button>
      </div>
    </div>
  </>
}
