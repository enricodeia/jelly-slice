// The knife's response, off-screen: a resting bear, zero gravity, one cut
// through its middle, then the pieces' centre-of-mass velocity and spin as the
// solver runs, at 60 fps and in slow motion. The COM velocity right after the
// cut is exactly the knife's impulse (the constraints conserve momentum);
// anything that changes it afterwards is the solver, not the knife.
//   node tools/bench-knife.mjs [speed=16]
import { getBearModel } from '../src/geometry/bearModel.js'
import { SoftBody, JellyWorld } from '../src/sim/world.js'
import { cutBody } from '../src/sim/cutBody.js'

const speed = Number(process.argv[2] || 16)
const model = getBearModel()

function com(b) {
  const c = b.centroid()
  let vx = 0, vy = 0, vz = 0
  for (let a = 0; a < b.n; a++) { vx += b.v[3 * a]; vy += b.v[3 * a + 1]; vz += b.v[3 * a + 2] }
  vx /= b.n; vy /= b.n; vz /= b.n
  let lz = 0, I = 0
  for (let a = 0; a < b.n; a++) {
    const rx = b.x[3 * a] - c[0], ry = b.x[3 * a + 1] - c[1]
    lz += rx * (b.v[3 * a + 1] - vy) - ry * (b.v[3 * a] - vx)
    I += rx * rx + ry * ry
  }
  const r = (x) => x.toFixed(3).padStart(7)
  return `v=(${r(vx)},${r(vy)},${r(vz)}) ωz=${r(lz / I)}`
}

for (const dt of [1 / 60, 1 / 600]) {
  const world = new JellyWorld()
  world.params.floorY = -Infinity
  world.params.walls = null
  world.params.gravity = 0
  world.params.edgeCompliance = Math.pow(10, -3.7 - 1.6 * 0.65)
  const bear = new SoftBody({ lattice: model.lattice, proxyPoints: model.proxyPoints, proxyEmbed: model.proxyEmbed, proxyRadius: model.proxyRadius, data: { soup: model.soup, render: model.render, volume: model.volume } })
  bear.setRigid(0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...model.centroid)
  world.add(bear)
  const c = bear.centroid()
  // camera-like plane: horizontal through the middle, eye in front
  const kids = cutBody(model, bear, [c[0], c[1], c[2] + 11], [0, -1, 0], [1, 0, 0], { speed, now: 0 })
  world.remove(bear)
  for (const k of kids) world.add(k)
  console.log(`\ndt=${dt.toFixed(4)}  speed=${speed}`)
  console.log('  t=0      ', kids.map(com).join('   '))
  let t = 0
  for (const mark of [0.02, 0.05, 0.1, 0.2, 0.4, 0.8]) {
    while (t < mark - 1e-9) { world.step(dt); t += dt }
    console.log(`  t=${mark.toFixed(2)}   `, kids.map(com).join('   '))
  }
}
