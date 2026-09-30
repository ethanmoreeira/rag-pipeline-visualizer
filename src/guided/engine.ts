export type TokenState = { id: number; piece: string; special: boolean; hidden: number[] }
export type Representation = { text: string; tokens: TokenState[]; pooled: number[]; vector: number[] }
export type GuidedSnapshot = { query: Representation; documents: Representation[]; model: string; dimension: number; elapsedMs: number }

export function meanRows(rows: number[][]) {
  if (!rows.length || !rows[0].length || rows.some(row => row.length !== rows[0].length || row.some(v => !Number.isFinite(v)))) throw new Error('Matriz contextual inválida.')
  return rows[0].map((_, dim) => rows.reduce((sum, row) => sum + row[dim], 0) / rows.length)
}
export function normalizeVector(vector: number[]) {
  const norm = Math.hypot(...vector)
  if (!norm || !Number.isFinite(norm)) throw new Error('Vetor sem norma válida.')
  return vector.map(value => value / norm)
}

export function validateSnapshot(snapshot: GuidedSnapshot) {
  if (snapshot.dimension !== 384) throw new Error('Dimensão inesperada para esta demonstração.')
  for (const representation of [snapshot.query, ...snapshot.documents]) {
    if (!representation.tokens.length || representation.tokens.length > 128 || representation.vector.length !== 384 || representation.pooled.length !== 384) throw new Error('Formato da representação inválido.')
    if (representation.tokens.some(token => !Number.isInteger(token.id) || !token.piece || token.hidden.length !== 384)) throw new Error('Token ou estado contextual inválido.')
    const manualMean = meanRows(representation.tokens.map(token => token.hidden))
    const manualVector = normalizeVector(manualMean)
    if (manualMean.some((value, i) => Math.abs(value - representation.pooled[i]) > 1e-5)) throw new Error('A média exibida não corresponde aos estados contextuais.')
    if (manualVector.some((value, i) => !Number.isFinite(representation.vector[i]) || Math.abs(value - representation.vector[i]) > 1e-5)) throw new Error('O vetor não corresponde à média normalizada.')
  }
}
