// Plane cut for closed triangle meshes, O(triangles).
//
// Meshes are triangle soups ({ positions, normals, posId, nextPosId }) where
// `posId` is a topological id shared by every soup vertex at the same point.
// Crossing points are keyed by the posId pair of the edge they sit on, so the
// two triangles sharing an edge get the *same* point (pieces stay watertight)
// and the section segments chain into closed loops by topology. Crossings that
// land on a vertex snap to that vertex's id, degenerate triangles are dropped,
// and any chain that still fails to close (collinear points earcut dropped on
// an earlier cap) is closed geometrically — so pieces can be cut again and
// again. Caps are triangulated with earcut, holes included.

import { ShapeUtils, Vector2 } from 'three'

const KEY = 67108864 // 2^26: ids stay far below this, so a*KEY + b is exact
const SNAP_T = 1e-5

function makeBuilder(capacity) {
  return { p: new Float32Array(capacity * 3), n: new Float32Array(capacity * 3), id: new Int32Array(capacity), s: new Uint8Array(capacity), count: 0 }
}

function grow(b) {
  const cap = b.id.length * 2
  const p = new Float32Array(cap * 3); p.set(b.p); b.p = p
  const n = new Float32Array(cap * 3); n.set(b.n); b.n = n
  const ids = new Int32Array(cap); ids.set(b.id); b.id = ids
  const sk = new Uint8Array(cap); sk.set(b.s); b.s = sk
}

function pushTri(b, v) {
  // v: 3 × [x, y, z, nx, ny, nz, id, skin]
  if (v[0][6] === v[1][6] || v[1][6] === v[2][6] || v[0][6] === v[2][6]) return
  while (b.count + 3 > b.id.length) grow(b)
  for (let k = 0; k < 3; k++) {
    const i = b.count++
    const q = v[k]
    b.p[3 * i] = q[0]; b.p[3 * i + 1] = q[1]; b.p[3 * i + 2] = q[2]
    b.n[3 * i] = q[3]; b.n[3 * i + 1] = q[4]; b.n[3 * i + 2] = q[5]
    b.id[i] = q[6]
    b.s[i] = q[7]
  }
}

function finish(b, nextPosId) {
  return {
    positions: b.p.slice(0, b.count * 3),
    normals: b.n.slice(0, b.count * 3),
    posId: b.id.slice(0, b.count),
    skin: b.s.slice(0, b.count),
    nextPosId,
  }
}

/**
 * Cuts `mesh` by the plane through p with unit normal n.
 * Returns { negative, positive } (either null if the plane misses), each
 * capped with the section; the negative piece's cap faces +n.
 */
export function cutMesh(mesh, px, py, pz, nx, ny, nz) {
  const P = mesh.positions
  const N = mesh.normals
  const ID = mesh.posId
  const S = mesh.skin
  const V = ID.length

  const d = new Float64Array(V)
  let anyNeg = false, anyPos = false
  for (let v = 0; v < V; v++) {
    const dv = (P[3 * v] - px) * nx + (P[3 * v + 1] - py) * ny + (P[3 * v + 2] - pz) * nz
    d[v] = dv
    if (dv < 0) anyNeg = true
    else anyPos = true
  }
  if (!anyNeg || !anyPos) return { negative: anyNeg ? mesh : null, positive: anyPos ? mesh : null }

  const neg = makeBuilder(V)
  const pos = makeBuilder(V)
  let nextId = mesh.nextPosId

  const crossings = new Map() // edge key -> { id, x, y, z, t, loId }
  const pointOf = new Map() // section id -> [x, y, z]

  const crossing = (va, vb) => {
    const ia = ID[va], ib = ID[vb]
    const key = Math.min(ia, ib) * KEY + Math.max(ia, ib)
    let c = crossings.get(key)
    if (c === undefined) {
      const lo = ia < ib ? va : vb
      const hi = ia < ib ? vb : va
      const t = d[lo] / (d[lo] - d[hi])
      if (t < SNAP_T) c = { id: ID[lo], x: P[3 * lo], y: P[3 * lo + 1], z: P[3 * lo + 2], t: 0, loId: ID[lo] }
      else if (t > 1 - SNAP_T) c = { id: ID[hi], x: P[3 * hi], y: P[3 * hi + 1], z: P[3 * hi + 2], t: 1, loId: ID[lo] }
      else {
        c = {
          id: nextId++,
          x: P[3 * lo] + t * (P[3 * hi] - P[3 * lo]),
          y: P[3 * lo + 1] + t * (P[3 * hi + 1] - P[3 * lo + 1]),
          z: P[3 * lo + 2] + t * (P[3 * hi + 2] - P[3 * lo + 2]),
          t,
          loId: ID[lo],
        }
      }
      crossings.set(key, c)
      pointOf.set(c.id, [c.x, c.y, c.z])
    }
    return c
  }

  // skin flags: 1 moulded skin, 2 the section just cut (it glistens), 0 an
  // older section — this cut's pieces inherit last cut's 2s as 0s
  const skinOf = (v) => (S[v] === 2 ? 0 : S[v])

  // the crossing as a vertex of a triangle whose edge runs va→vb: normal
  // interpolated along that triangle's own edge (flat caps stay flat)
  const crossVert = (c, va, vb) => {
    const t = c.loId === ID[va] ? c.t : 1 - c.t
    let x = N[3 * va] + t * (N[3 * vb] - N[3 * va])
    let y = N[3 * va + 1] + t * (N[3 * vb + 1] - N[3 * va + 1])
    let z = N[3 * va + 2] + t * (N[3 * vb + 2] - N[3 * va + 2])
    const l = Math.hypot(x, y, z) || 1
    return [c.x, c.y, c.z, x / l, y / l, z / l, c.id, skinOf(va)]
  }
  const vert = (v) => [P[3 * v], P[3 * v + 1], P[3 * v + 2], N[3 * v], N[3 * v + 1], N[3 * v + 2], ID[v], skinOf(v)]

  const segNext = new Map() // section id -> next section id (negative-cap orientation)

  for (let t = 0; t < V; t += 3) {
    const sa = d[t] >= 0, sb = d[t + 1] >= 0, sc = d[t + 2] >= 0
    if (sa === sb && sb === sc) {
      pushTri(sa ? pos : neg, [vert(t), vert(t + 1), vert(t + 2)])
      continue
    }
    let l, m, o
    if (sa !== sb && sa !== sc) { l = t; m = t + 1; o = t + 2 }
    else if (sb !== sa && sb !== sc) { l = t + 1; m = t + 2; o = t }
    else { l = t + 2; m = t; o = t + 1 }
    const lonelyPos = d[l] >= 0
    const c1 = crossing(l, m)
    const c2 = crossing(o, l)
    const X1 = crossVert(c1, l, m)
    const X2 = crossVert(c2, o, l)

    const bl = lonelyPos ? pos : neg
    const bo = lonelyPos ? neg : pos
    pushTri(bl, [vert(l), X1, X2])
    pushTri(bo, [X1, vert(m), vert(o)])
    pushTri(bo, [X1, vert(o), X2])

    // negative cap runs CCW about +n: from the (+ → −) edge to the (− → +) edge
    const from = lonelyPos ? c1.id : c2.id
    const to = lonelyPos ? c2.id : c1.id
    if (from !== to) segNext.set(from, to)
  }

  capSection(segNext, pointOf, nx, ny, nz, neg, pos)

  return {
    negative: neg.count ? finish(neg, nextId) : null,
    positive: pos.count ? finish(pos, nextId) : null,
  }
}

function buildLoops(segNext, pointOf) {
  const hasPrev = new Set(segNext.values())
  const visited = new Set()
  const loops = []
  const open = []

  const walk = (start) => {
    const chain = []
    let c = start
    while (c !== undefined && !visited.has(c)) {
      visited.add(c)
      chain.push(c)
      c = segNext.get(c)
    }
    return { chain, closed: c === start }
  }

  // open chains first (they have a start nobody points to), then pure cycles
  for (const s of segNext.keys()) if (!hasPrev.has(s) && !visited.has(s)) open.push(walk(s).chain)
  for (const s of segNext.keys()) {
    if (visited.has(s)) continue
    const { chain, closed } = walk(s)
    if (closed) loops.push(chain)
    else open.push(chain)
  }

  // geometric fallback: join each open chain's end to the nearest open start
  const dist2 = (a, b) => {
    const p = pointOf.get(a), q = pointOf.get(b)
    return (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2
  }
  const TOL2 = 1e-6
  while (open.length) {
    const chain = open.pop()
    let best = -1, bestD = Infinity
    const end = chain[chain.length - 1]
    const selfD = dist2(end, chain[0])
    for (let i = 0; i < open.length; i++) {
      const dd = dist2(end, open[i][0])
      if (dd < bestD) { bestD = dd; best = i }
    }
    if (selfD <= bestD && selfD < TOL2) {
      if (chain.length >= 3) loops.push(chain)
    } else if (best >= 0 && bestD < TOL2) {
      const other = open.splice(best, 1)[0]
      open.push(chain.concat(other))
    } else if (chain.length >= 3 && selfD < 1e-2) {
      loops.push(chain) // last resort: close it as is
    }
  }
  return loops
}

function capSection(segNext, pointOf, nx, ny, nz, neg, pos) {
  // plane basis with u × v = n, so CCW in (u, v) is CCW about +n
  let ux, uy, uz
  if (Math.abs(nx) < 0.9) { ux = 0; uy = nz; uz = -ny } else { ux = -nz; uy = 0; uz = nx }
  const ul = Math.hypot(ux, uy, uz)
  ux /= ul; uy /= ul; uz /= ul
  const vx = ny * uz - nz * uy
  const vy = nz * ux - nx * uz
  const vz = nx * uy - ny * ux

  const loops = []
  for (const ids of buildLoops(segNext, pointOf)) {
    const pts = []
    for (const id of ids) {
      const q = pointOf.get(id)
      pts.push(new Vector2(q[0] * ux + q[1] * uy + q[2] * uz, q[0] * vx + q[1] * vy + q[2] * vz))
    }
    let area = 0
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) area += pts[j].x * pts[i].y - pts[i].x * pts[j].y
    if (Math.abs(area) < 1e-12) continue
    loops.push({ ids, pts, area: area / 2 })
  }

  const outers = loops.filter((l) => l.area > 0).sort((a, b) => a.area - b.area)
  const holesOf = new Map(outers.map((o) => [o, []]))
  for (const hole of loops) {
    if (hole.area > 0) continue
    const owner = outers.find((o) => pointInPolygon(hole.pts[0], o.pts))
    if (owner) holesOf.get(owner).push(hole)
  }

  for (const outer of outers) {
    const holes = holesOf.get(outer)
    const contour = outer.pts.slice()
    const holePts = holes.map((h) => h.pts.slice())
    const ids = outer.ids.concat(...holes.map((h) => h.ids))
    const flat = contour.concat(...holePts)
    let faces
    try {
      faces = ShapeUtils.triangulateShape(contour, holePts)
    } catch {
      continue
    }
    for (const [a, b, c] of faces) {
      let i1 = b, i2 = c
      const A = flat[a], B = flat[b], C = flat[c]
      const cross = (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x)
      if (Math.abs(cross) < 1e-14) continue
      if (cross < 0) { i1 = c; i2 = b }
      const q0 = pointOf.get(ids[a]), q1 = pointOf.get(ids[i1]), q2 = pointOf.get(ids[i2])
      // caps are fresh cut faces: skin 2 (no moulded relief; they glisten)
      pushTri(neg, [
        [q0[0], q0[1], q0[2], nx, ny, nz, ids[a], 2],
        [q1[0], q1[1], q1[2], nx, ny, nz, ids[i1], 2],
        [q2[0], q2[1], q2[2], nx, ny, nz, ids[i2], 2],
      ])
      pushTri(pos, [
        [q0[0], q0[1], q0[2], -nx, -ny, -nz, ids[a], 2],
        [q2[0], q2[1], q2[2], -nx, -ny, -nz, ids[i2], 2],
        [q1[0], q1[1], q1[2], -nx, -ny, -nz, ids[i1], 2],
      ])
    }
  }
}

function pointInPolygon(p, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

// Welds soup vertices that share a posId *and* a normal back into an indexed
// mesh for rendering (the cap seam keeps its split normals).
export function indexSoup(soup) {
  const { positions: P, normals: N, posId: ID, skin: S } = soup
  const V = ID.length
  const byId = new Map()
  const pos = []
  const nor = []
  const skin = []
  const index = new Uint32Array(V)
  for (let v = 0; v < V; v++) {
    const nx = N[3 * v], ny = N[3 * v + 1], nz = N[3 * v + 2]
    let list = byId.get(ID[v])
    let found = -1
    if (list) {
      for (let i = 0; i < list.length; i += 4) {
        if (Math.abs(list[i] - nx) < 1e-4 && Math.abs(list[i + 1] - ny) < 1e-4 && Math.abs(list[i + 2] - nz) < 1e-4) {
          found = list[i + 3]
          break
        }
      }
    } else {
      list = []
      byId.set(ID[v], list)
    }
    if (found < 0) {
      found = pos.length / 3
      pos.push(P[3 * v], P[3 * v + 1], P[3 * v + 2])
      nor.push(nx, ny, nz)
      skin.push(S[v])
      list.push(nx, ny, nz, found)
    }
    index[v] = found
  }
  return { positions: new Float32Array(pos), normals: new Float32Array(nor), skin: new Float32Array(skin), index }
}

// Expands an indexed mesh into the soup form used above (posId = vertex index).
export function soupFromIndexed(positions, normals, index) {
  const T = index.length
  const p = new Float32Array(T * 3)
  const n = new Float32Array(T * 3)
  const id = new Int32Array(T)
  const skin = new Uint8Array(T).fill(1)
  let maxId = 0
  for (let i = 0; i < T; i++) {
    const v = index[i]
    p[3 * i] = positions[3 * v]; p[3 * i + 1] = positions[3 * v + 1]; p[3 * i + 2] = positions[3 * v + 2]
    n[3 * i] = normals[3 * v]; n[3 * i + 1] = normals[3 * v + 1]; n[3 * i + 2] = normals[3 * v + 2]
    id[i] = v
    if (v > maxId) maxId = v
  }
  return { positions: p, normals: n, posId: id, skin, nextPosId: maxId + 1 }
}

// Closed-mesh volume and centroid via the divergence theorem, taken about
// `origin`: for a closed mesh the result doesn't depend on it.
export function meshVolume(mesh, ox = 0, oy = 0, oz = 0) {
  const P = mesh.positions
  let vol = 0, mx = 0, my = 0, mz = 0
  for (let t = 0; t < P.length; t += 9) {
    const ax = P[t] - ox, ay = P[t + 1] - oy, az = P[t + 2] - oz
    const bx = P[t + 3] - ox, by = P[t + 4] - oy, bz = P[t + 5] - oz
    const cx = P[t + 6] - ox, cy = P[t + 7] - oy, cz = P[t + 8] - oz
    const v = (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6
    vol += v
    mx += (v * (ax + bx + cx)) / 4
    my += (v * (ay + by + cy)) / 4
    mz += (v * (az + bz + cz)) / 4
  }
  return { volume: vol, cx: vol ? mx / vol + ox : ox, cy: vol ? my / vol + oy : oy, cz: vol ? mz / vol + oz : oz }
}

// Directed-edge check on posIds: 0 boundary / 0 duplicated = closed & oriented.
export function checkSoupManifold(mesh) {
  const ID = mesh.posId
  const directed = new Map()
  for (let t = 0; t < ID.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = ID[t + e], b = ID[t + ((e + 1) % 3)]
      const k = a * KEY + b
      directed.set(k, (directed.get(k) || 0) + 1)
    }
  }
  let boundary = 0, duplicated = 0
  for (const [k, c] of directed) {
    const a = Math.floor(k / KEY), b = k - a * KEY
    if (c > 1) duplicated++
    if (!directed.has(b * KEY + a)) boundary++
  }
  return { boundary, duplicated }
}
