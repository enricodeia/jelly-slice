// Reads the offscreen passes back: is the contact-shadow map / thickness map populated?
import puppeteer from 'puppeteer-core'
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--window-size=1280,800'] })
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 800 })
const errors = []
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text().slice(0, 300)) })
page.on('pageerror', (e) => errors.push('pageerror ' + e.message))
await page.goto((process.env.URL || 'http://127.0.0.1:5220/') + '?nointro', { waitUntil: 'networkidle0' })
await new Promise((r) => setTimeout(r, 5000))
const info = await page.evaluate(() => {
  const { ctx, gl } = window.__jelly
  const stats = (rt, n) => {
    const w = rt.width, h = rt.height
    const buf = new Uint16Array(w * h * 4)
    gl.readRenderTargetPixels(rt, 0, 0, w, h, buf)
    // half floats -> float
    const f = (x) => { const s = x >> 15, e = (x >> 10) & 31, m = x & 1023; return (s ? -1 : 1) * (e === 0 ? m / 1024 * 2 ** -14 : e === 31 ? Infinity : (1 + m / 1024) * 2 ** (e - 15)) }
    let min = Infinity, max = -Infinity, nonClear = 0
    for (let i = 0; i < w * h; i++) {
      const v = f(buf[4 * i])
      if (v < min) min = v
      if (v > max) max = v
      if (Math.abs(v - n) > 1e-3) nonClear++
    }
    return { w, h, min: +min.toFixed(3), max: +max.toFixed(3), nonClearPct: +(100 * nonClear / (w * h)).toFixed(2) }
  }
  const bodies = ctx.world.bodies
  return {
    bodies: bodies.length,
    awake: bodies.filter((b) => b.awake).length,
    lowest: Math.min(...bodies.map((b) => b.aabb[1])).toFixed(3),
    shadowMap: stats(ctx.shadows.rtA, 1),
    thickness: stats(ctx.thickness.target, 0),
  }
})
console.log(JSON.stringify(info, null, 1))
console.log('console errors/warnings:', errors.slice(0, 8))
await browser.close()
