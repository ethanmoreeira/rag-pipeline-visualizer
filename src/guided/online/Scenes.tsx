import { useMemo, useState } from 'react'
import { projectPca } from '../../ai/projectPca.ts'
import { LOCAL_MODEL } from '../generation.ts'
import { format, piece } from '../format.ts'
import { Modal, Panel, Takeaway, Title, Vector } from '../ui.tsx'
import { ONLINE_INSTRUCTION, inspectCitations } from './types.ts'
import type { OnlinePipeline } from './useOnlinePipeline.ts'
import './online.css'
import { useReplay } from './useReplay'
import type { TokenState } from '../engine.ts'

type Props = {pipeline: OnlinePipeline}
function Status({pipeline:{state:s,controller:c}}:Props) {
  return <div className="o-status" aria-live="polite">
    {s.busy && <><span>{s.phase}{s.attempt>1?` · tentativa ${s.attempt}/3`:''}</span><button onClick={c.cancel}>Interromper</button></>}
    {s.error && <><p className="s-error" role="alert">{s.error}</p>{s.failedStage && <button disabled={Boolean(s.busy)} onClick={()=>void c.retry()}>Tentar novamente: {({embedding:'MiniLM',search:'Qdrant',retrieval:'retrieval',context:'contexto',answer:'Qwen'})[s.failedStage]}</button>}</>}
    {!s.selectedQuery && <p>Escolha uma consulta na página 01 para começar.</p>}
  </div>
}
function TopK({pipeline:{state:s,controller:c}}:Props) {
  return <label className="o-topk">Top-k <select value={s.topK} disabled={Boolean(s.busy)} onChange={e=>c.setTopK(Number(e.target.value))}>{[1,2,3,4,5].map(k=><option key={k} value={k}>{k}</option>)}</select></label>
}
export function EmbeddingScene({pipeline}:Props) {
  const {state:s,controller:c}=pipeline
  const q=s.queryEmbedding
  const [presentation,setPresentation]=useState({snapshot:q,step:0})
  const step=presentation.snapshot===q?presentation.step:0
  const setStep=(next:number|((previous:number)=>number))=>setPresentation({snapshot:q,step:typeof next==='function'?next(step):next})
  const [all,setAll]=useState(false)
  const [dimension,setDimension]=useState(0)
  const names=['Texto','Tokens + IDs','MiniLM','Estados contextualizados','Média dos tokens','Normalização L2','Embedding 384D']
  return <>
    <Title eyebrow="02 · EMBEDDING DA CONSULTA" title="Tokenizer + MiniLM → mean pooling → L2 → vetor 384D" />
    <div className="s-actions">{!q&&<button className="s-primary" disabled={Boolean(s.busy)||!s.selectedQuery} onClick={()=>void c.run('embedding')}>Gerar embedding</button>}<small>{q?`${format(q.elapsedMs/1000,2)} s · ${q.tokens.length} tokens · ${q.vector.length}D`:'MiniLM local · mesmo modelo da Base'}</small></div>
    <nav className="o-steps" aria-label="Etapas do embedding">{names.map((name,i)=><button key={name} disabled={i>0&&!q} onClick={()=>setStep(i)} aria-pressed={step===i} data-active={step===i} data-past={Boolean(q)&&step>i}><small>{i+1}</small>{name}</button>)}</nav>
    {q&&<p className="o-stage-caption" aria-live="polite">{step+1} / 7 · {names[step]}</p>}
    <Panel label={names[step]} className="o-detail">
      {step===0 && <><p>{s.selectedQuery||'Aguardando seleção na página 01.'}</p></>}
      {step===1 && <><p>Partes do texto → IDs do vocabulário.</p>{q?<div className="o-tokens">{q.tokens.map((t,i)=><div key={i}><b>{piece(t.piece)}</b><code>{t.id}</code><small>{t.special?'especial':'token'}</small></div>)}</div>:<p>Tokens e IDs disponíveis após a inferência.</p>}</>}
      {step===2 && <><div className="embedding-flow"><div><b>{q?.tokens.length??'N'} tokens</b><small>Tokens + IDs</small></div><span aria-hidden="true">→</span><div><b>MiniLM</b><small>Encoder Transformer<br/>Self-attention</small></div><span aria-hidden="true">→</span><div><b>{q?.tokens.length??'N'} vetores × 384D</b><small>Estados contextualizados</small></div></div><p>A self-attention relaciona os tokens da frase. Cada token ganha uma representação que considera seu contexto.</p><details><summary>Modelo e inferência</summary><p>paraphrase-multilingual-MiniLM-L12-v2, o mesmo encoder da Base. Os estados exibidos vêm de uma inferência; ainda há um vetor por token.</p></details></>}
      {step===3 && q && <><p>Matriz de {q.tokens.length} tokens × 384 dimensões. Amostra das primeiras linhas e coordenadas:</p><TokenMatrix tokens={q.tokens.slice(0,6)} dimension={0}/><details><summary>Inspecionar matriz e dimensões</summary><label>Dimensões <select aria-label="Dimensões dos estados contextualizados" value={dimension} onChange={e=>setDimension(Number(e.target.value))}>{Array.from({length:128},(_,i)=><option key={i} value={i*3}>d{i*3+1}–d{i*3+3}</option>)}</select></label><TokenMatrix tokens={q.tokens} dimension={dimension}/></details></>}
      {step===4 && <><p>A média usa a attention mask para excluir padding e posições inválidas.</p>{q&&<><div className="embedding-flow"><div><b>{q.tokens.length} vetores × 384D</b><small>Estados dos tokens válidos</small></div><span aria-hidden="true">→</span><div><b>Média com máscara</b><small>Uma média por dimensão</small></div><span aria-hidden="true">→</span><div><b>1 vetor × 384D</b><small>Mean pooling</small></div></div><Vector values={q.pooled} label="Média antes da normalização"/><details><summary>Fórmula e máscara</summary><p><code>mⱼ = Σ(maskᵢ × hᵢⱼ) / Σ maskᵢ</code></p><p>Máscara: [{q.attentionMask.join(', ')}]. Os tokens especiais com máscara 1 participam da média; posições com máscara 0 são excluídas.</p><p>Dimensão 1: {format(q.tokens.reduce((sum,t)=>sum+t.hidden[0],0),5)} ÷ {q.attentionMask.reduce((sum,m)=>sum+m,0)} = {format(q.pooled[0],5)}</p></details></>}</>}
      {step===5 && <><p>Cada coordenada é dividida pela norma do vetor. A direção é preservada e o comprimento passa a ser 1.</p>{q&&<div className="embedding-flow"><div><b>‖m‖ = {format(Math.hypot(...q.pooled),4)}</b><small>Antes</small></div><span aria-hidden="true">→</span><div><b>vⱼ = mⱼ / ‖m‖</b><small>Dividir cada coordenada</small></div><span aria-hidden="true">→</span><div><b>‖v‖ = {format(Math.hypot(...q.vector),0)}</b><small>Depois · norma unitária</small></div></div>}<details><summary>Fórmula da norma L2</summary><p><code>‖m‖ = √Σ mⱼ²</code></p>{q&&<p>Dimensão 1: {format(q.pooled[0],6)} ÷ {format(Math.hypot(...q.pooled),6)} = {format(q.vector[0],6)}.</p>}</details></>}
      {step===6 && <><p>A consulta agora é 1 vetor de 384 dimensões, pronto para a busca no Qdrant.</p>{q&&<><Vector values={q.vector}/><button onClick={()=>setAll(true)}>Ver os {q.vector.length} valores</button></>}<small>Consulta e chunks usam o mesmo modelo, mean pooling e normalização L2.</small></>}
    </Panel>
    <Status pipeline={pipeline}/>
    {all&&q&&<Modal title="Embedding completo desta execução" close={()=>setAll(false)}><pre>{q.vector.map((v,i)=>`d${i+1}: ${v}`).join('\n')}</pre></Modal>}
  </>
}

export function TokenMatrix({tokens,dimension}:{tokens:TokenState[];dimension:number}) {
  return <div className="token-matrix-scroll"><table className="token-matrix"><thead><tr><th scope="col">Token</th><th scope="col">Token ID</th>{[1,2,3].map(d=><th scope="col" key={d}>Dimensão {dimension+d}</th>)}</tr></thead><tbody>{tokens.map((t,i)=><tr key={i}><th scope="row">{piece(t.piece)}</th><td><code>{t.id}</code></td>{t.hidden.slice(dimension,dimension+3).map((v,j)=><td key={j}><code>{format(v,4)}</code></td>)}</tr>)}</tbody></table></div>
}

export function SearchScene({pipeline}:Props) {
  const {state:s,controller:c}=pipeline
  const [selected,setSelected]=useState('')
  const replay=useReplay(s.searchResults.length?s.searchResults:null,s.searchResults.length+1,65)
  const map=useMemo(()=>s.queryEmbedding&&s.searchResults.length?projectPca([s.queryEmbedding.vector,...s.searchResults.map(hit=>hit.vector)]):null,[s.queryEmbedding,s.searchResults])
  const inspected=s.searchResults.find(hit=>hit.id===selected)??s.searchResults[0]
  const max=map?Math.max(.001,...map.points.flat().map(Math.abs)):1
  return <>
    <Title eyebrow="03 · BUSCA SEMÂNTICA" title="Embedding da consulta → Qdrant → ranking">O Qdrant compara o embedding da consulta com os 55 chunks da Base e devolve um ranking.</Title>
    <div className="s-actions">{!s.searchResults.length&&<button className="s-primary" disabled={Boolean(s.busy)||!s.selectedQuery} onClick={()=>void c.run('search')}>Buscar no Qdrant</button>}</div>
    {map?<div className="o-columns search-result-stage"><Panel label="ESPAÇO SEMÂNTICO · PCA 2D"><svg className="o-map" viewBox="0 0 600 330" aria-label="Projeção PCA da consulta e dos chunks"><line x1="25" y1="165" x2="575" y2="165"/><line x1="300" y1="15" x2="300" y2="315"/>{map.points.map(([x,y],i)=>{
      const hit=s.searchResults[i-1], chosen=i>0&&i<=s.topK
      return <g key={hit?.id??'query'} style={{opacity:i===0||i<=replay.frame?1:.2}} transform={`translate(${300+x/max*260},${165-y/max*135})`}><circle stroke={hit?.id===inspected?.id?'#fff':undefined} strokeWidth={hit?.id===inspected?.id?3:0} r={i===0?10:chosen?7:4} className={i===0?'query':chosen?'chosen':''}/><title>{i===0?`Consulta: ${s.selectedQuery}`:`${hit.id} · ${hit.title} · score ${hit.score}`}</title>{(i===0||chosen||hit?.id===inspected?.id)&&<text x="12" y="4">{hit?.id??'Q'}</text>}</g>
    })}</svg></Panel><Panel label={`RANKING RECEBIDO · TOP-${s.topK}`}> <div className="replay-candidates">{s.searchResults.map((hit,i)=><span key={hit.id} title={`${hit.id}: ${hit.score}`} data-lit={i<replay.frame} data-top={i<replay.frame&&i<s.topK}>{hit.id}</span>)}</div><div className="o-hit-list">{s.searchResults.slice(0,s.topK).map((hit,i)=><button data-top={i<s.topK} key={hit.id} onClick={()=>setSelected(hit.id)} aria-pressed={inspected?.id===hit.id}><b>{i+1} · {hit.id}</b><span>{hit.title}</span><code>{format(hit.score,5)}</code></button>)}</div><details><summary>Cosine e PCA</summary><p>O Qdrant compara vetores 384D com Cosine. O PCA não define o ranking.</p><p>PCA: {format(map.explained*100,1)}% da variância nestes eixos. Coleção: {s.base?.collection}.</p></details></Panel></div>:null}
    <Status pipeline={pipeline}/>
  </>
}

export function SimilarityScene({pipeline}:Props) {
  const {state:s}=pipeline
  const [all,setAll]=useState(false)
  const [projection,setProjection]=useState(false)
  const ranking=(complete=false)=><ol className="o-ranking">{s.searchResults.slice(0,complete?undefined:Math.max(5,s.topK)).map((hit,i)=><li key={hit.id} className={i<s.topK?'chosen':''}><b>{i+1} · {hit.id}</b><span>{hit.title}</span><meter min={-1} max={1} value={hit.score} aria-label={`Cosine de ${hit.id}`}/><code>{format(hit.score,6)}</code></li>)}</ol>
  return <>
    <Title eyebrow="04 · COSINE → RANKING → TOP-K" title="Entendendo o score usado na busca">O Qdrant já comparou os vetores com Cosine; aqui vemos o cálculo e a seleção top-k.</Title>
    <div className="s-actions">{!s.searchResults.length&&<small>Ranking pendente da busca semântica.</small>}<TopK pipeline={pipeline}/>{s.queryEmbedding&&s.searchResults.length>0&&<button onClick={()=>setProjection(true)}>2D</button>}</div>
    <div className="o-columns"><Panel label="O QUE O COSSENO MEDE"><h3>O que a similaridade cosseno mede</h3><p>A similaridade cosseno compara a direção entre o vetor da consulta (Q) e o vetor de um chunk (D). Quanto mais alinhados esses vetores estiverem, maior será o score e mais relevante tende a ser o resultado.</p><p><small>Q = consulta · D = chunk · comparação em 384 dimensões</small><br/><small>Score mais alto = maior alinhamento semântico</small><br/><small>Score não é porcentagem de confiança.</small></p><div className="s-formula">cos(Q,D) = (Σ qᵢdᵢ) / (‖Q‖₂ × ‖D‖₂)</div>{s.searchResults[0]&&<CosineVisual score={s.searchResults[0].score}/>}{s.queryEmbedding&&s.searchResults[0]&&<CosineInspection query={s.queryEmbedding.vector} document={s.searchResults[0].vector} score={s.searchResults[0].score}/>}</Panel><Panel label="RANKING · MAIOR SCORE PRIMEIRO">{s.searchResults.length?<>{ranking()}<button onClick={()=>setAll(true)}>Ver os {s.searchResults.length} resultados</button><small>Top-{s.topK}: {s.searchResults.slice(0,s.topK).map(hit=>hit.id).join(' · ')}</small></>:<p>Aguardando a busca no Qdrant.</p>}</Panel></div>
    <Status pipeline={pipeline}/><Takeaway>Cosine mede alinhamento vetorial; ranking ordena; top-k seleciona.</Takeaway>
    {all&&<Modal title="Ranking completo recebido do Qdrant" close={()=>setAll(false)}>{ranking(true)}</Modal>}
    {projection&&<Modal title="Projeção PCA 2D" close={()=>setProjection(false)}><QueryProjection pipeline={pipeline}/></Modal>}
  </>
}

export function RetrievalScene({pipeline}:Props) {
  const {state:s,controller:c}=pipeline
  const [payload,setPayload]=useState<string|null>(null)
  const replay=useReplay(s.retrievedChunks.length?s.retrievedChunks:null,s.topK+1,450)
  const chunk=s.retrievedChunks.find(item=>item.id===payload)
  return <>
    <Title eyebrow="05 · RECUPERAÇÃO" title="Top-k IDs → Qdrant → payload → texto">O Qdrant relê os registros selecionados e devolve seus textos e metadados.</Title>
    <div className="s-actions">{!s.retrievedChunks.length&&<button className="s-primary" disabled={Boolean(s.busy)||!s.searchResults.length} onClick={()=>void c.run('retrieval')}>Recuperar payloads</button>}<small>Top-{s.topK} selecionado na Similaridade.</small></div>
    <section className="retrieval-cards">{s.searchResults.slice(0,s.topK).map((hit,i)=>{
      const item=s.retrievedChunks.find(x=>x.pointId===hit.pointId)
      return <article key={hit.id} data-ready={Boolean(item)&&i<replay.frame}><div className="retrieval-id"><b>{hit.id}</b><code>point {hit.pointId}</code><span>→</span><b>payload</b></div>{item?<><h2>{item.title}</h2><p>{item.text}</p><small>{item.documentId} · chunk {item.chunkIndex}</small><button onClick={()=>setPayload(item.id)}>Texto e metadados · {item.id}</button></>:<p>Aguardando a recuperação deste ID.</p>}</article>
    })}</section>
    <details><summary>Detalhes da recuperação</summary><p>Os IDs do top-k recuperam texto e metadados. A ordem segue o ranking; chunks podem pertencer ao mesmo documento.</p></details>
    <Status pipeline={pipeline}/>
    {chunk&&<Modal title={`Payload · ${chunk.id}`} close={()=>setPayload(null)}><p>{chunk.text}</p><a href={chunk.url} target="_blank" rel="noreferrer">{chunk.source}</a><pre>{JSON.stringify(chunk,null,2)}</pre></Modal>}
  </>
}

export function ContextScene({pipeline}:Props) {
  const {state:s,controller:c}=pipeline
  const [details,setDetails]=useState(false)
  const {cited,unknown}=inspectCitations(s.answerText,s.retrievedChunks.map(chunk=>chunk.id))
  const known=cited.filter(id=>!unknown.includes(id))
  return <>
    <Title eyebrow="06 · CONTEXTO + LLM" title="Instrução + consulta + evidências → Qwen">O Qwen recebe textos e metadados selecionados. Os vetores ficam na busca.</Title>
    <div className="s-actions">{!s.context&&<button disabled={Boolean(s.busy)||!s.retrievedChunks.length} onClick={()=>void c.run('context')}>Montar contexto</button>}{!s.answer&&<button className="s-primary" disabled={Boolean(s.busy)||!s.context} onClick={()=>void c.run('answer',Boolean(s.answerText))}>Gerar resposta no Qwen</button>}{s.context&&<button onClick={()=>setDetails(true)}>Ver contexto bruto</button>}</div>
    <div className="o-columns"><Panel label="CONTEXTO DA GERAÇÃO"><div className="context-assembly">
      <section data-kind="neutral"><b>1 · Instrução</b><p>Explicar a resposta com as evidências e citar os chunks usados.</p><details><summary>Ver instrução completa</summary><p>{ONLINE_INSTRUCTION}</p></details></section>
      <section data-kind="query"><b>2 · Consulta</b><p>{s.selectedQuery||'Selecione na página 01.'}</p></section>
      <section data-kind="retrieval"><b>3 · Evidências recuperadas</b>{s.retrievedChunks.map(chunk=><details key={chunk.id}><summary>{chunk.id} · {chunk.title}</summary><p>{chunk.text}</p></details>)}</section>
    </div><small>{s.context?`${s.retrievedChunks.length} chunks · ${s.context.length} caracteres · ${LOCAL_MODEL}`:'Monte o contexto após recuperar os payloads.'}</small></Panel><Panel label={s.answer?'RESPOSTA GERADA':s.answerText?'RESPOSTA PARCIAL':'AGUARDANDO GERAÇÃO'}><div className="s-answer" aria-live="polite">{s.answerText||'Aguardando a geração no Qwen.'}</div>{s.answer&&<><small>{format(s.answer.totalMs/1000,1)} s de geração · {s.answer.model}</small><section className="citation-check"><b>Fontes da resposta</b><p>{known.length?known.join(' · '):'Evidências disponíveis no contexto.'}</p>{unknown.length>0&&<p className="s-error">IDs fora das evidências: {unknown.join(', ')}</p>}<details><summary>Detalhes técnicos das citações</summary><p>A conferência verifica a existência dos IDs no contexto. A fidelidade de cada afirmação deve ser conferida no texto citado.</p></details>{known.map(id=><details key={id}><summary>Evidência {id}</summary><p>{s.retrievedChunks.find(chunk=>chunk.id===id)?.text}</p></details>)}</section></>}</Panel></div>
    <Status pipeline={pipeline}/>
    {details&&<Modal title="Contexto bruto enviado ao Qwen" close={()=>setDetails(false)}><pre>{`SYSTEM\n${ONLINE_INSTRUCTION}\n\nUSER\n${s.context}`}</pre></Modal>}
  </>
}

function CosineInspection({query,document,score}:{query:number[];document:number[];score:number}) {
  const dot=query.reduce((sum,value,i)=>sum+value*document[i],0), qNorm=Math.hypot(...query), dNorm=Math.hypot(...document)
  return <details className="studio-cosine"><summary>Ver cálculo detalhado do score</summary><p>Produto escalar (384D): {format(dot,7)}<br/>‖Q‖ = {format(qNorm,7)} · ‖D‖ = {format(dNorm,7)}<br/>Cosine: {format(dot/(qNorm*dNorm),7)}<br/>Score recebido do Qdrant: {format(score,7)}</p><small>Pequenas diferenças de arredondamento são possíveis.</small><table><caption>Exemplo com algumas dimensões; o cálculo completo usa as 384 dimensões.</caption><thead><tr><th>Dimensão</th><th>Q</th><th>D</th><th>Q × D</th></tr></thead><tbody>{query.slice(0,6).map((v,i)=><tr key={i}><td>{i+1}</td><td>{format(v,6)}</td><td>{format(document[i],6)}</td><td>{format(v*document[i],6)}</td></tr>)}</tbody></table></details>
}

function QueryProjection({pipeline:{state:s}}:Props) {
  const map=useMemo(()=>s.queryEmbedding&&s.searchResults.length?projectPca([s.queryEmbedding.vector,...s.searchResults.map(hit=>hit.vector)]):null,[s.queryEmbedding,s.searchResults])
  if(!map)return null
  const max=Math.max(.001,...map.points.flat().map(Math.abs))
  const coordinates=map.points.map(([x,y])=>[300+x/max*245,175-y/max*135])
  const [qx,qy]=coordinates[0]
  return <><svg className="o-map similarity-projection" viewBox="0 0 600 350" aria-label="Consulta e top-k apontados na projeção PCA"><defs><marker id="query-result-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="#ba9ce5"/></marker></defs>{coordinates.slice(1,s.topK+1).map(([x,y],i)=><line key={s.searchResults[i].id} x1={qx} y1={qy} x2={x} y2={y} markerEnd="url(#query-result-arrow)" className="projection-link"/>)}{coordinates.map(([x,y],i)=><g key={i} transform={`translate(${x},${y})`}><circle r={i===0?9:i<=s.topK?7:3} className={i===0?'query':i<=s.topK?'chosen':''}/>{i<=s.topK&&<text x="12" y="-9">{i===0?'Q':`${i} · ${s.searchResults[i-1].id}`}</text>}</g>)}</svg><small>As setas destacam o top-{s.topK}; não representam o cosseno.</small></>
}

function CosineVisual({score}:{score:number}) {
  const angle=Math.acos(Math.max(-1,Math.min(1,score))), x=110+160*Math.cos(angle), y=185-160*Math.sin(angle)
  return <div className="cosine-visual"><svg viewBox="0 0 400 230" aria-label={`Ângulo ilustrativo do cosseno ${score}`}><line x1="110" y1="185" x2="290" y2="185" stroke="#efc078" strokeWidth="4"/><line x1="110" y1="185" x2={x} y2={y} stroke="#87b5ff" strokeWidth="4"/><circle cx="110" cy="185" r="5" fill="#ddd"/><text x="300" y="190" fill="#efc078">Q</text><text x={x+8} y={y} fill="#87b5ff">D</text><text x="135" y="215" fill="#cbb6ea">cos θ = {format(score,5)}</text></svg><small>Quanto menor o ângulo entre Q e D, maior a similaridade cosseno.</small></div>
}
