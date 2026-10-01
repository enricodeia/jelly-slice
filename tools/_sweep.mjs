import { getBearModel } from '../src/geometry/bearModel.js'
import { SoftBody, JellyWorld } from '../src/sim/world.js'
import { cutBody, affineFit } from '../src/sim/cutBody.js'
import { tetVolume } from '../src/sim/lattice.js'
const model = getBearModel()
function strain(b) {
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
  // signed: the largest deviation, keeping its sign (squash vs stretch)
  let best = 0
  for (let i = 0; i < 3; i++) { const d = Math.sqrt(Math.max(0, M[i][i])) - 1; if (Math.abs(d) > Math.abs(best)) best = d }
  return best
}
const mk = () => new SoftBody({ lattice: model.lattice, proxyPoints: model.proxyPoints, proxyEmbed: model.proxyEmbed, proxyRadius: model.proxyRadius, data: { soup: model.soup, render: model.render, volume: model.volume } })
function run(ec, damping, speed) {
  const world = new JellyWorld()
  Object.assign(world.params, { floorY: -Infinity, walls: null, gravity: 0, damping, edgeCompliance: ec })
  const bear = mk()
  bear.setRigid(0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...model.centroid)
  world.add(bear)
  const c0 = bear.centroid()
  const kids = cutBody(model, bear, [c0[0], c0[1], c0[2] + 11], [0, -1, 0], [1, 0, 0], { speed, now: 0 })
  world.remove(bear)
  kids.forEach((k) => world.add(k))
  const k = kids[1]
  let peak = 0, peakF = 0, crossings = 0, last = 0, settle = -1
  for (let f = 1; f <= 90; f++) {
    world.step(1 / 60)
    const s = strain(k)
    if (Math.abs(s) > Math.abs(peak)) { peak = s; peakF = f }
    const sign = Math.abs(s) > 0.004 ? Math.sign(s) : 0
    if (sign && last && sign !== last) crossings++
    if (sign) last = sign
    if (Math.abs(s) > 0.006) settle = f
  }
  let vr = 0, r = 0
  for (const b of kids) for (let t = 0; t < b.lat.tetRest.length; t++) { vr += tetVolume(b.x, b.lat.tets[4 * t], b.lat.tets[4 * t + 1], b.lat.tets[4 * t + 2], b.lat.tets[4 * t + 3]); r += b.lat.tetRest[t] }
  const nan = kids.some((b) => b.x.some((x) => !Number.isFinite(x)))
  return `ec ${ec.toExponential(1)} damp ${damping.toFixed(3)} speed ${speed}: peak ${(peak * 100).toFixed(1)}% @f${peakF}  swings ${crossings}  settles f${settle}  vol ${(vr / r).toFixed(3)}${nan ? ' NaN!' : ''}`
}
for (const ec of [4e-4])
  for (const d of [0.08, 0.2, 0.4, 0.6])
    console.log(run(ec, d, 16), " / slash:", run(ec, d, 35).split(": ")[1])
