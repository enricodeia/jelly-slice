// Frame-rate check under normal play: auto-spawn on, a swipe every ~0.7 s.
import puppeteer from 'puppeteer-core'
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-sandbox', '--window-size=1280,800'] })
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: Number(process.env.DPR || 1) })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto(process.env.URL || 'http://127.0.0.1:5220/', { waitUntil: 'networkidle0' })
await page.waitForFunction(() => window.__jelly && window.__jelly.playing, { timeout: 60000 })
await page.evaluate(() => {
  window.__frames = []
  let last = performance.now()
  const tick = (t) => { window.__frames.push(t - last); last = t; requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
})
const seconds = Number(process.env.SECONDS || 20)
for (let s = 0; s < seconds / 0.7; s++) {
  await new Promise((r) => setTimeout(r, 450))
  const y = 480 + Math.random() * 120
  await page.mouse.move(150, y)
  await page.mouse.down()
  for (let i = 1; i <= 10; i++) { await page.mouse.move(150 + i * 100, y - 60 + Math.random() * 120); await new Promise((r) => setTimeout(r, 16)) }
  await page.mouse.up()
}
const res = await page.evaluate(() => {
  const f = window.__frames.slice(30).sort((a, b) => a - b)
  const avg = f.reduce((s, x) => s + x, 0) / f.length
  const { world } = window.__jelly.ctx
  return {
    fps: +(1000 / avg).toFixed(1),
    p95ms: +f[Math.floor(f.length * 0.95)].toFixed(1),
    worstMs: +f[f.length - 1].toFixed(1),
    bodies: world.bodies.length,
    awake: world.bodies.filter((b) => b.awake).length,
    nodes: world.bodies.reduce((s, b) => s + b.n, 0),
    physicsMs: +window.__jelly.ctx.stats.step.toFixed(2),
    score: document.querySelector('.hud-score b')?.textContent,
  }
})
console.log(JSON.stringify({ ...res, errors }, null, 1))
await browser.close()
