// Preloader review: frames from navigation through the logo's entrance, the
// breathing wait, the dock to the top centre and the first falling bears.
// Tiles them into /tmp/jelly-intro.png.
import puppeteer from 'puppeteer-core'
import { execFileSync } from 'node:child_process'

const URL = process.env.URL || 'http://127.0.0.1:5220/'
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-sandbox', '--window-size=1200,760'] })
const page = await browser.newPage()
await page.setViewport({ width: 1200, height: 760 })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
const t0 = Date.now()
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 })
const times = (process.env.TIMES || '150,400,700,1000,1500,2200').split(',').map(Number)
const shots = []
for (const t of times) {
  const wait = t - (Date.now() - t0)
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  const path = `/tmp/jelly-intro-${shots.length}.png`
  await page.screenshot({ path })
  shots.push({ path, t: Date.now() - t0 })
}
// then follow the dock: from the moment the game starts
await page.waitForFunction(() => window.__jelly && window.__jelly.playing, { timeout: 60000 })
const tp = Date.now() - t0
for (const dt of [0, 250, 500, 800, 1300, 2200]) {
  const wait = tp + dt - (Date.now() - t0)
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  const path = `/tmp/jelly-intro-${shots.length}.png`
  await page.screenshot({ path })
  shots.push({ path, t: Date.now() - t0 })
}
await browser.close()
execFileSync('python3', ['-c', `
from PIL import Image
import sys
paths = sys.argv[1:]
ims = [Image.open(p).convert('RGB') for p in paths]
w, h = ims[0].size
tw, th = w // 2, h // 2
cols = 3
rows = (len(ims) + cols - 1) // cols
out = Image.new('RGB', (tw * cols, th * rows), 'white')
for i, im in enumerate(ims):
    out.paste(im.resize((tw, th)), ((i % cols) * tw, (i // cols) * th))
out.save('/tmp/jelly-intro.png')
`, ...shots.map((s) => s.path)])
console.log(JSON.stringify({ frames: shots.map((s) => s.t), startedAt: tp, errors }))
