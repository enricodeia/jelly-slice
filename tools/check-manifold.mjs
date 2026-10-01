// Scans mesh-cell sizes for a watertight, manifold Goldbear and prints where
// any non-manifold edges sit (so the SDF feature causing them can be fixed).
import { sdBear, BEAR_BOUNDS } from '../src/geometry/sdfBear.js'
import { surfaceNets } from '../src/geometry/surfaceNets.js'
const cells = (process.env.CELLS || '0.036,0.035,0.034,0.033,0.032,0.031,0.03').split(',').map(Number)
for (const h of cells) {
  const m = surfaceNets(sdBear, BEAR_BOUNDS.min, BEAR_BOUNDS.max, h)
  const I = m.index, P = m.positions
  const dir = new Map()
  for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = I[t + e], b = I[t + ((e + 1) % 3)], k = a * 1e6 + b
    dir.set(k, (dir.get(k) || 0) + 1)
  }
  const spots = new Set()
  let boundary = 0
  for (const [k, c] of dir) {
    const a = Math.floor(k / 1e6), b = k - a * 1e6
    if (!dir.has(b * 1e6 + a)) boundary++
    if (c > 1) spots.add([P[3 * a], P[3 * a + 1], P[3 * a + 2]].map((v) => v.toFixed(2)).join(','))
  }
  console.log(`h=${h} tris=${I.length / 3} boundary=${boundary} dup=${spots.size ? [...spots].join(' | ') : 0}`)
}
