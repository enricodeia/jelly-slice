import { getBearModel } from '../src/geometry/bearModel.js'
import { SoftBody, JellyWorld } from '../src/sim/world.js'
import { cutBody, affineFit } from '../src/sim/cutBody.js'
const model = getBearModel()
// principal stretches of the best affine map: eigenvalues of AᵀA (Jacobi), sqrt
function stretches(b) {
  const { A } = affineFit(b)
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) M[i][j] += A[3 * k + i] * A[3 * k + j]
  for (let it = 0; it < 30; it++) {
    let p = 0, q = 1
    for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) if (Math.abs(M[i][j]) > Math.abs(M[p][q])) { p = i; q = j }
    if (Math.abs(M[p][q]) < 1e-12) break
    const th = 0.5 * Math.atan2(2 * M[p][q], M[q][q] - M[p][p]), c = Math.cos(th), s = Math.sin(th)
    for (let k = 0; k < 3; k++) { const a = M[k][p], b2 = M[k][q]; M[k][p] = c * a - s * b2; M[k][q] = s * a + c * b2 }
    for (let k = 0; k < 3; k++) { const a = M[p][k], b2 = M[q][k]; M[p][k] = c * a - s * b2; M[q][k] = s * a + c * b2 }
  }
  return [0, 1, 2].map((i) => Math.sqrt(Math.max(0, M[i][i])))
}
const speed = Number(process.argv[2] || 30), damping = Number(process.argv[3] || 0.08)
const world = new JellyWorld()
Object.assign(world.params, { floorY: -Infinity, walls: null, gravity: 0, damping, edgeCompliance: Math.pow(10, -3.7 - 1.6 * 0.65) })
const mk = () => new SoftBody({ lattice: model.lattice, proxyPoints: model.proxyPoints, proxyEmbed: model.proxyEmbed, proxyRadius: model.proxyRadius, data: { soup: model.soup, render: model.render, volume: model.volume } })
const bear = mk()
bear.setRigid(0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...model.centroid)
world.add(bear)
const c0 = bear.centroid()
const kids = cutBody(model, bear, [c0[0], c0[1], c0[2] + 11], [0, -1, 0], [1, 0, 0], { speed, now: 0 })
world.remove(bear)
kids.forEach((k) => world.add(k))
// and for comparison: a fresh bear with the spawn jiggle (k = 1.1 along x)
const jb = mk()
jb.setRigid(0, 0, 0, 1, 5, 0, 0, 0, 0, 0, 0, 0, 0, ...model.centroid)
const cj = jb.centroid()
for (let a = 0; a < jb.n; a++) jb.v[3 * a] += 1.1 * (jb.x[3 * a] - cj[0])
world.add(jb)
const fmt = (b) => { const s = stretches(b); return (Math.max(...s.map((x) => Math.abs(x - 1))) * 100).toFixed(1).padStart(5) + '%' }
const rows = []
for (let f = 0; f <= 30; f++) {
  if (f % 2 === 0) rows.push(`f${String(f).padStart(2)}  halves ${kids.map(fmt).join(' ')}   spawn-jiggle bear ${fmt(jb)}`)
  world.step(1 / 60)
}
console.log(`speed ${speed} damping ${damping} (max principal strain)\n` + rows.join('\n'))
