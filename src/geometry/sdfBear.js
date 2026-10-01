// The Haribo Goldbear, rebuilt from the reference photo
// (tools/reference/goldbears.png → tools/build-silhouette.py).
//
// A starch-moulded candy: a flatter back (the open side of the mould) and a
// domed, sculpted front. The solid is the traced outline inflated into a slab
// (quarter-ellipse rim, taller in front), then sculpted like the original
// character: real 3D blobs smooth-unioned onto the front — cupped ears, bulb
// eyes, muzzle and nose, fat arm pads curling in to paws on the belly, big
// foot pads — and grooves carved as tubes lying on the actual surface (the
// smile, the chin line, the split between the feet). Only the faint "fur"
// marks on the belly are left to the shader, as a baked detail map.
//
// Units: the bear is 2 tall centred on the origin, +y up, +z its front.

import { SILHOUETTE, SILHOUETTE_DATA } from './goldbearSilhouette.js'

// ── traced outline: signed distance in the xy plane, negative inside ──
const SIL = (() => {
  const bin = atob(SILHOUETTE_DATA)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Float32Array(bytes.buffer)
})()
const { cols: SC, rows: SR, x0: SX0, y0: SY0, dx: SDX, dy: SDY } = SILHOUETTE

export function silhouetteDistance(x, y) {
  let fx = (x - SX0) / SDX - 0.5
  let fy = (y - SY0) / SDY - 0.5
  let extra = 0
  if (fx < 0) { extra += -fx * SDX; fx = 0 } else if (fx > SC - 1) { extra += (fx - SC + 1) * SDX; fx = SC - 1 }
  if (fy < 0) { extra += -fy * SDY; fy = 0 } else if (fy > SR - 1) { extra += (fy - SR + 1) * SDY; fy = SR - 1 }
  const i = Math.min(SC - 2, Math.floor(fx)), j = Math.min(SR - 2, Math.floor(fy))
  const u = fx - i, v = fy - j
  const a = SIL[j * SC + i], b = SIL[j * SC + i + 1], c = SIL[(j + 1) * SC + i], d = SIL[(j + 1) * SC + i + 1]
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v + extra
}

// ── SDF toolkit ──
function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.min(a, b) - h * h * k * 0.25
}
function smax(a, b, k) {
  return -smin(-a, -b, k)
}
function sdEllipsoid(px, py, pz, rx, ry, rz) {
  const ax = px / rx, ay = py / ry, az = pz / rz
  const k0 = Math.sqrt(ax * ax + ay * ay + az * az)
  const bx = px / (rx * rx), by = py / (ry * ry), bz = pz / (rz * rz)
  const k1 = Math.sqrt(bx * bx + by * by + bz * bz)
  return k1 < 1e-9 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1
}
// round cone (IQ): radius r1 at a tapering to r2 at b
function sdRoundCone(px, py, pz, ax, ay, az, bx, by, bz, r1, r2) {
  const bax = bx - ax, bay = by - ay, baz = bz - az
  const l2 = bax * bax + bay * bay + baz * baz
  const rr = r1 - r2
  const a2 = l2 - rr * rr
  const il2 = 1 / l2
  const pax = px - ax, pay = py - ay, paz = pz - az
  const y = pax * bax + pay * bay + paz * baz
  const z = y - l2
  const qx = pax * l2 - bax * y, qy = pay * l2 - bay * y, qz = paz * l2 - baz * y
  const x2 = qx * qx + qy * qy + qz * qz
  const y2 = y * y * l2
  const z2 = z * z * l2
  const k = Math.sign(rr) * rr * rr * x2
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1
}

// ── the slab ──
const FRONT_H = 0.42
const BACK_H = 0.28
const FRONT_R = 0.5 // wide: the front domes across the whole body
const BACK_R = 0.32 // and the edges thin out gently, like the candy's glowing rim

function rim(e, H, R) {
  if (e <= 0) return 2 * e
  const t = Math.min(e / R, 1)
  return H * Math.sqrt(1 - (1 - t) * (1 - t))
}
function slabFront(x, y) {
  return rim(-silhouetteDistance(x, y), FRONT_H, FRONT_R)
}

// ── sculpted features (x ≥ 0 half; mirrored) — measured off the photo ──
// each blob sits on the slab: its centre is sunk `sink` below the front there
const zf = (x, y, sink) => slabFront(x, y) - sink
const EAR = [0.39, 0.83, zf(0.39, 0.83, 0.07), 0.15, 0.14, 0.095]
// a broad, shallow dish kept clear of the thin top rim (a cup cutting into it
// pinches the mesh); it shades like the photo's inner-ear crescent
const EAR_CUP = [0.37, 0.79, zf(0.37, 0.79, -0.038), 0.11, 0.11, 0.07]
const EYE = [0.135, 0.662, zf(0.135, 0.662, 0.006), 0.066, 0.06, 0.045]
const MUZZLE = [0, 0.45, zf(0, 0.45, 0.13), 0.32, 0.17, 0.145]
const NOSE = [0, 0.495, zf(0, 0.495, 0.002), 0.042, 0.03, 0.03]
const ARM = [0.39, 0.19, zf(0.39, 0.19, 0.055), 0.145, -0.2, zf(0.145, -0.2, 0.05), 0.13, 0.145]
const LEG = [0.25, -0.47, zf(0.25, -0.47, 0.08), 0.245, -0.84, zf(0.245, -0.84, 0.075), 0.15, 0.165]
const BELLY = [0, -0.12, zf(0, -0.12, 0.13), 0.2, 0.36, 0.15]

function sdSculpt(x, y, z) {
  const ax = Math.abs(x)
  const sil = silhouetteDistance(x, y)
  let d = Math.max(z - rim(-sil, FRONT_H, FRONT_R), -z - rim(-sil, BACK_H, BACK_R))
  // blobs only add depth: each is held inside the outline, inset a little
  const inset = sil + 0.035
  d = smin(d, smax(sdEllipsoid(x - BELLY[0], y - BELLY[1], z - BELLY[2], BELLY[3], BELLY[4], BELLY[5]), inset, 0.05), 0.12)
  d = smin(d, smax(sdEllipsoid(ax - EAR[0], y - EAR[1], z - EAR[2], EAR[3], EAR[4], EAR[5]), inset, 0.05), 0.06)
  d = smin(d, smax(sdRoundCone(ax, y, z, ARM[0], ARM[1], ARM[2], ARM[3], ARM[4], ARM[5], ARM[6], ARM[7]), inset, 0.05), 0.085)
  d = smin(d, smax(sdRoundCone(ax, y, z, LEG[0], LEG[1], LEG[2], LEG[3], LEG[4], LEG[5], LEG[6], LEG[7]), inset, 0.05), 0.085)
  d = smin(d, smax(sdEllipsoid(x - MUZZLE[0], y - MUZZLE[1], z - MUZZLE[2], MUZZLE[3], MUZZLE[4], MUZZLE[5]), inset, 0.05), 0.07)
  d = smin(d, smax(sdEllipsoid(ax - EYE[0], y - EYE[1], z - EYE[2], EYE[3], EYE[4], EYE[5]), inset, 0.05), 0.045)
  d = smin(d, smax(sdEllipsoid(x - NOSE[0], y - NOSE[1], z - NOSE[2], NOSE[3], NOSE[4], NOSE[5]), inset, 0.05), 0.02)
  d = smax(d, -sdEllipsoid(ax - EAR_CUP[0], y - EAR_CUP[1], z - EAR_CUP[2], EAR_CUP[3], EAR_CUP[4], EAR_CUP[5]), 0.1)
  return d
}

// front surface height of the sculpt at (x, y): bisection down from above
function surfaceZ(x, y) {
  let lo = -0.2, hi = 0.75
  for (let i = 0; i < 28; i++) {
    const m = 0.5 * (lo + hi)
    if (sdSculpt(x, y, m) < 0) lo = m
    else hi = m
  }
  return 0.5 * (lo + hi)
}

// ── grooves: tubes lying on the sculpted surface ──
// curve y = a + b x² for |x| ≤ w; tube radius r tapering at the ends
function makeCurve(a, b, w, r, n = 48) {
  const zs = new Float64Array(n + 1)
  for (let i = 0; i <= n; i++) {
    const x = -w + (2 * w * i) / n
    zs[i] = surfaceZ(x, a + b * x * x)
  }
  return { a, b, w, r, n, zs }
}
const SMILE = makeCurve(0.42, 1.1, 0.28, 0.022)
const CHIN = makeCurve(0.28, 1.6, 0.18, 0.045)
const SPLIT = (() => {
  const n = 40, y0 = -1.06, y1 = -0.56
  const zs = new Float64Array(n + 1)
  for (let i = 0; i <= n; i++) zs[i] = surfaceZ(0, y0 + ((y1 - y0) * i) / n)
  return { y0, y1, n, zs, r: 0.034 }
})()

function sdCurveTube(c, x, y, z) {
  const ax = Math.abs(x)
  if (ax > c.w + 0.05) return 1
  const cx = Math.min(ax, c.w) * Math.sign(x || 1)
  const slope = 2 * c.b * cx
  const dxy = (y - (c.a + c.b * cx * cx)) / Math.sqrt(1 + slope * slope)
  const ex = ax - Math.min(ax, c.w)
  const t = ((cx + c.w) / (2 * c.w)) * c.n
  const i = Math.min(c.n - 1, Math.floor(t))
  const zc = c.zs[i] + (c.zs[i + 1] - c.zs[i]) * (t - i)
  // ends fade by rising out of the skin, not by thinning below the mesh cell
  const fade = Math.min(1, (c.w - Math.min(ax, c.w)) / 0.08)
  const lift = c.r * (1 - fade * fade * (3 - 2 * fade))
  return Math.sqrt(dxy * dxy + ex * ex + (z - zc - lift) * (z - zc - lift)) - c.r
}

function sdSplit(x, y, z) {
  const s = SPLIT
  const yc = Math.max(s.y0, Math.min(s.y1, y))
  const t = ((yc - s.y0) / (s.y1 - s.y0)) * s.n
  const i = Math.min(s.n - 1, Math.floor(t))
  const zc = s.zs[i] + (s.zs[i + 1] - s.zs[i]) * (t - i)
  const r = s.r * Math.min(1, (s.y1 - yc) / 0.12 + 0.2)
  return Math.sqrt(x * x + (y - yc) * (y - yc) + (z - zc) * (z - zc)) - r
}

const PHILTRUM_Z = surfaceZ(0, 0.448) + 0.004

export const BEAR_BOUNDS = { min: [-0.66, -1.08, -BACK_H - 0.07], max: [0.66, 1.08, 0.62] }

export function sdBear(x, y, z) {
  let d = sdSculpt(x, y, z)
  if (z > 0) {
    d = smax(d, -sdCurveTube(SMILE, x, y, z), 0.018)
    d = smax(d, -(sdCurveTube(CHIN, x, y, z - 0.022)), 0.035) // centre above the skin: a soft shadow under the chin
    // philtrum: nose to the bottom of the smile — the bear's "ᴥ"
    if (Math.abs(x) < 0.05 && y > 0.4 && y < 0.5) {
      const py = Math.max(0.425, Math.min(0.47, y))
      d = smax(d, -(Math.hypot(x, y - py, z - PHILTRUM_Z) - 0.016), 0.014)
    }
    if (y < -0.5) d = smax(d, -sdSplit(x, y, z), 0.02)
  }
  return d
}

// ── fine relief for the shader: the belly's little V "fur" marks ──
function segDist(x, y, ax, ay, bx, by) {
  const px = x - ax, py = y - ay, ux = bx - ax, uy = by - ay
  const t = Math.max(0, Math.min(1, (px * ux + py * uy) / (ux * ux + uy * uy)))
  const ex = px - ux * t, ey = py - uy * t
  return Math.sqrt(ex * ex + ey * ey)
}
const MARKS = [
  [0, 0.13, 0.03, 0.05],
  [-0.045, -0.06, 0.012, 0.035], [0.045, -0.06, 0.012, 0.035],
  [-0.13, -0.235, 0.022, 0.035], [-0.043, -0.24, 0.02, 0.035], [0.043, -0.24, 0.02, 0.035], [0.13, -0.235, 0.022, 0.035],
  [-0.15, -0.455, 0.026, 0.04], [-0.05, -0.46, 0.022, 0.04], [0.05, -0.46, 0.022, 0.04], [0.15, -0.455, 0.026, 0.04],
  [0, -0.655, 0.026, 0.045],
]
export function reliefFine(x, y) {
  let h = 0
  for (const [cx, cy, a, b] of MARKS) {
    if (Math.abs(x - cx) > a + 0.04 || Math.abs(y - cy) > b + 0.04) continue
    const d = Math.min(
      segDist(x, y, cx - a, cy + b, cx - a * 0.7, cy - b * 0.45),
      segDist(x, y, cx - a * 0.7, cy - b * 0.45, cx, cy - b),
      segDist(x, y, cx, cy - b, cx + a * 0.7, cy - b * 0.45),
      segDist(x, y, cx + a * 0.7, cy - b * 0.45, cx + a, cy + b)
    )
    const q = d / 0.011
    if (q < 3) h -= 0.0045 * Math.exp(-q * q)
  }
  return h
}

// baked as (∂h/∂x, ∂h/∂y, h) over the outline's bounding box
export function bakeRelief({ width = 360, height = 620 } = {}) {
  const min = [-0.64, -1.06], size = [1.28, 2.12]
  const h = new Float32Array(width * height)
  for (let j = 0; j < height; j++) {
    const y = min[1] + ((j + 0.5) / height) * size[1]
    for (let i = 0; i < width; i++) h[j * width + i] = reliefFine(min[0] + ((i + 0.5) / width) * size[0], y)
  }
  const data = new Float32Array(width * height * 4)
  const sx = size[0] / width, sy = size[1] / height
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const l = h[j * width + Math.max(0, i - 1)], r = h[j * width + Math.min(width - 1, i + 1)]
      const dd = h[Math.max(0, j - 1) * width + i], u = h[Math.min(height - 1, j + 1) * width + i]
      const o = 4 * (j * width + i)
      data[o] = (r - l) / (2 * sx)
      data[o + 1] = (u - dd) / (2 * sy)
      data[o + 2] = h[j * width + i]
      data[o + 3] = 1
    }
  }
  return { data, width, height, min, size }
}
