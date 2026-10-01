// XPBD soft bodies on the voxel lattice ("small steps": many substeps, one
// constraint iteration each — Macklin 2019). Per body: edge-length and
// tet-volume constraints. Collisions act on *proxies* — points sampled on the
// visual surface and embedded trilinearly in the lattice — so a piece rests
// with its skin on the table, not with its lattice cell corners; a proxy
// correction Δ is spread over its cell's 8 nodes as w_k Δ / Σw², which moves
// the proxy by exactly Δ.

import { tetVolume } from './lattice.js'

export class SoftBody {
  constructor({ lattice, proxyPoints, proxyEmbed, proxyRadius, data }) {
    this.lat = lattice
    const n = lattice.nodeIds.length
    this.n = n
    // Float64 state: typed float32 access pays a conversion on every read/write
    this.x = new Float64Array(3 * n)
    this.prev = new Float64Array(3 * n)
    this.v = new Float64Array(3 * n)

    const P = proxyPoints.length / 3
    this.proxyCount = P
    this.proxyRadius = proxyRadius
    this.proxyNodes = new Int32Array(8 * P)
    this.proxyW = new Float64Array(8 * P)
    this.proxyInvW2 = new Float64Array(P)
    this.proxyPos = new Float64Array(3 * P)
    for (let p = 0; p < P; p++) {
      const c = proxyEmbed.cellOf[p]
      const u = clamp01(proxyEmbed.uvw[3 * p]), v = clamp01(proxyEmbed.uvw[3 * p + 1]), w = clamp01(proxyEmbed.uvw[3 * p + 2])
      let w2 = 0
      for (let q = 0; q < 8; q++) {
        const wq = (q & 1 ? u : 1 - u) * (q & 2 ? v : 1 - v) * (q & 4 ? w : 1 - w)
        this.proxyNodes[8 * p + q] = lattice.cellNodes[8 * c + q]
        this.proxyW[8 * p + q] = wq
        w2 += wq * wq
      }
      this.proxyInvW2[p] = 1 / Math.max(w2, 1e-6)
    }
    this.aabb = new Float64Array(6)
    this.contacts = new Int32Array(P) // proxies that touched the floor this substep
    this.contactCount = 0
    this.inContact = false
    this.impactVy = 0

    this.awake = true
    this.touching = false
    this.calm = 0
    this.age = 0
    this.offset = -1
    this.noCollide = null // { until, hard }: shared by the two halves of one cut
    this.data = data // app-side payload (meshes, soup, colour…)
  }

  setRigid(qx, qy, qz, qw, tx, ty, tz, vx = 0, vy = 0, vz = 0, wx = 0, wy = 0, wz = 0, cx = 0, cy = 0, cz = 0) {
    // rest nodes rotated by q about rest point c, moved to t; velocity v + ω × r
    const R = quatToMat(qx, qy, qz, qw)
    const r = this.lat.rest
    for (let a = 0; a < this.n; a++) {
      const px = r[3 * a] - cx, py = r[3 * a + 1] - cy, pz = r[3 * a + 2] - cz
      const x = R[0] * px + R[1] * py + R[2] * pz
      const y = R[3] * px + R[4] * py + R[5] * pz
      const z = R[6] * px + R[7] * py + R[8] * pz
      this.x[3 * a] = x + tx; this.x[3 * a + 1] = y + ty; this.x[3 * a + 2] = z + tz
      this.v[3 * a] = vx + (wy * z - wz * y)
      this.v[3 * a + 1] = vy + (wz * x - wx * z)
      this.v[3 * a + 2] = vz + (wx * y - wy * x)
    }
    this.prev.set(this.x)
    this.updateProxies()
  }

  updateProxies() {
    const { x, proxyNodes: N, proxyW: W, proxyPos: out, aabb } = this
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity
    for (let p = 0; p < this.proxyCount; p++) {
      let px = 0, py = 0, pz = 0
      for (let q = 0; q < 8; q++) {
        const a = N[8 * p + q], w = W[8 * p + q]
        px += w * x[3 * a]; py += w * x[3 * a + 1]; pz += w * x[3 * a + 2]
      }
      out[3 * p] = px; out[3 * p + 1] = py; out[3 * p + 2] = pz
      if (px < x0) x0 = px
      if (px > x1) x1 = px
      if (py < y0) y0 = py
      if (py > y1) y1 = py
      if (pz < z0) z0 = pz
      if (pz > z1) z1 = pz
    }
    aabb[0] = x0; aabb[1] = y0; aabb[2] = z0; aabb[3] = x1; aabb[4] = y1; aabb[5] = z1
  }

  // move proxy p by (dx, dy, dz), spread over its cell nodes
  displaceProxy(p, dx, dy, dz) {
    const s = this.proxyInvW2[p]
    const { x, proxyNodes: N, proxyW: W } = this
    for (let q = 0; q < 8; q++) {
      const a = N[8 * p + q], w = W[8 * p + q] * s
      x[3 * a] += w * dx; x[3 * a + 1] += w * dy; x[3 * a + 2] += w * dz
    }
    this.proxyPos[3 * p] += dx; this.proxyPos[3 * p + 1] += dy; this.proxyPos[3 * p + 2] += dz
  }

  centroid(out = [0, 0, 0]) {
    let cx = 0, cy = 0, cz = 0
    for (let a = 0; a < this.n; a++) { cx += this.x[3 * a]; cy += this.x[3 * a + 1]; cz += this.x[3 * a + 2] }
    out[0] = cx / this.n; out[1] = cy / this.n; out[2] = cz / this.n
    return out
  }

  wake() {
    if (this.awake) return
    // it wasn't integrated while asleep: restart its velocity bookkeeping here
    this.prev.set(this.x)
    this.v.fill(0)
    this.awake = true
    this.calm = 0
  }
}

export class JellyWorld {
  constructor({ texWidth = 1024, texHeight = 48 } = {}) {
    this.bodies = []
    this.texWidth = texWidth
    this.texHeight = texHeight
    this.texData = new Float32Array(texWidth * texHeight * 4)
    this.capacity = texWidth * texHeight
    this.free = [] // [offset, size]
    this.top = 0
    this.time = 0

    this.params = {
      gravity: 9.8,
      substeps: 6,
      contactEvery: 1, // body-vs-body contact every N substeps: skipping any makes stacks buzz
      contactRelax: 0.5, // share of a body-body overlap resolved per pass (full = jitter)
      depenetration: 1, // max speed (units/s) an overlap that predates the substep is pushed out at
      edgeCompliance: 2e-5,
      volumeCompliance: 0,
      damping: 0.08,
      airDrag: 0.15,
      floorY: -2.2, // -Infinity: no table (bodies fall through and away)
      floorFriction: 0.8,
      restitution: 0.25, // rebound speed cap, as a share of the landing speed
      contactDrag: 1.5, // 1/s viscous drag while touching anything: stops rocking and creep
      walls: { minX: -5, maxX: 5, minZ: -2.5, maxZ: 2.5 }, // null: none
      sleepSpeed: 0.06,
      sleepTime: 0.5,
    }

    this._hcap = 0
  }

  alloc(size) {
    for (let i = 0; i < this.free.length; i++) {
      const [off, len] = this.free[i]
      if (len >= size) {
        if (len === size) this.free.splice(i, 1)
        else this.free[i] = [off + size, len - size]
        return off
      }
    }
    if (this.top + size > this.capacity) return -1
    const off = this.top
    this.top += size
    return off
  }

  release(off, size) {
    this.free.push([off, size])
    this.free.sort((a, b) => a[0] - b[0])
    const merged = []
    for (const r of this.free) {
      const last = merged[merged.length - 1]
      if (last && last[0] + last[1] === r[0]) last[1] += r[1]
      else merged.push([r[0], r[1]])
    }
    const last = merged[merged.length - 1]
    if (last && last[0] + last[1] === this.top) {
      this.top = last[0]
      merged.pop()
    }
    this.free = merged
  }

  add(body) {
    const off = this.alloc(body.n)
    if (off < 0) return false
    body.offset = off
    body.updateProxies()
    this.bodies.push(body)
    this.writeBody(body)
    return true
  }

  remove(body) {
    const i = this.bodies.indexOf(body)
    if (i >= 0) this.bodies.splice(i, 1)
    if (body.offset >= 0) this.release(body.offset, body.n)
    body.offset = -1
  }

  writeBody(body) {
    const t = this.texData
    const x = body.x
    let o = body.offset * 4
    for (let a = 0; a < body.n; a++, o += 4) {
      t[o] = x[3 * a]; t[o + 1] = x[3 * a + 1]; t[o + 2] = x[3 * a + 2]
    }
  }

  step(dt) {
    const prm = this.params
    const sub = prm.substeps
    const h = dt / sub
    const aE = prm.edgeCompliance / (h * h)
    const aV = prm.volumeCompliance / (h * h)
    const drag = Math.max(0, 1 - prm.airDrag * h)
    const gh = prm.gravity * h
    // `damping` is per substep at 60 fps (h = 1/360 s): keep it per *second*,
    // or slow motion (hit-stop) and 120 Hz screens would over-damp the wobble
    const damp = 1 - Math.pow(1 - Math.min(prm.damping, 0.99), h * 360)
    const bodies = this.bodies

    for (let s = 0; s < sub; s++) {
      for (let bi = 0; bi < bodies.length; bi++) {
        const b = bodies[bi]
        if (!b.awake) continue
        const { x, prev, v } = b
        prev.set(x)
        for (let i = 0; i < 3 * b.n; i += 3) {
          v[i] *= drag
          v[i + 1] = (v[i + 1] - gh) * drag
          v[i + 2] *= drag
          x[i] += v[i] * h
          x[i + 1] += v[i + 1] * h
          x[i + 2] += v[i + 2] * h
        }
        solveEdges(b, aE)
        solveVolumes(b, aV)
      }

      this.collideStatic()
      if (s % prm.contactEvery === prm.contactEvery - 1) this.collideBodies(h * prm.contactEvery)

      const inv = 1 / h
      for (let bi = 0; bi < bodies.length; bi++) {
        const b = bodies[bi]
        if (!b.awake) continue
        const { x, prev, v } = b
        for (let i = 0; i < 3 * b.n; i++) v[i] = (x[i] - prev[i]) * inv
        dampEdges(b, damp)
        if (b.contactCount) limitRebound(b, prm.restitution)
        else b.inContact = false
        if (b.touching) {
          const k = Math.max(0, 1 - prm.contactDrag * h)
          for (let i = 0; i < v.length; i++) v[i] *= k
        }
      }
    }

    this.time += dt
    for (const b of bodies) {
      b.age += dt
      if (!b.awake) continue
      let maxV2 = 0, sum2 = 0
      const v = b.v
      for (let i = 0; i < 3 * b.n; i += 3) {
        const s2 = v[i] * v[i] + v[i + 1] * v[i + 1] + v[i + 2] * v[i + 2]
        sum2 += s2
        if (s2 > maxV2) maxV2 = s2
      }
      const rms2 = sum2 / b.n
      const sl = prm.sleepSpeed
      if (rms2 < sl * sl && maxV2 < 9 * sl * sl && b.touching) b.calm += dt
      else b.calm = 0
      if (b.calm > prm.sleepTime) {
        b.awake = false
        v.fill(0)
      }
      this.writeBody(b)
    }
  }

  // floor (with friction) and the tray walls, on every awake proxy
  collideStatic() {
    const prm = this.params
    const { floorY, floorFriction: mu } = prm
    const W = prm.walls
    for (const b of this.bodies) {
      if (!b.awake) continue
      b.updateProxies()
      b.touching = false
      b.contactCount = 0
      if (b.aabb[1] >= floorY && (!W || (b.aabb[0] >= W.minX && b.aabb[3] <= W.maxX && b.aabb[2] >= W.minZ && b.aabb[5] <= W.maxZ))) continue
      const { x: X, prev, proxyNodes: N, proxyW: Wt } = b
      for (let p = 0; p < b.proxyCount; p++) {
        // fresh from the nodes: a neighbour in the same cell may already have
        // moved them, and a stale position would apply its correction twice
        let x = 0, y = 0, z = 0
        for (let q = 0; q < 8; q++) {
          const a = N[8 * p + q], w = Wt[8 * p + q]
          x += w * X[3 * a]; y += w * X[3 * a + 1]; z += w * X[3 * a + 2]
        }
        let dx = 0, dy = 0, dz = 0
        if (y < floorY) {
          // friction: cancel part of this substep's sliding across the table
          let ox = 0, oz = 0
          for (let q = 0; q < 8; q++) {
            const a = N[8 * p + q], w = Wt[8 * p + q]
            ox += w * prev[3 * a]; oz += w * prev[3 * a + 2]
          }
          dx = -(x - ox) * mu
          dy = floorY - y
          dz = -(z - oz) * mu
          b.touching = true
          b.contacts[b.contactCount++] = p
        }
        if (W) {
          const nx = x + dx, nz = z + dz
          if (nx < W.minX) dx += W.minX - nx
          else if (nx > W.maxX) dx += W.maxX - nx
          if (nz < W.minZ) dz += W.minZ - nz
          else if (nz > W.maxZ) dz += W.maxZ - nz
        }
        b.proxyPos[3 * p] = x; b.proxyPos[3 * p + 1] = y; b.proxyPos[3 * p + 2] = z
        if (dx !== 0 || dy !== 0 || dz !== 0) b.displaceProxy(p, dx, dy, dz)
      }
    }
  }

  // Body-vs-body. A cheap box test picks the bodies that can touch anything;
  // their proxies go into one dense spatial hash (cell = 2 × largest radius,
  // Müller's counting-sort layout), and only awake bodies' proxies query it.
  // Linear in proxies, so a heap of pieces costs what a scattered one does.
  //
  // PBD turns every position correction into velocity (Δx / h). Overlap made
  // by this substep's motion is undone in full — that is the collision. But
  // overlap that was already there (two pieces whose shared section overlaps
  // when their post-cut grace ends, or whatever the last pass left) is pushed
  // out at no more than `depenetration` units/s: undone in one substep it
  // fires the pieces apart, and ever harder as h shrinks (hit-stop slow-mo).
  collideBodies(h) {
    const bodies = this.bodies
    const now = this.time
    const nb = bodies.length
    for (const b of bodies) if (b.awake) b.updateProxies()

    if (!this._part || this._part.length < nb) this._part = new Uint8Array(nb * 2)
    const part = this._part
    part.fill(0, 0, nb)
    let any = false
    for (let i = 0; i < nb; i++) {
      const A = bodies[i]
      if (A.ghost) continue
      const a = A.aabb
      for (let j = i + 1; j < nb; j++) {
        const B = bodies[j]
        if (B.ghost || (!A.awake && !B.awake)) continue
        const b = B.aabb
        const r = A.proxyRadius + B.proxyRadius
        if (a[0] > b[3] + r || b[0] > a[3] + r || a[1] > b[4] + r || b[1] > a[4] + r || a[2] > b[5] + r || b[2] > a[5] + r) continue
        part[i] = 1
        part[j] = 1
        any = true
      }
    }
    if (!any) return

    let total = 0, maxR = 0
    for (let i = 0; i < nb; i++) {
      if (!part[i]) continue
      total += bodies[i].proxyCount
      if (bodies[i].proxyRadius > maxR) maxR = bodies[i].proxyRadius
    }
    this._ensureHash(total)
    const X = this._hx, XP = this._hxp, PB = this._hb, PI = this._hi
    let g = 0
    for (let i = 0; i < nb; i++) {
      if (!part[i]) continue
      const b = bodies[i], P = b.proxyPos
      const { prev, proxyNodes: N, proxyW: W } = b
      for (let p = 0; p < b.proxyCount; p++, g++) {
        X[3 * g] = P[3 * p]; X[3 * g + 1] = P[3 * p + 1]; X[3 * g + 2] = P[3 * p + 2]
        // where the proxy was at the start of the substep (a sleeper hasn't moved)
        if (b.awake) {
          let px = 0, py = 0, pz = 0
          for (let q = 0; q < 8; q++) {
            const a = N[8 * p + q], w = W[8 * p + q]
            px += w * prev[3 * a]; py += w * prev[3 * a + 1]; pz += w * prev[3 * a + 2]
          }
          XP[3 * g] = px; XP[3 * g + 1] = py; XP[3 * g + 2] = pz
        } else {
          XP[3 * g] = P[3 * p]; XP[3 * g + 1] = P[3 * p + 1]; XP[3 * g + 2] = P[3 * p + 2]
        }
        PB[g] = i
        PI[g] = p
      }
    }
    const maxOut = this.params.depenetration * h

    const inv = 1 / (2 * maxR)
    const ts = this._ts
    const start = this._start, entries = this._entries, stamp = this._stamp
    start.fill(0, 0, ts + 1)
    const cellOf = this._cell
    for (let i = 0; i < total; i++) {
      const h = hash3(Math.floor(X[3 * i] * inv), Math.floor(X[3 * i + 1] * inv), Math.floor(X[3 * i + 2] * inv), ts)
      cellOf[i] = h
      start[h]++
    }
    let acc = 0
    for (let i = 0; i < ts; i++) { acc += start[i]; start[i] = acc }
    start[ts] = acc
    for (let i = 0; i < total; i++) entries[--start[cellOf[i]]] = i

    let query = this._query
    for (let i = 0; i < total; i++) {
      const A = bodies[PB[i]]
      if (!A.awake) continue
      const xi = Math.floor(X[3 * i] * inv), yi = Math.floor(X[3 * i + 1] * inv), zi = Math.floor(X[3 * i + 2] * inv)
      query++
      for (let dz = -1; dz <= 1; dz++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const h = hash3(xi + dx, yi + dy, zi + dz, ts)
            if (stamp[h] === query) continue // two neighbour cells hashed together
            stamp[h] = query
            for (let e = start[h]; e < start[h + 1]; e++) {
              const j = entries[e]
              const bj = PB[j]
              if (bj === PB[i]) continue
              const B = bodies[bj]
              // awake pairs are handled once (i < j); a sleeping B never queries
              if (B.awake && j < i) continue
              const r = A.proxyRadius + B.proxyRadius
              const ddx = X[3 * j] - X[3 * i], ddy = X[3 * j + 1] - X[3 * i + 1], ddz = X[3 * j + 2] - X[3 * i + 2]
              const d2 = ddx * ddx + ddy * ddy + ddz * ddz
              if (d2 >= r * r || d2 < 1e-12) continue
              // two halves of one cut are born sharing the section: they pass
              // through each other until they no longer overlap anywhere
              const nc = A.noCollide
              if (nc && nc === B.noCollide && nc.until > now) {
                nc.until = Math.min(nc.hard, Math.max(nc.until, now + 0.04))
                continue
              }
              const d = Math.sqrt(d2)
              // a sleeping body is a static obstacle for resting contact; only a
              // real hit (deep overlap) wakes it — otherwise a heap never settles
              if (!B.awake && r - d > 0.35 * r) B.wake()
              const share = B.awake ? 0.5 : 1
              // new overlap in full, old overlap at a capped speed (see above)
              const ox = XP[3 * j] - XP[3 * i], oy = XP[3 * j + 1] - XP[3 * i + 1], oz = XP[3 * j + 2] - XP[3 * i + 2]
              const old = Math.max(0, r - Math.sqrt(ox * ox + oy * oy + oz * oz))
              const push = Math.min((r - d) * this.params.contactRelax, Math.max(0, r - d - old) + maxOut)
              const k = (push / d) * share
              const fx = ddx * k, fy = ddy * k, fz = ddz * k
              A.displaceProxy(PI[i], -fx, -fy, -fz)
              X[3 * i] -= fx; X[3 * i + 1] -= fy; X[3 * i + 2] -= fz
              if (B.awake) {
                B.displaceProxy(PI[j], fx, fy, fz)
                X[3 * j] += fx; X[3 * j + 1] += fy; X[3 * j + 2] += fz
                B.touching = true
              }
              A.touching = true
            }
          }
    }
    this._query = query
  }

  _ensureHash(n) {
    if (this._hcap >= n) return
    const cap = Math.max(1024, n * 2)
    this._hcap = cap
    this._hx = new Float64Array(3 * cap)
    this._hxp = new Float64Array(3 * cap)
    this._hb = new Int32Array(cap)
    this._hi = new Int32Array(cap)
    this._cell = new Int32Array(cap)
    this._entries = new Int32Array(cap)
    this._ts = 2 * cap + 1
    this._start = new Int32Array(this._ts + 1)
    this._stamp = new Int32Array(this._ts + 1)
    this._query = 0
  }
}

// Position corrections at the floor show up as velocity in PBD, so a stiff,
// incompressible jelly re-expands off the table like rubber. Per impact, cap
// the centre-of-mass speed leaving the table at e × the landing speed: the
// squash, the overshoot and the wobble survive, the rubber-ball hop doesn't.
function limitRebound(b, e) {
  const v = b.v
  let vy = 0
  for (let i = 1; i < v.length; i += 3) vy += v[i]
  vy /= b.n
  if (!b.inContact) {
    b.inContact = true
    b.impactVy = Math.min(vy, 0)
  }
  const cap = -b.impactVy * e
  if (vy <= cap) return
  const dv = cap - vy
  for (let i = 1; i < v.length; i += 3) v[i] += dv
}

function hash3(x, y, z, size) {
  return Math.abs((x * 92837111) ^ (y * 689287499) ^ (z * 283923481)) % size
}

function solveEdges(b, alpha) {
  const { x } = b
  const E = b.lat.edges, L = b.lat.edgeRest
  const k = 1 / (2 + alpha)
  for (let e = 0; e < L.length; e++) {
    const a = 3 * E[2 * e], c = 3 * E[2 * e + 1]
    const dx = x[c] - x[a], dy = x[c + 1] - x[a + 1], dz = x[c + 2] - x[a + 2]
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz)
    if (len < 1e-9) continue
    const s = ((len - L[e]) * k) / len
    x[a] += dx * s; x[a + 1] += dy * s; x[a + 2] += dz * s
    x[c] -= dx * s; x[c + 1] -= dy * s; x[c + 2] -= dz * s
  }
}

// Volume gradients follow Müller's Ten Minute Physics soft-body demo:
// grad_j = (x[o1] − x[o0]) × (x[o2] − x[o0]) / 6 over the face opposite j.
const ORDER = [1, 3, 2, 0, 2, 3, 0, 3, 1, 0, 1, 2]
const g = new Float64Array(12)
function solveVolumes(b, alpha) {
  const { x } = b
  const T = b.lat.tets, R = b.lat.tetRest
  for (let t = 0; t < R.length; t++) {
    let w = 0
    for (let j = 0; j < 4; j++) {
      const i0 = 3 * T[4 * t + ORDER[3 * j]], i1 = 3 * T[4 * t + ORDER[3 * j + 1]], i2 = 3 * T[4 * t + ORDER[3 * j + 2]]
      const ux = x[i1] - x[i0], uy = x[i1 + 1] - x[i0 + 1], uz = x[i1 + 2] - x[i0 + 2]
      const vx = x[i2] - x[i0], vy = x[i2 + 1] - x[i0 + 1], vz = x[i2 + 2] - x[i0 + 2]
      const gx = (uy * vz - uz * vy) / 6, gy = (uz * vx - ux * vz) / 6, gz = (ux * vy - uy * vx) / 6
      g[3 * j] = gx; g[3 * j + 1] = gy; g[3 * j + 2] = gz
      w += gx * gx + gy * gy + gz * gz
    }
    if (w === 0) continue
    const C = tetVolume(x, T[4 * t], T[4 * t + 1], T[4 * t + 2], T[4 * t + 3]) - R[t]
    const s = -C / (w + alpha)
    for (let j = 0; j < 4; j++) {
      const i = 3 * T[4 * t + j]
      x[i] += s * g[3 * j]; x[i + 1] += s * g[3 * j + 1]; x[i + 2] += s * g[3 * j + 2]
    }
  }
}

// Damp only the stretch rate along each edge: rigid translation and spin
// have no velocity component along edges, so they're left untouched.
function dampEdges(b, k) {
  if (k <= 0) return
  const { x, v } = b
  const E = b.lat.edges
  const half = 0.5 * k
  for (let e = 0; e < E.length; e += 2) {
    const a = 3 * E[e], c = 3 * E[e + 1]
    const dx = x[c] - x[a], dy = x[c + 1] - x[a + 1], dz = x[c + 2] - x[a + 2]
    const l2 = dx * dx + dy * dy + dz * dz
    if (l2 < 1e-12) continue
    const rel = ((v[c] - v[a]) * dx + (v[c + 1] - v[a + 1]) * dy + (v[c + 2] - v[a + 2]) * dz) / l2
    const s = rel * half
    v[a] += dx * s; v[a + 1] += dy * s; v[a + 2] += dz * s
    v[c] -= dx * s; v[c + 1] -= dy * s; v[c + 2] -= dz * s
  }
}

function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

export function quatToMat(x, y, z, w) {
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ]
}
