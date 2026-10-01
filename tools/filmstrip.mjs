// Staged motion review (?nospawn&nointro): three bears falling slowly (gravity
// override), a swipe through the middle one mid-air, then frames of the
// pieces parting and wobbling as they fall. Tiles to /tmp/jelly-film.png.
import puppeteer from 'puppeteer-core'
import { execFileSync } from 'node:child_process'

const URL = (process.env.URL || 'http://127.0.0.1:5220/') + '?nospawn&nointro'
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-sandbox', '--window-size=1200,800'] })
const page = await browser.newPage()
await page.setViewport({ width: 1200, height: 800 })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
await page.goto(URL, { waitUntil: 'networkidle0', timeout: 90000 })
await page.waitForFunction(() => window.__jelly && window.__jelly.playing, { timeout: 60000 })

await page.evaluate(() => {
  const J = window.__jelly
  J.ctx.overrides.gravity = Number(new URLSearchParams(location.search).get('g') || 1.4)
  const t = Math.sin(0.12), c = Math.cos(0.12)
  J.spawn({ x: -2.4, y: 2.6, z: 0, q: [0, t, 0, c], v: [0, -0.2, 0], w: [0, 0.4, 0.2], colorway: 'strawberry' })
  J.spawn({ x: 0, y: 2.9, z: 0.2, q: [0, 0, 0, 1], v: [0, -0.2, 0], w: [0.2, -0.3, 0], colorway: 'orange' })
  J.spawn({ x: 2.4, y: 2.6, z: 0, q: [0, -t, 0, c], v: [0, -0.2, 0], w: [-0.2, 0.3, 0.1], colorway: 'apple' })
  J.t0 = J.ctx.world.time
})

const shots = []
async function shotAt(simT, name) {
  await page.waitForFunction((t) => window.__jelly.ctx.world.time - window.__jelly.t0 >= t, { timeout: 60000 }, simT)
  const path = `/tmp/jelly-film-${String(shots.length).padStart(2, '0')}.png`
  await page.screenshot({ path })
  shots.push({ path, name })
}
for (const t of [0.15, 0.4, 0.65]) await shotAt(t, `fall t=${t}`)

// swipe through the middle bear where it is *now* (it's falling), left to right, slightly rising
const aim = await page.evaluate(() => {
  const J = window.__jelly
  const b = J.ctx.world.bodies[1], bb = b.aabb
  const v = J.camera.position.clone().set((bb[0] + bb[3]) / 2, (bb[1] + bb[4]) / 2 - 0.35, (bb[2] + bb[5]) / 2).project(J.camera)
  return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight }
})
await page.mouse.move(aim.x - 200, aim.y + 50)
await page.mouse.down()
for (let i = 1; i <= 14; i++) { await page.mouse.move(aim.x - 200 + i * 29, aim.y + 50 - i * 7); await new Promise((r) => setTimeout(r, 16)) }
await page.mouse.up()
const tc = await page.evaluate(() => window.__jelly.ctx.world.time - window.__jelly.t0)
for (const dt of [0.04, 0.12, 0.22, 0.36, 0.55, 0.8, 1.1, 1.5, 2.0]) await shotAt(tc + dt, `cut +${dt}`)
const pieces = await page.evaluate(() => window.__jelly.ctx.world.bodies.length)

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
out.save('/tmp/jelly-film.png')
`, ...shots.map((s) => s.path)])
console.log(JSON.stringify({ frames: shots.map((s) => s.name), pieces, errors }))
