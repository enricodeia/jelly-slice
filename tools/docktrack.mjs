// The logo's flight from the menu to the top centre, sampled every frame from
// the click on Play: prints the largest frame-to-frame jump (a snap back to
// the centre pose shows up as a jump of hundreds of px).
import puppeteer from 'puppeteer-core'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-sandbox'] })
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 800 })
await page.goto((process.env.URL || 'http://127.0.0.1:5220/') + '?round=8', { waitUntil: 'networkidle0' })
await page.waitForSelector('.menu-card input')
await sleep(1600)
await page.type('.menu-card input', 'Enrico')
await page.evaluate(() => {
  window.__rects = []
  const el = document.querySelector('.brand img')
  const t0 = performance.now()
  const tick = () => {
    const r = el.getBoundingClientRect()
    window.__rects.push([Math.round(performance.now() - t0), Math.round(r.top + r.height / 2), Math.round(r.width)])
    if (performance.now() - t0 < 1500) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})
await page.click('.btn-play')
await sleep(1600)
const rects = await page.evaluate(() => window.__rects)
let jy = 0, jw = 0
for (let i = 1; i < rects.length; i++) {
  jy = Math.max(jy, Math.abs(rects[i][1] - rects[i - 1][1]))
  jw = Math.max(jw, Math.abs(rects[i][2] - rects[i - 1][2]))
}
console.log(JSON.stringify({ from: rects[0], to: rects.at(-1), frames: rects.length, maxJumpY: jy, maxJumpW: jw, ok: jy < 60 && jw < 60 }))
await browser.close()
