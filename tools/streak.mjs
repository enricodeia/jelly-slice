// Streak + multiplier review (?nospawn&nointro): bears dropped one at a time,
// each sliced by an aimed swipe; after every cut the streak, tier and score
// are checked against the rules in src/game/game.js (the score can only be
// higher than the bears' share: a swipe may also clip an old piece). Shoots
// the screen at every tier-up (callout, points, crumbs, glint, badge), then
// lets one bear fall through uncut and checks the streak breaks.
// Tiles to /tmp/jelly-streak.png.
import puppeteer from 'puppeteer-core'
import { execFileSync } from 'node:child_process'

const URL = (process.env.URL || 'http://127.0.0.1:5220/') + '?nospawn&nointro'
const BEARS = Number(process.env.BEARS || 16)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-sandbox', '--window-size=1280,800', '--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 800 })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
await page.goto(URL, { waitUntil: 'networkidle0', timeout: 90000 })
await page.waitForFunction(() => window.__jelly && window.__jelly.playing, { timeout: 60000 })
await page.evaluate(() => { window.__jelly.ctx.overrides.gravity = 3 })

const tiers = await page.evaluate(async () => (await import('/src/game/game.js')).TIERS.map((t) => ({ at: t.at, mult: t.mult })))
const tierFor = (s) => tiers.reduce((t, x, i) => (s >= x.at ? i : t), 0)

const shots = []
async function shot(name) {
  const path = `/tmp/jelly-streak-${String(shots.length).padStart(2, '0')}.png`
  await page.screenshot({ path })
  shots.push({ path, name })
}

let expectedMin = 0
const log = []
for (let i = 1; i <= BEARS; i++) {
  const x = [-2.2, 0, 2.2][i % 3]
  await page.evaluate((x) => window.__jelly.spawn({ x, y: 1.3, z: 0, v: [0, -0.3, 0], w: [0, 0.4, 0.1], still: true }), x)
  await sleep(140)
  const aim = await page.evaluate(() => {
    const J = window.__jelly
    const b = J.ctx.world.bodies.filter((b) => b.data.whole).at(-1)
    const bb = b.aabb
    const v = J.camera.position.clone().set((bb[0] + bb[3]) / 2, (bb[1] + bb[4]) / 2, (bb[2] + bb[5]) / 2).project(J.camera)
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight }
  })
  // a brisk swipe through it, alternating direction and slope
  const dir = i % 2 ? 1 : -1
  const x0 = aim.x - dir * 190, y0 = aim.y + 36
  await page.mouse.move(x0, y0)
  await page.mouse.down()
  for (let s = 1; s <= 13; s++) { await page.mouse.move(x0 + dir * s * 29, y0 - s * 5.5); await sleep(12) }
  await page.mouse.up()
  await sleep(110)
  const snap = await page.evaluate(() => ({ ...window.__jelly.game.getSnapshot() }))
  const tier = tierFor(i)
  expectedMin += Math.round(10 * tiers[tier].mult)
  const ok = snap.streak === i && snap.tier === tier && snap.score >= expectedMin
  log.push(`${ok ? 'ok ' : 'BAD'} bear ${String(i).padStart(2)}: streak ${snap.streak} tier ${snap.tier} (×${tiers[snap.tier].mult}) score ${snap.score} (≥ ${expectedMin})`)
  if (i > 1 && tiers.some((t) => t.at === i)) await shot(`tier-up at ${i}: ×${tiers[tier].mult}`)
  if (i === 1) {
    const audio = await page.evaluate(() => window.__jelly.sound.state)
    log.push(`${audio === 'running' ? 'ok ' : 'BAD'} audio after the first press: ${audio}`)
  }
  await sleep(700)
}

// mute toggles from the HUD and persists
await page.click('.hud-right .hud-btn[aria-label="Mute"]')
const muted = await page.evaluate(() => [window.__jelly.game.getSnapshot().muted, localStorage.getItem('jelly-slice-muted')])
await page.click('.hud-right .hud-btn[aria-label="Sound on"]')
const unmuted = await page.evaluate(() => window.__jelly.game.getSnapshot().muted)
log.push(`${muted[0] === true && muted[1] === '1' && unmuted === false ? 'ok ' : 'BAD'} mute button: muted ${muted[0]} stored ${muted[1]} → back ${unmuted}`)

// the next bear falls through uncut: the streak must break
await page.evaluate(() => {
  const J = window.__jelly
  J.ctx.overrides.gravity = 9
  J.spawn({ x: 0.5, y: 2.5, z: 0, v: [0, -2, 0], still: true })
})
await page.waitForFunction(() => window.__jelly.game.getSnapshot().streak === 0, { timeout: 8000 }).catch(() => {})
await sleep(250)
const lostNote = await page.evaluate(() => document.querySelector('.fx-lost')?.textContent || null)
await shot('bear escaped: streak lost')
const after = await page.evaluate(() => ({ ...window.__jelly.game.getSnapshot() }))
log.push(`${after.streak === 0 && after.tier === 0 && lostNote ? 'ok ' : 'BAD'} escaped: streak ${after.streak} tier ${after.tier} note "${lostNote}"`)

await browser.close()
execFileSync('python3', ['-c', `
from PIL import Image
import sys
ims = [Image.open(p).convert('RGB') for p in sys.argv[1:]]
w, h = ims[0].size
tw, th = w // 2, h // 2
cols = 2
rows = (len(ims) + cols - 1) // cols
out = Image.new('RGB', (tw * cols, th * rows), 'white')
for i, im in enumerate(ims):
    out.paste(im.resize((tw, th)), ((i % cols) * tw, (i // cols) * th))
out.save('/tmp/jelly-streak.png')
`, ...shots.map((s) => s.path)])
console.log(log.join('\n'))
console.log(JSON.stringify({ shots: shots.map((s) => s.name), errors }))
