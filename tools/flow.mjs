// The whole experience, start to finish: intro → menu (nickname, score to
// beat) → Play → 3·2·1 → a round with aimed cuts (one filmed in slow motion
// to catch the screen-space slice) → the last seconds → Time! → results with
// the leaderboard. ROUND=60 plays a real, ranked round (it lands on this
// device's board); the default 8 s round is a practice round. VIEW=phone: 390×844. Prints checks,
// tiles the frames to /tmp/jelly-flow.png.
import puppeteer from 'puppeteer-core'
import { execFileSync } from 'node:child_process'

const ROUND = Number(process.env.ROUND || 8)
const NAME = process.env.NAME || 'Enrico'
const BASE = process.env.URL || 'http://127.0.0.1:5220/'
const URL = BASE + (ROUND === 60 ? '' : `?round=${ROUND}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-sandbox', '--window-size=1280,800'] })
const page = await browser.newPage()
const PHONE = process.env.VIEW === 'phone'
await page.setViewport(PHONE ? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { width: 1280, height: 800 })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
const checks = []
const check = (ok, what) => checks.push(`${ok ? 'ok ' : 'BAD'} ${what}`)
const shots = []
async function shot(name, clip) {
  const path = `/tmp/jelly-flow-${String(shots.length).padStart(2, '0')}.png`
  await page.screenshot({ path, clip })
  shots.push({ path, name })
}
const snap = () => page.evaluate(() => ({ ...window.__jelly.game.getSnapshot(), left: window.__jelly.game.clock.left }))

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 90000 })
await sleep(900)
await shot('intro')
await page.waitForSelector('.menu-card input', { timeout: 60000 })
await sleep(1300)
await shot('menu')
check((await snap()).phase === 'menu', 'menu phase after the intro')
check(await page.$eval('.btn-play', (b) => b.disabled), 'Play disabled without a nickname')

await page.click('.menu-card input', { clickCount: 3 })
await page.keyboard.type(NAME)
check(!(await page.$eval('.btn-play', (b) => b.disabled)), 'Play enabled with a nickname')
await page.click('.btn-play')
await page.waitForFunction(() => window.__jelly.game.getSnapshot().phase === 'countdown', { timeout: 5000 })
await sleep(450)
await shot('countdown')
await page.waitForFunction(() => window.__jelly.game.getSnapshot().phase === 'playing', { timeout: 8000 })
await sleep(120)
await shot('go')
check((await snap()).nickname === NAME, `nickname kept: ${NAME}`)
const panelOnScreen = await page.evaluate(() =>
  [...document.querySelectorAll('[class*="leva-c-"]')].some((e) => {
    const r = e.getBoundingClientRect()
    const s = getComputedStyle(e)
    return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'
  })
)
check(!panelOnScreen, 'tuning panel hidden')

// slice what falls, aiming at the newest whole bear each time
async function sliceOne({ film = 0 } = {}) {
  const aim = await page.evaluate(() => {
    const J = window.__jelly
    const b = J.ctx.world.bodies.filter((b) => b.data.whole && b.aabb[4] < 3.2 && b.aabb[1] > -3).at(-1)
    if (!b) return null
    const bb = b.aabb
    const v = J.camera.position.clone().set((bb[0] + bb[3]) / 2, (bb[1] + bb[4]) / 2, (bb[2] + bb[5]) / 2).project(J.camera)
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight }
  })
  if (!aim) return false
  if (film) await page.evaluate((f) => { window.__jelly.ctx.overrides.timeScale = f }, film)
  const reach = PHONE ? 110 : 200
  const x0 = aim.x - reach, y0 = aim.y + 30
  await page.mouse.move(x0, y0)
  await page.mouse.down()
  for (let s = 1; s <= 12; s++) { await page.mouse.move(x0 + s * (reach / 6), y0 - s * 5); await sleep(10) }
  await page.mouse.up()
  return true
}

let filmed = false
const tEnd = Date.now() + (ROUND + 4) * 1000
while (Date.now() < tEnd) {
  const s = await snap()
  if (s.phase !== 'playing') break
  if (!filmed && s.score > 0 && s.left > 3) {
    // one cut in slow motion: the frame splits along the swipe, a ring goes out
    if (await sliceOne({ film: 0.12 })) {
      await sleep(60)
      await shot('cut, screen slice (slow-mo)')
      await sleep(1100)
      await shot('cut, jelly ring (slow-mo)')
      await page.evaluate(() => { window.__jelly.ctx.overrides.timeScale = 1 })
      filmed = true
      continue
    }
  }
  if (s.left < 3.4 && !shots.some((x) => x.name.startsWith('last'))) {
    await sleep(Math.max(0, (s.left - 2.85) * 1000))
    await shot('last seconds: urgency')
    continue
  }
  await sliceOne()
  await sleep(160)
}
await page.waitForFunction(() => window.__jelly.game.getSnapshot().phase === 'over', { timeout: 15000 })
await sleep(250)
await shot('time up')
await page.waitForSelector('.results-card', { timeout: 6000 })
await sleep(1500)
await shot('results')

const end = await snap()
check(end.phase === 'over' && end.secondsLeft === 0, 'round over at 0:00')
check(end.score > 0 && end.stats.bears > 0, `scored ${end.score} (${end.stats.bears} bears, ${end.stats.slices} slices, best streak ${end.stats.bestStreak})`)
const rankText = await page.$eval('.results-rank', (e) => e.textContent)
const boardRows = await page.$$eval('.results-card .board-list li', (ls) => ls.map((l) => l.textContent))
if (ROUND === 60) {
  check(end.result?.ranked && end.result.rank >= 1, `ranked: "${rankText}"`)
  check(boardRows.some((r) => r.includes(NAME)), `on the board: ${boardRows.slice(0, 3).join(' | ')}`)
  check(await page.$('.board-list li.is-me') !== null, 'own row highlighted')
} else check(/not ranked/.test(rankText), `practice round: "${rankText}"`)

// Play again → a fresh countdown with the score reset
await page.click('.results-card .btn-play')
await page.waitForFunction(() => window.__jelly.game.getSnapshot().phase === 'countdown', { timeout: 5000 })
const again = await snap()
check(again.score === 0 && again.streak === 0, 'Play again resets the round')

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
out.save('/tmp/jelly-flow.png')
`, ...shots.map((s) => s.path)])
console.log(checks.join('\n'))
console.log(JSON.stringify({ shots: shots.map((s) => s.name), errors }))
