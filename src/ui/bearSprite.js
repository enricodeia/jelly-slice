// The 2D Goldbear for the UI, coloured like the 3D candy. The baked sprite
// (tools/build-sprite.mjs) holds thickness, light, highlight and coverage;
// each colourway is its tint × Beer–Lambert absorption through that
// thickness, lit, plus the softbox highlight. One canvas pass per colourway,
// cached as an object URL.

import { COLORWAYS } from '../render/jellyMaterials.js'

const SRC = '/goldbear-sprite.png'
const DEPTH = 0.55 // a little thinner than the 3D look: a small bear on a cream card
const PAPER = [1, 0.95, 0.86] // what shines through, linear

let base = null
const cache = new Map()

function load() {
  if (!base) {
    base = new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        const c = document.createElement('canvas')
        c.width = img.width
        c.height = img.height
        const g = c.getContext('2d', { willReadFrequently: true })
        g.drawImage(img, 0, 0)
        resolve(g.getImageData(0, 0, c.width, c.height))
      }
      img.onerror = () => reject(new Error('goldbear sprite missing'))
      img.src = SRC
    })
  }
  return base
}

const toSrgb = (c) => {
  const v = c <= 0 ? 0 : c >= 1 ? 1 : c
  return (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255
}

/** → Promise<string> an image URL of the bear in that colourway */
export function bearSprite(colorway) {
  if (cache.has(colorway)) return cache.get(colorway)
  const job = load().then((src) => {
    const { tint, sigma } = COLORWAYS[colorway] || COLORWAYS.orange
    const out = new ImageData(src.width, src.height)
    const s = src.data, o = out.data
    for (let i = 0; i < s.length; i += 4) {
      if (!s[i + 3]) continue
      const t = (s[i] / 255) * 1.2 * DEPTH
      const light = 0.74 + 0.4 * Math.max(-0.2, (s[i + 1] / 255) * 2 - 1)
      const spec = (s[i + 2] / 255) * 0.85
      for (let c = 0; c < 3; c++) o[i + c] = toSrgb(PAPER[c] * tint[c] * Math.exp(-sigma[c] * (t + 0.03)) * light + spec)
      o[i + 3] = s[i + 3]
    }
    const c = document.createElement('canvas')
    c.width = src.width
    c.height = src.height
    c.getContext('2d').putImageData(out, 0, 0)
    return new Promise((resolve) => c.toBlob((b) => resolve(URL.createObjectURL(b)), 'image/png'))
  })
  cache.set(colorway, job)
  return job
}
