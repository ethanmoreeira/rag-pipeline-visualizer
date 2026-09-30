/** Centered PCA via symmetric Jacobi eigendecomposition of X X^T.
 * Small sample count, full embedding dimension; never changes source vectors.
 */
export function projectPca(vectors: number[][]) {
  const n = vectors.length, d = vectors[0]?.length ?? 0
  if (!n || !d || vectors.some(v => v.length !== d || v.some(x => !Number.isFinite(x)))) throw new Error('Vetores inválidos para PCA')
  const mean = Array.from({ length: d }, (_, k) => vectors.reduce((s, v) => s + v[k], 0) / n)
  const x = vectors.map(v => v.map((a, k) => a - mean[k]))
  const a = x.map(v => x.map(w => v.reduce((s, z, k) => s + z * w[k], 0)))
  const u: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => i === j ? 1 : 0))
  for (let iter = 0; iter < 100 * n * n; iter++) {
    let p = 0, q = 0, largest = 0
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (Math.abs(a[i][j]) > largest) { largest = Math.abs(a[i][j]); p = i; q = j }
    if (largest < 1e-12) break
    const angle = .5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p])
    const c = Math.cos(angle), s = Math.sin(angle), pp = a[p][p], qq = a[q][q], pq = a[p][q]
    for (let k = 0; k < n; k++) if (k !== p && k !== q) {
      const kp = a[k][p], kq = a[k][q]
      a[k][p] = a[p][k] = c * kp - s * kq
      a[k][q] = a[q][k] = s * kp + c * kq
    }
    a[p][p] = c * c * pp - 2 * s * c * pq + s * s * qq
    a[q][q] = s * s * pp + 2 * s * c * pq + c * c * qq
    a[p][q] = a[q][p] = 0
    for (let k = 0; k < n; k++) { const kp = u[k][p], kq = u[k][q]; u[k][p] = c * kp - s * kq; u[k][q] = s * kp + c * kq }
  }
  const axes = Array.from({ length: n }, (_, i) => i).sort((i, j) => a[j][j] - a[i][i])
  const total = axes.reduce((s, k) => s + Math.max(0, a[k][k]), 0)
  const points = u.map(row => [0, 1].map(axis => { const k = axes[axis]; return k === undefined ? 0 : row[k] * Math.sqrt(Math.max(0, a[k][k])) }))
  const retained = axes.slice(0, 2).reduce((s, k) => s + Math.max(0, a[k][k]), 0)
  return { points, explained: total > 1e-12 ? retained / total : 0 }
}
