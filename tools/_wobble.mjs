import { getBearModel } from '../src/geometry/bearModel.js'
import { SoftBody, JellyWorld } from '../src/sim/world.js'
import { cutBody, affineFit } from '../src/sim/cutBody.js'
const model = getBearModel()
// non-affine deformation: max node distance from the best affine map of its rest position
function wobble(b) {
  const { A, c, C } = affineFit(b)
  const X = b.lat.rest
  let m = 0
  for (let a = 0; a < b.n; a++) {
    const q = [X[3 * a] - C[0], X[3 * a + 1] - C[1], X[3 * a + 2] - C[2]]
    for (let d = 0; d < 3; d++) {
      const p = c[d] + A[3 * d] * q[0] + A[3 * d + 1] * q[1] + A[3 * d + 2] * q[2]
      m = Math.max(m, Math.abs(b.x[3 * a + d] - p))
    }
  }
  return m
}
const speed = Number(process.argv[2] || 30), damping = Number(process.argv[3] || 0.08)
const world = new JellyWorld()
Object.assign(world.params, { floorY: -Infinity, walls: null, gravity: 0, damping, edgeCompliance: Math.pow(10, -3.7 - 1.6 * 0.65) })
const bear = new SoftBody({ lattice: model.lattice, proxyPoints: model.proxyPoints, proxyEmbed: model.proxyEmbed, proxyRadius: model.proxyRadius, data: { soup: model.soup, render: model.render, volume: model.volume } })
bear.setRigid(0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...model.centroid)
world.add(bear)
const c0 = bear.centroid()
const kids = cutBody(model, bear, [c0[0], c0[1], c0[2] + 11], [0, -1, 0], [1, 0, 0], { speed, now: 0 })
world.remove(bear)
kids.forEach((k) => world.add(k))
const rows = []
for (let f = 0; f <= 40; f++) {
  if (f % 2 === 0) rows.push(`f${String(f).padStart(2)} ` + kids.map((k) => wobble(k).toFixed(4)).join('  '))
  world.step(1 / 60)
}
console.log(`speed ${speed} damping ${damping}\n` + rows.join('\n'))
