// The tier callout's flight into the HUD badge, frame by frame: stages a
// ×1.5 tier-up (three sliced bears), then shoots the screen every ~110 ms and
// reports where the numeral ends up against the badge. Tiles to
// /tmp/jelly-tierfly.png.
import puppeteer from 'puppeteer-core'
import { execFileSync } from 'node:child_process'

const URL = (process.env.URL || 'http://127.0.0.1:5220/') + '?nospawn&nointro'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-sandbox', '--window-size=1280,800'] })
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 800 })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto(URL, { waitUntil: 'networkidle0', timeout: 90000 })
await page.waitForFunction(() => window.__jelly && window.__jelly.playing, { timeout: 60000 })
// skip the bears: drive the game state directly, as three cuts would
await page.evaluate(() => {
  const g = window.__jelly.game
  for (let i = 0; i < 3; i++) {
    const r = g.cut({ whole: true })
    g.emit({ type: 'cut', x: 640, y: 380, points: r.points, mult: r.mult, tier: r.tier, whole: true })
    if (r.tierUp) g.emit({ type: 'tier', tier: r.tier, mult: r.mult, streak: r.streak })
  }
})
const shots = []
const t0 = Date.now()
const track = []
for (let i = 0; i < 12; i++) {
  const path = `/tmp/jelly-tierfly-${String(i).padStart(2, '0')}.png`
  await page.screenshot({ path, clip: { x: 0, y: 0, width: 1280, height: 520 } })
  track.push(await page.evaluate(() => {
    const b = document.querySelector('.fx-tier b')?.getBoundingClientRect()
    const badge = document.querySelector('.hud-mult-badge').getBoundingClientRect()
    return b ? { numeral: [Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2), Math.round(b.height)], badge: [Math.round(badge.left + badge.width / 2), Math.round(badge.top + badge.height / 2)] } : 'gone'
  }))
  shots.push({ path, ms: Date.now() - t0 })
  await sleep(70)
}
await browser.close()
execFileSync('python3', ['-c', `
from PIL import Image
import sys
ims = [Image.open(p).convert('RGB') for p in sys.argv[1:]]
w, h = ims[0].size
tw, th = w // 2, h // 2
cols = 3
rows = (len(ims) + cols - 1) // cols
out = Image.new('RGB', (tw * cols, th * rows), 'white')
for i, im in enumerate(ims):
    out.paste(im.resize((tw, th)), ((i % cols) * tw, (i // cols) * th))
out.save('/tmp/jelly-tierfly.png')
`, ...shots.map((s) => s.path)])
console.log(JSON.stringify({ ms: shots.map((s) => s.ms), track, errors }))
