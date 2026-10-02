// The menu card's jelly body: films its landing and logs the outline's size
// every frame (how far it bulges and squashes, how fast it settles), then a
// press on Play. Tiles to /tmp/jelly-card.png.
import puppeteer from 'puppeteer-core'
import { execFileSync } from 'node:child_process'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-sandbox'] })
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto((process.env.URL || 'http://127.0.0.1:5220/') + '?round=8', { waitUntil: 'networkidle0' })
await page.waitForSelector('.menu-card .jelly-body path')
// log the body's box every frame for 1.6 s from now (the landing kick is ~0.9 s after the menu opens)
await page.evaluate(() => {
  window.__box = []
  const p = document.querySelector('.menu-card .jelly-body path')
  const t0 = performance.now()
  const tick = () => {
    const b = p.getBBox()
    window.__box.push([Math.round(performance.now() - t0), +b.width.toFixed(1), +b.height.toFixed(1)])
    if (performance.now() - t0 < 2600) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})
const shots = []
for (let i = 0; i < 9; i++) {
  const r = await page.$eval('.menu-card', (e) => { const b = e.getBoundingClientRect(); return { x: b.left - 30, y: b.top - 30, width: b.width + 60, height: b.height + 60 } })
  const path = `/tmp/jelly-card-${i}.png`
  await page.screenshot({ path, clip: r })
  shots.push(path)
  await sleep(90)
}
await sleep(1200)
const box = await page.evaluate(() => window.__box)
const w = box.map((b) => b[1]), h = box.map((b) => b[2])
const rest = { w: w.at(-1), h: h.at(-1) }
console.log(JSON.stringify({
  frames: box.length,
  restW: rest.w, restH: rest.h,
  widthRange: [Math.min(...w), Math.max(...w)], heightRange: [Math.min(...h), Math.max(...h)],
  maxBulgePct: +(((Math.max(...w) - rest.w) / rest.w) * 100).toFixed(1),
  maxSquashPct: +(((rest.h - Math.min(...h)) / rest.h) * 100).toFixed(1),
  idleWobblePx: +(Math.max(...w.slice(-30)) - Math.min(...w.slice(-30))).toFixed(1),
  errors,
}))
await browser.close()
execFileSync('python3', ['-c', `
from PIL import Image
import sys
ims = [Image.open(p).convert('RGB') for p in sys.argv[1:]]
w = max(i.size[0] for i in ims); h = max(i.size[1] for i in ims)
tw, th = w // 3, h // 3
out = Image.new('RGB', (tw * len(ims), th), 'white')
for i, im in enumerate(ims):
    out.paste(im.resize((tw, th)), (i * tw, 0))
out.save('/tmp/jelly-card.png')
`, ...shots])
