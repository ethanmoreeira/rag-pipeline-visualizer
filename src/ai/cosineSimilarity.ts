export function cosineSimilarity(a: number[], b: number[]) {
  if (!a.length || a.length !== b.length || !a.every(Number.isFinite) || !b.every(Number.isFinite)) {
    throw new Error('O cosseno exige vetores finitos, não vazios e com a mesma dimensão.')
  }
  const length = a.length
  let dot = 0
  let normA = 0
  let normB = 0
  for (let index = 0; index < length; index += 1) {
    dot += a[index] * b[index]
    normA += a[index] ** 2
    normB += b[index] ** 2
  }
  if (!normA || !normB) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}
