import { getBearModel } from '../src/geometry/bearModel.js'
import { SoftBody, JellyWorld } from '../src/sim/world.js'
import { cutBody } from '../src/sim/cutBody.js'
import { tetVolume } from '../src/sim/lattice.js'

const t0 = performance.now()
const model = getBearModel()
const t1 = performance.now()
const L = model.lattice
console.log(`model ${(t1 - t0).toFixed(0)}ms: renderVerts=${model.render.positions.length / 3} tris=${model.render.index.length / 3} cells=${L.cells.length} nodes=${L.nodeIds.length} edges=${L.edgeRest.length} tets=${L.tetRest.length} proxies=${model.proxyPoints.length / 3} r=${model.proxyRadius.toFixed(3)} vol=${model.volume.toFixed(3)} area=${model.area.toFixed(2)}`)

const world = new JellyWorld()
if (process.env.EC) world.params.edgeCompliance = Number(process.env.EC)
const edgeCompliance = world.params.edgeCompliance
let rng = 7
const rand = () => ((rng = (rng * 1664525 + 1013904223) >>> 0) / 4294967296)
const newBear = (x, y, z) => {
  const b = new SoftBody({ lattice: model.lattice, proxyPoints: model.proxyPoints, proxyEmbed: model.proxyEmbed, proxyRadius: model.proxyRadius, data: { soup: model.soup } })
  let qx = rand() - 0.5, qy = rand() - 0.5, qz = rand() - 0.5, qw = rand() - 0.5
  const ql = Math.hypot(qx, qy, qz, qw); qx /= ql; qy /= ql; qz /= ql; qw /= ql
  b.setRigid(qx, qy, qz, qw, x, y, z, 0, -1, 0, (rand() - 0.5) * 3, (rand() - 0.5) * 3, (rand() - 0.5) * 3, ...model.centroid)
  world.add(b)
  return b
}
for (let i = 0; i < 12; i++) newBear((rand() - 0.5) * 7, 1 + i * 0.9, (rand() - 0.5) * 2)

const volRatio = (b) => {
  let v = 0, r = 0
  for (let t = 0; t < b.lat.tetRest.length; t++) {
    v += tetVolume(b.x, b.lat.tets[4 * t], b.lat.tets[4 * t + 1], b.lat.tets[4 * t + 2], b.lat.tets[4 * t + 3]); r += b.lat.tetRest[t]
  }
  return v / r
}
const frames = []
const cutTimes = []
let nan = false
for (let f = 0; f < 600; f++) {
  if (f === 70 || f === 90 || f === 120) {
    // slice a few awake bodies through their centres
    for (const b of world.bodies.filter((b) => b.awake).slice(0, 3)) {
      const c = b.centroid()
      let nx = rand() - 0.5, ny = rand() - 0.5, nz = (rand() - 0.5) * 0.3
      const l = Math.hypot(nx, ny, nz)
      const tc = performance.now()
      const kids = cutBody(model, b, c, [nx / l, ny / l, nz / l], [ny / l, -nx / l, 0], { now: world.time })
      cutTimes.push(performance.now() - tc)
      if (kids) { world.remove(b); kids.forEach((k) => world.add(k)) }
    }
  }
  const ts = performance.now()
  world.step(1 / 60)
  frames.push(performance.now() - ts)
  for (const b of world.bodies) if (!Number.isFinite(b.x[0])) nan = true
}
const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length
const sorted = frames.slice().sort((a, b) => a - b)
const awake = world.bodies.filter((b) => b.awake).length
const ratios = world.bodies.map(volRatio)
const minY = Math.min(...world.bodies.map((b) => Math.min(...Array.from({ length: b.proxyCount }, (_, p) => b.proxyPos[3 * p + 1]))))
console.log(`EC=${edgeCompliance} bodies=${world.bodies.length} nodesTotal=${world.bodies.reduce((s, b) => s + b.n, 0)} frame avg=${avg(frames).toFixed(2)}ms p95=${sorted[Math.floor(sorted.length * 0.95)].toFixed(2)}ms max=${sorted[sorted.length - 1].toFixed(2)}ms`)
console.log(`first 60 frames avg=${avg(frames.slice(0, 60)).toFixed(2)}ms (all awake) | last 60 avg=${avg(frames.slice(-60)).toFixed(2)}ms awakeAtEnd=${awake} NaN=${nan}`)
console.log(`volume ratio min=${Math.min(...ratios).toFixed(3)} max=${Math.max(...ratios).toFixed(3)} | lowest proxy y=${minY.toFixed(3)} (floor ${world.params.floorY}) | cut+build ms: ${cutTimes.map((t) => t.toFixed(1)).join(', ')}`)
