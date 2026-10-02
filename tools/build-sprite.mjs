// Bakes public/goldbear-sprite.png: the real Goldbear (the same SDF the 3D
// bears are meshed from) seen straight on, for the menu's how-to animation.
// Not a colour image: each channel carries what the runtime tint needs,
//   R thickness front→back (0…1.2 world units), G diffuse light,
//   B specular highlight, A coverage (antialiased from the 2D outline),
// so src/ui/bearSprite.js can colour it per colourway with the 3D candy's
// own Beer–Lambert absorption. Run: node tools/build-sprite.mjs
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { sdBear, silhouetteDistance, BEAR_BOUNDS } from '../src/geometry/sdfBear.js'

const W = 240
const X0 = -0.7, X1 = 0.7, Y0 = -1.12, Y1 = 1.12
const PX = (X1 - X0) / W
const H = Math.round((Y1 - Y0) / PX)
const ZMAX = BEAR_BOUNDS.max[2] + 0.04
const ZMIN = BEAR_BOUNDS.min[2] - 0.04
const L = norm([2.5, 7, 4]) // the key softbox
const HV = norm([L[0], L[1], L[2] + 1]) // half vector, viewer on +z

function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}

function trace(x, y, z, dir) {
  for (let k = 0; k < 96; k++) {
    const d = sdBear(x, y, z)
    if (d < 2e-4) return z
    z += dir * Math.max(d * 0.9, 2e-4)
    if (z > ZMAX + 0.01 || z < ZMIN - 0.01) return null
  }
  return z
}

const t0 = performance.now()
const rgba = new Uint8Array(W * H * 4)
for (let j = 0; j < H; j++) {
  const y = Y1 - (j + 0.5) * PX // image rows run top → bottom
  for (let i = 0; i < W; i++) {
    const x = X0 + (i + 0.5) * PX
    const sil = silhouetteDistance(x, y)
    const alpha = Math.min(1, Math.max(0, 0.5 - sil / PX))
    if (alpha <= 0) continue
    const zf = trace(x, y, ZMAX, -1)
    const zb = trace(x, y, ZMIN, 1)
    let n, thick
    if (zf == null || zb == null) {
      // a sliver at the outline: no surface hit, the edge faces outwards
      const e = PX * 0.5
      n = norm([silhouetteDistance(x + e, y) - silhouetteDistance(x - e, y), silhouetteDistance(x, y + e) - silhouetteDistance(x, y - e), 0.15])
      thick = 0
    } else {
      const e = 0.003
      n = norm([
        sdBear(x + e, y, zf) - sdBear(x - e, y, zf),
        sdBear(x, y + e, zf) - sdBear(x, y - e, zf),
        sdBear(x, y, zf + e) - sdBear(x, y, zf - e),
      ])
      thick = Math.max(0, zf - zb)
    }
    const diff = n[0] * L[0] + n[1] * L[1] + n[2] * L[2]
    const nh = Math.max(0, n[0] * HV[0] + n[1] * HV[1] + n[2] * HV[2])
    const spec = Math.min(1, Math.pow(nh, 70) * 1.1 + Math.pow(nh, 14) * 0.18)
    const o = 4 * (j * W + i)
    rgba[o] = Math.round(Math.min(1, thick / 1.2) * 255)
    rgba[o + 1] = Math.round((diff * 0.5 + 0.5) * 255)
    rgba[o + 2] = Math.round(spec * 255)
    rgba[o + 3] = Math.round(alpha * 255)
  }
}

// minimal PNG: RGBA 8-bit, filter 0 rows, one IDAT
const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  Buffer.from(data).copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(W, 0)
ihdr.writeUInt32BE(H, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // RGBA
const raw = Buffer.alloc(H * (W * 4 + 1))
for (let j = 0; j < H; j++) Buffer.from(rgba.buffer, j * W * 4, W * 4).copy(raw, j * (W * 4 + 1) + 1)
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])
writeFileSync(new URL('../public/goldbear-sprite.png', import.meta.url), png)
console.log(`goldbear-sprite.png ${W}×${H}, ${(png.length / 1024).toFixed(1)} KB, ${((performance.now() - t0) / 1000).toFixed(1)} s`)
