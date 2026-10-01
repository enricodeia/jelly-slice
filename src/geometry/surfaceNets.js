// Naive surface nets: one vertex per grid cell the surface crosses, one quad per
// crossed grid edge. Vertices are then Newton-projected onto the zero set and
// get their normals from the SDF gradient, so the shading is analytic-smooth
// regardless of resolution. Output is an indexed, closed, consistently wound
// (outward, CCW) triangle mesh — the watertightness the CSG cutter relies on.

export function surfaceNets(sdf, min, max, h, { projectIterations = 3 } = {}) {
  const nx = Math.ceil((max[0] - min[0]) / h)
  const ny = Math.ceil((max[1] - min[1]) / h)
  const nz = Math.ceil((max[2] - min[2]) / h)
  const sx = nx + 1
  const sy = ny + 1
  const sz = nz + 1

  const values = new Float32Array(sx * sy * sz)
  for (let k = 0; k < sz; k++) {
    const z = min[2] + k * h
    for (let j = 0; j < sy; j++) {
      const y = min[1] + j * h
      for (let i = 0; i < sx; i++) {
        values[i + sx * (j + sy * k)] = sdf(min[0] + i * h, y, z)
      }
    }
  }
  const val = (i, j, k) => values[i + sx * (j + sy * k)]

  // 12 cube edges as pairs of corner offsets
  const corner = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
    [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
  ]
  const edges = [
    [0, 1], [2, 3], [4, 5], [6, 7],
    [0, 2], [1, 3], [4, 6], [5, 7],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ]

  const cellVert = new Int32Array(nx * ny * nz).fill(-1)
  const cellIndex = (i, j, k) => i + nx * (j + ny * k)
  const pos = []
  const cv = new Float32Array(8)

  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        let mask = 0
        for (let c = 0; c < 8; c++) {
          const v = val(i + corner[c][0], j + corner[c][1], k + corner[c][2])
          cv[c] = v
          if (v < 0) mask |= 1 << c
        }
        if (mask === 0 || mask === 255) continue

        let px = 0, py = 0, pz = 0, n = 0
        for (const [a, b] of edges) {
          const va = cv[a], vb = cv[b]
          if (va < 0 === vb < 0) continue
          const t = va / (va - vb)
          px += corner[a][0] + t * (corner[b][0] - corner[a][0])
          py += corner[a][1] + t * (corner[b][1] - corner[a][1])
          pz += corner[a][2] + t * (corner[b][2] - corner[a][2])
          n++
        }
        cellVert[cellIndex(i, j, k)] = pos.length / 3
        pos.push(min[0] + (i + px / n) * h, min[1] + (j + py / n) * h, min[2] + (k + pz / n) * h)
      }
    }
  }

  const index = []
  const P = pos
  const quad = (a, b, c, d) => {
    // split along the shorter diagonal for better-shaped triangles
    const dac = (P[3 * a] - P[3 * c]) ** 2 + (P[3 * a + 1] - P[3 * c + 1]) ** 2 + (P[3 * a + 2] - P[3 * c + 2]) ** 2
    const dbd = (P[3 * b] - P[3 * d]) ** 2 + (P[3 * b + 1] - P[3 * d + 1]) ** 2 + (P[3 * b + 2] - P[3 * d + 2]) ** 2
    if (dac < dbd) index.push(a, b, c, a, c, d)
    else index.push(a, b, d, b, c, d)
  }
  const emit = (inside, q0, q1, q2, q3) => {
    if (q0 < 0 || q1 < 0 || q2 < 0 || q3 < 0) return
    if (inside) quad(q0, q1, q2, q3)
    else quad(q0, q3, q2, q1)
  }

  // Each crossed grid edge becomes a quad joining the 4 cells around it; the
  // cyclic (a,b) axis order below makes the quad's normal point along +edge
  // when the edge's lower end is inside.
  for (let k = 0; k < sz; k++) {
    for (let j = 0; j < sy; j++) {
      for (let i = 0; i < sx; i++) {
        const v0 = val(i, j, k)
        const in0 = v0 < 0
        if (i < nx && j >= 1 && k >= 1 && j < ny && k < nz && in0 !== val(i + 1, j, k) < 0) {
          emit(in0,
            cellVert[cellIndex(i, j - 1, k - 1)], cellVert[cellIndex(i, j, k - 1)],
            cellVert[cellIndex(i, j, k)], cellVert[cellIndex(i, j - 1, k)])
        }
        if (j < ny && i >= 1 && k >= 1 && i < nx && k < nz && in0 !== val(i, j + 1, k) < 0) {
          emit(in0,
            cellVert[cellIndex(i - 1, j, k - 1)], cellVert[cellIndex(i - 1, j, k)],
            cellVert[cellIndex(i, j, k)], cellVert[cellIndex(i, j, k - 1)])
        }
        if (k < nz && i >= 1 && j >= 1 && i < nx && j < ny && in0 !== val(i, j, k + 1) < 0) {
          emit(in0,
            cellVert[cellIndex(i - 1, j - 1, k)], cellVert[cellIndex(i, j - 1, k)],
            cellVert[cellIndex(i, j, k)], cellVert[cellIndex(i - 1, j, k)])
        }
      }
    }
  }

  const positions = new Float32Array(pos)
  const normals = new Float32Array(positions.length)
  const eps = h * 0.1
  for (let v = 0; v < positions.length; v += 3) {
    let x = positions[v], y = positions[v + 1], z = positions[v + 2]
    let gx = 0, gy = 0, gz = 0
    for (let it = 0; it <= projectIterations; it++) {
      gx = sdf(x + eps, y, z) - sdf(x - eps, y, z)
      gy = sdf(x, y + eps, z) - sdf(x, y - eps, z)
      gz = sdf(x, y, z + eps) - sdf(x, y, z - eps)
      if (it === projectIterations) break
      const g2 = (gx * gx + gy * gy + gz * gz) / (4 * eps * eps)
      if (g2 < 1e-12) break
      const f = sdf(x, y, z)
      let s = f / g2 / (2 * eps)
      // never let a projection step leave the vertex's own neighbourhood
      const stepLen = Math.abs(s) * Math.sqrt(gx * gx + gy * gy + gz * gz)
      if (stepLen > h) s *= h / stepLen
      x -= s * gx
      y -= s * gy
      z -= s * gz
    }
    const gl = Math.hypot(gx, gy, gz) || 1
    positions[v] = x
    positions[v + 1] = y
    positions[v + 2] = z
    normals[v] = gx / gl
    normals[v + 1] = gy / gl
    normals[v + 2] = gz / gl
  }

  return { positions, normals, index: new Uint32Array(index) }
}

// Every undirected edge must be shared by exactly two triangles, once in each
// direction — i.e. closed and consistently oriented.
export function checkManifold(index) {
  const directed = new Map()
  for (let t = 0; t < index.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = index[t + e]
      const b = index[t + ((e + 1) % 3)]
      const key = a * 4294967296 + b
      directed.set(key, (directed.get(key) || 0) + 1)
    }
  }
  let boundary = 0, duplicated = 0
  for (const [key, count] of directed) {
    const a = Math.floor(key / 4294967296)
    const b = key - a * 4294967296
    if (count > 1) duplicated++
    if (!directed.has(b * 4294967296 + a)) boundary++
  }
  return { boundary, duplicated, edges: directed.size }
}
