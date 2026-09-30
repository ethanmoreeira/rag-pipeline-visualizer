import { projectPca } from './projectPca.ts'
function check(ok: boolean, why: string) { if (!ok) throw new Error(why) }
const input = [[2,0,0],[-2,0,0],[0,1,0],[0,-1,0]]
const original = JSON.stringify(input)
const p = projectPca(input)
check(Math.abs(p.explained - 1) < 1e-9, 'Planar variance')
for (let i=0;i<input.length;i++) for(let j=0;j<input.length;j++) {
  const before = input[i].reduce((s,x,k)=>s+(x-input[j][k])**2,0)
  const after = p.points[i].reduce((s,x,k)=>s+(x-p.points[j][k])**2,0)
  check(Math.abs(before-after)<1e-8,'Planar distances')
}
check(JSON.stringify(input) === original,'No source mutation')
check(JSON.stringify(projectPca(input)) === JSON.stringify(p),'Deterministic')
check(projectPca([[1,2],[1,2]]).points.flat().every(x=>x===0),'Degenerate vectors')
check(projectPca([[3,4]]).points.flat().every(x=>x===0),'Single vector')
const cube = Array.from({length:8},(_,i)=>[i&1?1:-1,i&2?1:-1,i&4?1:-1])
check(Math.abs(projectPca(cube).explained - 2/3)<1e-8,'3D explained variance')
let rejects = false
try { projectPca([[NaN]]) } catch { rejects = true }
check(rejects,'Invalid data rejected')
console.log('PCA: 8 checks passed')
