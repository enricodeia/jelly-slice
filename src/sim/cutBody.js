// Cutting a soft body: map the world-space swipe plane into the body's rest
// frame through its best-fit affine deformation, cut the rest mesh there, and
// give each piece the parent's lattice cells on its side (cells the plane
// crosses go to both). Children copy node positions and velocities from the
// parent by global node id, so the cut is seamless.
//
// Then the knife acts on the pieces, as velocity changes on the nodes (the
// solver turns them into motion, spin and wobble — nothing is scripted):
// - wedge: the blade's thickness shoves the material near the section away
//   from the plane — each half is squashed at its cut face and springs back;
// - shear: friction drags the cut faces along the blade, so each half lurches
//   at its face while its far end lags: a torque, opposite on the two halves,
//   that tumbles them apart;
// - carry: a share of the blade's momentum, for the whole piece.
// All three grow with the blade's real speed and saturate, so a lazy stroke
// parts the bear and a fast slash flings the halves.

import { cutMesh, indexSoup, meshVolume } from '../geometry/planeCut.js'
import { buildLattice, cellCoords, embedPoints, farthestPoints, surfaceArea } from './lattice.js'
import { SoftBody } from './world.js'
import { BEAR_PROXIES } from '../geometry/bearModel.js'

/** Least-squares affine fit rest → current: x ≈ c + A (X − C). */
export function affineFit(body) {
  const { x, n } = body
  const X = body.lat.rest
  let cx = 0, cy = 0, cz = 0, Cx = 0, Cy = 0, Cz = 0
  for (let a = 0; a < n; a++) {
    cx += x[3 * a]; cy += x[3 * a + 1]; cz += x[3 * a + 2]
    Cx += X[3 * a]; Cy += X[3 * a + 1]; Cz += X[3 * a + 2]
  }
  cx /= n; cy /= n; cz /= n; Cx /= n; Cy /= n; Cz /= n
  const Apq = new Float64Array(9)
  const Aqq = new Float64Array(9)
  for (let a = 0; a < n; a++) {
    const p = [x[3 * a] - cx, x[3 * a + 1] - cy, x[3 * a + 2] - cz]
    const q = [X[3 * a] - Cx, X[3 * a + 1] - Cy, X[3 * a + 2] - Cz]
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++) {
        Apq[3 * r + c] += p[r] * q[c]
        Aqq[3 * r + c] += q[r] * q[c]
      }
  }
  const A = mul3(Apq, inv3(Aqq))
  return { A, c: [cx, cy, cz], C: [Cx, Cy, Cz] }
}

export function worldPlaneToRest(body, p, n) {
  const { A, c, C } = affineFit(body)
  const Ai = inv3(A)
  const d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]]
  const pr = [
    C[0] + Ai[0] * d[0] + Ai[1] * d[1] + Ai[2] * d[2],
    C[1] + Ai[3] * d[0] + Ai[4] * d[1] + Ai[5] * d[2],
    C[2] + Ai[6] * d[0] + Ai[7] * d[1] + Ai[8] * d[2],
  ]
  // planes transform as covectors: n_rest ∝ Aᵀ n
  const nr = [
    A[0] * n[0] + A[3] * n[1] + A[6] * n[2],
    A[1] * n[0] + A[4] * n[1] + A[7] * n[2],
    A[2] * n[0] + A[5] * n[1] + A[8] * n[2],
  ]
  const l = Math.hypot(nr[0], nr[1], nr[2]) || 1
  return { p: pr, n: [nr[0] / l, nr[1] / l, nr[2] / l] }
}

function cellsOnSide(grid, cells, p, n, negative) {
  const { s, origin } = grid
  const lo = s * (Math.min(0, n[0]) + Math.min(0, n[1]) + Math.min(0, n[2]))
  const hi = s * (Math.max(0, n[0]) + Math.max(0, n[1]) + Math.max(0, n[2]))
  const out = []
  for (let c = 0; c < cells.length; c++) {
    const [i, j, k] = cellCoords(grid, cells[c])
    const d0 = (origin[0] + i * s - p[0]) * n[0] + (origin[1] + j * s - p[1]) * n[1] + (origin[2] + k * s - p[2]) * n[2]
    if (negative ? d0 + lo < 0 : d0 + hi >= 0) out.push(cells[c])
  }
  return Int32Array.from(out)
}

/**
 * Builds the soft body for one piece (`soup` in the shared rest frame).
 * `parent` (optional) seeds node positions/velocities by global node id.
 */
export function makePieceBody(model, soup, cells, parent, data) {
  const lattice = buildLattice(model.grid, cells)
  const render = indexSoup(soup)
  render.embed = embedPoints(model.grid, lattice, render.positions)
  const area = surfaceArea(soup.positions)
  const proxyCount = Math.max(10, Math.min(BEAR_PROXIES, Math.round((BEAR_PROXIES * area) / model.area)))
  const fps = farthestPoints(soup.positions, soup.posId, proxyCount)
  const body = new SoftBody({
    lattice,
    proxyPoints: fps.points,
    proxyEmbed: embedPoints(model.grid, lattice, fps.points),
    proxyRadius: Math.min(model.proxyRadius, Math.max(0.035, fps.spacing * 0.55)),
    data,
  })
  if (parent) {
    for (let a = 0; a < body.n; a++) {
      const pa = parent.lat.nodeIndex.get(lattice.nodeIds[a])
      for (let d = 0; d < 3; d++) {
        body.x[3 * a + d] = parent.x[3 * pa + d]
        body.v[3 * a + d] = parent.v[3 * pa + d]
      }
    }
    body.prev.set(body.x)
    body.updateProxies()
  }
  const vol = meshVolume(soup)
  body.data = { ...data, soup, render, volume: vol.volume }
  return body
}

const SECTION = 0.2 // reach of the knife's contact into each piece (≈ one lattice cell)
const FAST = 18 // blade speed (world units/s) at which the response is ~63% saturated

/**
 * Cuts `body` with the world plane (p, n). `blade` = the knife's direction of
 * travel (world, unit, in the plane), `speed` its speed at the body (world
 * units/s). Returns the two child bodies, or null if the plane misses it.
 */
export function cutBody(
  model,
  body,
  p,
  n,
  blade,
  { speed = FAST, impulse = 1, drag = 1, carry = 1, minVolume = 0, minThickness = 0, now = 0, grace = 0.25 } = {}
) {
  const rest = worldPlaneToRest(body, p, n)
  const soup = body.data.soup
  const { negative, positive } = cutMesh(soup, rest.p[0], rest.p[1], rest.p[2], rest.n[0], rest.n[1], rest.n[2])
  if (!negative || !positive || negative === soup || positive === soup) return null
  const vn = meshVolume(negative).volume
  const vp = meshVolume(positive).volume
  if (vn < minVolume || vp < minVolume) return null
  // volume / area ≈ half a slab's thickness: refuse paper-thin slices, which
  // crinkle on the lattice like a sheet instead of wobbling like jelly
  if (minThickness > 0 && (vn / surfaceArea(negative.positions) < minThickness || vp / surfaceArea(positive.positions) < minThickness)) return null

  const cells = body.lat.cells
  const kids = [
    makePieceBody(model, negative, cellsOnSide(model.grid, cells, rest.p, rest.n, true), body, { ...body.data }),
    makePieceBody(model, positive, cellsOnSide(model.grid, cells, rest.p, rest.n, false), body, { ...body.data }),
  ]

  // the knife: wedge along ±n, shear and carry along the blade (see top)
  const k = 1 - Math.exp(-Math.max(0, speed) / FAST)
  const wedge = impulse * (0.6 + 1.3 * k)
  const shear = drag * (0.6 + 4.6 * k)
  const along = carry * 1.1 * k
  kids.forEach((kid, i) => {
    const side = i === 0 ? -1 : 1
    const { x, v } = kid
    for (let a = 0; a < kid.n; a++) {
      const dist = Math.abs((x[3 * a] - p[0]) * n[0] + (x[3 * a + 1] - p[1]) * n[1] + (x[3 * a + 2] - p[2]) * n[2])
      const f = Math.exp(-dist / SECTION)
      const push = wedge * (0.3 + 0.7 * f) * side
      const pull = shear * f + along
      v[3 * a] += n[0] * push + blade[0] * pull
      v[3 * a + 1] += n[1] * push + blade[1] * pull
      v[3 * a + 2] += n[2] * push + blade[2] * pull
    }
    kid.awake = true
  })
  // siblings share the section's proxies at birth: they don't collide for
  // `grace`, and after that for as long as they still overlap (up to 1.5 s)
  const nc = { until: now + grace, hard: now + 1.5 }
  kids[0].noCollide = nc
  kids[1].noCollide = nc
  return kids
}

function inv3(m) {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g
  const det = a * A + b * B + c * C
  const id = Math.abs(det) < 1e-12 ? 0 : 1 / det
  if (!id) return [1, 0, 0, 0, 1, 0, 0, 0, 1]
  return [
    A * id, -(b * i - c * h) * id, (b * f - c * e) * id,
    B * id, (a * i - c * g) * id, -(a * f - c * d) * id,
    C * id, -(a * h - b * g) * id, (a * e - b * d) * id,
  ]
}

function mul3(a, b) {
  const o = new Float64Array(9)
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) o[3 * r + c] = a[3 * r] * b[c] + a[3 * r + 1] * b[3 + c] + a[3 * r + 2] * b[6 + c]
  return o
}
