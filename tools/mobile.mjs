// Phone-width check (390×844, touch): HUD, spawn range inside the frame, and a
// staged ×2 tier-up (callout + points) mid-flight. /tmp/jelly-mobile-*.png
import puppeteer from 'puppeteer-core'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-sandbox'] })
const page = await browser.newPage()
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto(process.env.URL || 'http://127.0.0.1:5220/', { waitUntil: 'networkidle0', timeout: 90000 })
await page.waitForFunction(() => window.__jelly && window.__jelly.playing, { timeout: 60000 })
await sleep(2500)
await page.screenshot({ path: '/tmp/jelly-mobile-1.png' })
// every live bear's x must sit inside the frame at z = 0
const spread = await page.evaluate(() => {
  const J = window.__jelly
  return J.ctx.world.bodies.map((b) => { const bb = b.aabb; const v = J.camera.position.clone().set((bb[0] + bb[3]) / 2, (bb[1] + bb[4]) / 2, (bb[2] + bb[5]) / 2).project(J.camera); return +v.x.toFixed(2) })
})
await page.evaluate(() => {
  const g = window.__jelly.game
  for (let i = 0; i < 6; i++) {
    const r = g.cut({ whole: true })
    g.emit({ type: 'cut', x: 195, y: 420, points: r.points, mult: r.mult, tier: r.tier, whole: true })
    if (r.tierUp) g.emit({ type: 'tier', tier: r.tier, mult: r.mult, streak: r.streak })
  }
})
await sleep(350)
await page.screenshot({ path: '/tmp/jelly-mobile-2.png' })
await sleep(1400)
await page.screenshot({ path: '/tmp/jelly-mobile-3.png' })
console.log(JSON.stringify({ ndcX: spread, errors }))
await browser.close()
