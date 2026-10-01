import { sdBear, BEAR_BOUNDS } from '../src/geometry/sdfBear.js'
import { surfaceNets } from '../src/geometry/surfaceNets.js'
import { cutMesh, soupFromIndexed, meshVolume, checkSoupManifold } from '../src/geometry/planeCut.js'

const m = surfaceNets(sdBear, BEAR_BOUNDS.min, BEAR_BOUNDS.max, 0.04)
const bear = soupFromIndexed(m.positions, m.normals, m.index)
const V0 = meshVolume(bear).volume
const closedness = (p) => {
  const a = meshVolume(p).volume, b = meshVolume(p, 7, -5, 9).volume
  return Math.abs(a - b) / Math.max(Math.abs(a), 1e-9)
}
console.log('bear tris', bear.posId.length / 3, 'volume', V0.toFixed(4), JSON.stringify(checkSoupManifold(bear)))

let rng = 987
const rand = () => ((rng = (rng * 1664525 + 1013904223) >>> 0) / 4294967296)
const planes = [[1, 0, 0, 0], [0, 1, 0, 0.05], [0, 0, 1, 0]] // symmetric/degenerate first
let pieces = [bear]
const times = []
let open = 0, nonManifold = 0, worst = 0
for (let round = 0; round < 7; round++) {
  const next = []
  for (const piece of pieces) {
    const c = meshVolume(piece)
    let nx, ny, nz, off = 0
    if (round < planes.length) [nx, ny, nz, off] = planes[round]
    else { nx = rand() - 0.5; ny = rand() - 0.5; nz = rand() - 0.5 }
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l
    const px = round < planes.length ? 0 : c.cx + (rand() - 0.5) * 0.1
    const py = round < planes.length ? off : c.cy + (rand() - 0.5) * 0.1
    const pz = round < planes.length ? 0 : c.cz
    const t0 = performance.now()
    const { negative, positive } = cutMesh(piece, px, py, pz, nx, ny, nz)
    times.push(performance.now() - t0)
    for (const p of [negative, positive]) {
      if (!p) continue
      const cl = closedness(p)
      worst = Math.max(worst, cl)
      if (cl > 1e-3) open++
      const mf = checkSoupManifold(p)
      if (mf.boundary || mf.duplicated) nonManifold++
      next.push(p)
    }
  }
  pieces = next
  const total = pieces.reduce((s, p) => s + meshVolume(p).volume, 0)
  console.log(`round ${round + 1}: pieces=${pieces.length} volErr=${(Math.abs(total - V0) / V0 * 100).toFixed(4)}% open(>0.1%)=${open} topoNonManifold=${nonManifold} worstOriginDependence=${(worst * 100).toFixed(4)}%`)
}
times.sort((a, b) => a - b)
console.log(`cut times: median ${times[times.length >> 1].toFixed(2)}ms, p95 ${times[Math.floor(times.length * 0.95)].toFixed(2)}ms, max ${times[times.length - 1].toFixed(2)}ms over ${times.length} cuts`)
