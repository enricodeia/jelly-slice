// One cut, filmed in slow motion (?nospawn&nointro, sim time × FILM): a bear
// hangs mid-frame, an aimed swipe goes through it, and frames are taken at
// fixed *sim* times after the cut — the glint, the flash on the fresh faces,
// the crumbs, the wedge squash, the shear lurch and the tumble. Prints the
// blade speed and each piece's velocity and spin. Tiles to /tmp/jelly-cut.png.
//   STEP=px per 12 ms pointer step (29 ≈ a brisk swipe, 10 = lazy, 60 = slash)
//   FILM=time scale (0.2)   G=gravity (1.5)   ANGLE=swipe slope, px per step (−6)
import puppeteer from 'puppeteer-core'
import { execFileSync } from 'node:child_process'

const URL = (process.env.URL || 'http://127.0.0.1:5220/') + '?nospawn&nointro'
const STEP = Number(process.env.STEP || 29)
const FILM = Number(process.env.FILM || 0.2)
const ANGLE = Number(process.env.ANGLE || -6)
const OUT = process.env.OUT || '/tmp/jelly-cut'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-sandbox', '--window-size=1200,800'] })
const page = await browser.newPage()
await page.setViewport({ width: 1200, height: 800 })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
await page.goto(URL, { waitUntil: 'networkidle0', timeout: 90000 })
await page.waitForFunction(() => window.__jelly && window.__jelly.playing, { timeout: 60000 })

await page.evaluate((g) => {
  const J = window.__jelly
  J.ctx.overrides.gravity = g
  J.spawn({ x: 0, y: 0.5, z: 0, q: [0, 0, 0, 1], v: [0, -0.1, 0], w: [0, 0.15, 0], colorway: 'strawberry', still: true })
}, Number(process.env.G || 1.5))
await sleep(500)
const aim = await page.evaluate(() => {
  const J = window.__jelly
  const bb = J.ctx.world.bodies[0].aabb
  const v = J.camera.position.clone().set((bb[0] + bb[3]) / 2, (bb[1] + bb[4]) / 2, (bb[2] + bb[5]) / 2).project(J.camera)
  return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight }
})
await page.evaluate((f) => { window.__jelly.ctx.overrides.timeScale = f }, FILM)

const steps = Math.ceil(420 / STEP)
const x0 = aim.x - (steps / 2) * STEP, y0 = aim.y - (steps / 2) * ANGLE
await page.mouse.move(x0, y0)
await page.mouse.down()
for (let i = 1; i <= steps; i++) { await page.mouse.move(x0 + i * STEP, y0 + i * ANGLE); await sleep(12) }
await page.mouse.up()
await page.waitForFunction(() => window.__jelly.ctx.world.bodies.length > 1, { timeout: 10000 })
const cutAt = await page.evaluate(() => {
  document.getAnimations().forEach((a) => (a.playbackRate = 0.2))
  const J = window.__jelly
  return { t: J.ctx.world.time, snap: J.game.getSnapshot() }
})

const shots = []
for (const dt of [0.012, 0.035, 0.07, 0.12, 0.18, 0.26, 0.36, 0.5, 0.7]) {
  await page.waitForFunction((t) => window.__jelly.ctx.world.time >= t, { timeout: 60000 }, cutAt.t + dt)
  const path = `${OUT}-${String(shots.length).padStart(2, '0')}.png`
  await page.screenshot({ path })
  shots.push({ path, name: `+${dt}s` })
}

const pieces = await page.evaluate(() => {
  const { world } = window.__jelly.ctx
  return world.bodies.map((b) => {
    const c = b.centroid()
    let vx = 0, vy = 0, vz = 0
    for (let a = 0; a < b.n; a++) { vx += b.v[3 * a]; vy += b.v[3 * a + 1]; vz += b.v[3 * a + 2] }
    vx /= b.n; vy /= b.n; vz /= b.n
    // spin: angular momentum over an isotropic inertia (rough, but tells tumble from drift)
    let lx = 0, ly = 0, lz = 0, I = 0
    for (let a = 0; a < b.n; a++) {
      const rx = b.x[3 * a] - c[0], ry = b.x[3 * a + 1] - c[1], rz = b.x[3 * a + 2] - c[2]
      const ux = b.v[3 * a] - vx, uy = b.v[3 * a + 1] - vy, uz = b.v[3 * a + 2] - vz
      lx += ry * uz - rz * uy; ly += rz * ux - rx * uz; lz += rx * uy - ry * ux
      I += (rx * rx + ry * ry + rz * rz) * (2 / 3)
    }
    const r = (x) => +x.toFixed(2)
    return { nodes: b.n, v: [r(vx), r(vy), r(vz)], spin: [r(lx / I), r(ly / I), r(lz / I)] }
  })
})
const { crumbs, bladeSpeed } = await page.evaluate(() => ({ crumbs: window.__jelly.ctx.crumbs.n, bladeSpeed: +(window.__jelly.ctx.stats.lastSpeed || 0).toFixed(1) }))

await browser.close()
execFileSync('python3', ['-c', `
from PIL import Image
import sys
ims = [Image.open(p).convert('RGB') for p in sys.argv[1:]]
w, h = ims[0].size
# crop to the action: the middle of the frame
box = (int(w * 0.22), int(h * 0.12), int(w * 0.78), int(h * 0.88))
ims = [im.crop(box) for im in ims]
cw, ch = ims[0].size
tw, th = cw // 2, ch // 2
cols = 3
rows = (len(ims) + cols - 1) // cols
out = Image.new('RGB', (tw * cols, th * rows), 'white')
for i, im in enumerate(ims):
    out.paste(im.resize((tw, th)), ((i % cols) * tw, (i // cols) * th))
out.save('${OUT}.png')
`, ...shots.map((s) => s.path)])
console.log(JSON.stringify({ step: STEP, bladeSpeed, frames: shots.map((s) => s.name), snapAfterCut: cutAt.snap, pieces, crumbsAlive: crumbs, errors }, null, 1))
