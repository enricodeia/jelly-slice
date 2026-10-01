// Voxel lattice the soft body lives on. One regular grid in the bear's rest
// frame is shared by every bear and every piece cut from one: a piece is just
// a subset of grid cells, so cutting never re-meshes the simulation — each
// child keeps the parent's cells on its side of the plane (cells the plane
// crosses go to both), and inherits the exact node positions and velocities.
//
// Each cell is split into 6 Kuhn tetrahedra (all sharing the 000–111
// diagonal), which conform across neighbouring cells automatically. Render
// vertices are embedded trilinearly in their cell, collision proxies too.

const KUHN = (() => {
  const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]
  return perms.map(([a, b]) => [0, 1 << a, (1 << a) | (1 << b), 7])
})()

export function createGrid(min, max, s) {
  const pad = s * 0.5
  const origin = [min[0] - pad, min[1] - pad, min[2] - pad]
  const gx = Math.ceil((max[0] - min[0] + 2 * pad) / s)
  const gy = Math.ceil((max[1] - min[1] + 2 * pad) / s)
  const gz = Math.ceil((max[2] - min[2] + 2 * pad) / s)
  return { origin, s, gx, gy, gz }
}

export const cellId = (g, i, j, k) => i + g.gx * (j + g.gy * k)
export const nodeId = (g, i, j, k) => i + (g.gx + 1) * (j + (g.gy + 1) * k)

export function cellCoords(g, id) {
  const i = id % g.gx
  const r = (id - i) / g.gx
  const j = r % g.gy
  return [i, j, (r - j) / g.gy]
}

function nodeCoords(g, id) {
  const sx = g.gx + 1, sy = g.gy + 1
  const i = id % sx
  const r = (id - i) / sx
  const j = r % sy
  return [i, j, (r - j) / sy]
}

/** Cells of the whole bear: interior by the SDF, plus every cell a surface vertex sits in. */
export function bearCells(g, sdf, positions) {
  const set = new Set()
  const { s, origin } = g
  for (let k = 0; k < g.gz; k++)
    for (let j = 0; j < g.gy; j++)
      for (let i = 0; i < g.gx; i++) {
        const x = origin[0] + (i + 0.5) * s, y = origin[1] + (j + 0.5) * s, z = origin[2] + (k + 0.5) * s
        if (sdf(x, y, z) < 0) set.add(cellId(g, i, j, k))
      }
  for (let v = 0; v < positions.length; v += 3) {
    const [i, j, k] = pointCell(g, positions[v], positions[v + 1], positions[v + 2])
    set.add(cellId(g, i, j, k))
  }
  return Int32Array.from([...set].sort((a, b) => a - b))
}

export function pointCell(g, x, y, z) {
  const i = Math.min(g.gx - 1, Math.max(0, Math.floor((x - g.origin[0]) / g.s)))
  const j = Math.min(g.gy - 1, Math.max(0, Math.floor((y - g.origin[1]) / g.s)))
  const k = Math.min(g.gz - 1, Math.max(0, Math.floor((z - g.origin[2]) / g.s)))
  return [i, j, k]
}

/** Nodes, tets and edges for a set of cells. */
export function buildLattice(g, cells) {
  const nodeIndex = new Map() // global node id -> local index
  const nodeIds = []
  const cellNodes = new Int32Array(cells.length * 8)
  const cellIndex = new Map()
  for (let c = 0; c < cells.length; c++) {
    cellIndex.set(cells[c], c)
    const [i, j, k] = cellCoords(g, cells[c])
    for (let q = 0; q < 8; q++) {
      const id = nodeId(g, i + (q & 1), j + ((q >> 1) & 1), k + ((q >> 2) & 1))
      let local = nodeIndex.get(id)
      if (local === undefined) {
        local = nodeIds.length
        nodeIndex.set(id, local)
        nodeIds.push(id)
      }
      cellNodes[8 * c + q] = local
    }
  }

  const n = nodeIds.length
  const rest = new Float64Array(3 * n)
  for (let a = 0; a < n; a++) {
    const [i, j, k] = nodeCoords(g, nodeIds[a])
    rest[3 * a] = g.origin[0] + i * g.s
    rest[3 * a + 1] = g.origin[1] + j * g.s
    rest[3 * a + 2] = g.origin[2] + k * g.s
  }

  const tets = new Int32Array(cells.length * 6 * 4)
  const tetRest = new Float64Array(cells.length * 6)
  const edgeSet = new Map()
  let t = 0
  const addEdge = (a, b) => {
    const key = a < b ? a * 1048576 + b : b * 1048576 + a
    if (!edgeSet.has(key)) edgeSet.set(key, a < b ? [a, b] : [b, a])
  }
  for (let c = 0; c < cells.length; c++) {
    for (const tet of KUHN) {
      let q = tet.map((corner) => cellNodes[8 * c + corner])
      let vol = tetVolume(rest, q[0], q[1], q[2], q[3])
      if (vol < 0) { q = [q[0], q[1], q[3], q[2]]; vol = -vol }
      tets.set(q, 4 * t)
      tetRest[t++] = vol
      addEdge(q[0], q[1]); addEdge(q[0], q[2]); addEdge(q[0], q[3])
      addEdge(q[1], q[2]); addEdge(q[1], q[3]); addEdge(q[2], q[3])
    }
  }
  const edges = new Int32Array(edgeSet.size * 2)
  const edgeRest = new Float64Array(edgeSet.size)
  let e = 0
  for (const [a, b] of edgeSet.values()) {
    edges[2 * e] = a
    edges[2 * e + 1] = b
    edgeRest[e++] = Math.hypot(rest[3 * b] - rest[3 * a], rest[3 * b + 1] - rest[3 * a + 1], rest[3 * b + 2] - rest[3 * a + 2])
  }

  return { cells, cellIndex, cellNodes, nodeIds: Int32Array.from(nodeIds), nodeIndex, rest, tets, tetRest, edges, edgeRest }
}

export function tetVolume(x, a, b, c, d) {
  const ax = x[3 * a], ay = x[3 * a + 1], az = x[3 * a + 2]
  const b0 = x[3 * b] - ax, b1 = x[3 * b + 1] - ay, b2 = x[3 * b + 2] - az
  const c0 = x[3 * c] - ax, c1 = x[3 * c + 1] - ay, c2 = x[3 * c + 2] - az
  const d0 = x[3 * d] - ax, d1 = x[3 * d + 1] - ay, d2 = x[3 * d + 2] - az
  return ((b1 * c2 - b2 * c1) * d0 + (b2 * c0 - b0 * c2) * d1 + (b0 * c1 - b1 * c0) * d2) / 6
}

/**
 * Trilinear embedding of points in the lattice: for each point, the local
 * index of its cell and its (u, v, w) inside it. Points whose cell isn't part
 * of the lattice (a rounding edge case) fall back to the nearest cell that is.
 */
export function embedPoints(g, lat, positions) {
  const count = positions.length / 3
  const cellOf = new Int32Array(count)
  const uvw = new Float32Array(count * 3)
  const { s, origin } = g
  for (let p = 0; p < count; p++) {
    const x = positions[3 * p], y = positions[3 * p + 1], z = positions[3 * p + 2]
    const [i, j, k] = pointCell(g, x, y, z)
    let c = lat.cellIndex.get(cellId(g, i, j, k))
    let ci = i, cj = j, ck = k
    if (c === undefined) {
      let best = Infinity
      for (let dk = -1; dk <= 1; dk++)
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++) {
            const ni = i + di, nj = j + dj, nk = k + dk
            if (ni < 0 || nj < 0 || nk < 0 || ni >= g.gx || nj >= g.gy || nk >= g.gz) continue
            const cc = lat.cellIndex.get(cellId(g, ni, nj, nk))
            if (cc === undefined) continue
            const dd = di * di + dj * dj + dk * dk
            if (dd < best) { best = dd; c = cc; ci = ni; cj = nj; ck = nk }
          }
      if (c === undefined) c = 0
    }
    cellOf[p] = c
    uvw[3 * p] = (x - origin[0]) / s - ci
    uvw[3 * p + 1] = (y - origin[1]) / s - cj
    uvw[3 * p + 2] = (z - origin[2]) / s - ck
  }
  return { cellOf, uvw }
}

/** Farthest-point sample of `count` points from `positions` (deduped by posId). */
export function farthestPoints(positions, posId, count) {
  const seen = new Set()
  const cand = []
  for (let v = 0; v < posId.length; v++) {
    if (seen.has(posId[v])) continue
    seen.add(posId[v])
    cand.push(v)
  }
  // thin the pool so FPS stays cheap on big pieces
  const stride = Math.max(1, Math.floor(cand.length / 1500))
  const pool = cand.filter((_, i) => i % stride === 0)
  const m = pool.length
  const picked = []
  const dist = new Float64Array(m).fill(Infinity)
  let cur = 0
  let spacing = 0
  for (let n = 0; n < Math.min(count, m); n++) {
    picked.push(pool[cur])
    const v = pool[cur]
    const px = positions[3 * v], py = positions[3 * v + 1], pz = positions[3 * v + 2]
    let far = -1, farD = -1
    for (let i = 0; i < m; i++) {
      const u = pool[i]
      const dd = (positions[3 * u] - px) ** 2 + (positions[3 * u + 1] - py) ** 2 + (positions[3 * u + 2] - pz) ** 2
      if (dd < dist[i]) dist[i] = dd
      if (dist[i] > farD) { farD = dist[i]; far = i }
    }
    spacing = Math.sqrt(Math.max(farD, 0))
    cur = far
  }
  const out = new Float32Array(picked.length * 3)
  picked.forEach((v, i) => {
    out[3 * i] = positions[3 * v]; out[3 * i + 1] = positions[3 * v + 1]; out[3 * i + 2] = positions[3 * v + 2]
  })
  return { points: out, spacing }
}

export function surfaceArea(positions) {
  let a = 0
  for (let t = 0; t < positions.length; t += 9) {
    const ux = positions[t + 3] - positions[t], uy = positions[t + 4] - positions[t + 1], uz = positions[t + 5] - positions[t + 2]
    const vx = positions[t + 6] - positions[t], vy = positions[t + 7] - positions[t + 1], vz = positions[t + 8] - positions[t + 2]
    a += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2
  }
  return a
}
