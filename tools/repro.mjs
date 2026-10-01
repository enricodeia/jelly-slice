import puppeteer from 'puppeteer-core'
import { writeFileSync } from 'node:fs'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL = (process.env.URL || 'http://127.0.0.1:5220/') + '?nointro' // practice: endless, no menu
const OUT = process.env.OUT || '/tmp/jelly-slice'

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--window-size=1280,800'],
})

const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 800 })

const errors = []
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text())
})
page.on('pageerror', (err) => errors.push('pageerror: ' + err.message))

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 90000 })
// the preloader docks the logo, then the game starts: wait for it
await page.waitForFunction(() => window.__jelly && window.__jelly.playing, { timeout: 60000 })
await new Promise((r) => setTimeout(r, 1800))
await page.screenshot({ path: `${OUT}-1-loaded.png` })

// Simulate a diagonal swipe across the canvas a few times, spaced out so
// bears have time to spawn and rise into frame.
for (let pass = 0; pass < 4; pass++) {
  await new Promise((r) => setTimeout(r, 700))
  const steps = 10
  const x0 = 300, y0 = 620
  const x1 = 980, y1 = 260
  await page.mouse.move(x0, y0)
  await page.mouse.down()
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    await page.mouse.move(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)
    await new Promise((r) => setTimeout(r, 16))
  }
  await page.mouse.up()
}

await new Promise((r) => setTimeout(r, 500))
await page.screenshot({ path: `${OUT}-2-after-swipes.png` })

const scoreText = await page.$eval('.hud-score b', (el) => el.textContent).catch(() => null)

await browser.close()

const report = { url: URL, scoreText, errorCount: errors.length, errors: errors.slice(0, 20) }
writeFileSync(`${OUT}-report.json`, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
