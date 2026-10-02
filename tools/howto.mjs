// The menu's how-to loop, frame by frame: ~3 loops sampled every ~170 ms,
// cropped to the demo stage. Tiles to /tmp/jelly-howto.png.
import puppeteer from 'puppeteer-core'
import { execFileSync } from 'node:child_process'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-sandbox'] })
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto((process.env.URL || 'http://127.0.0.1:5220/') + '?round=8', { waitUntil: 'networkidle0' })
await page.waitForSelector('.howto-stage')
await sleep(2200)
const r = await page.$eval('.howto', (e) => { const b = e.getBoundingClientRect(); return { x: b.left - 6, y: b.top - 6, width: b.width + 12, height: b.height + 12 } })
const shots = []
for (let i = 0; i < 24; i++) {
  const path = `/tmp/jelly-howto-${String(i).padStart(2, '0')}.png`
  await page.screenshot({ path, clip: r })
  shots.push(path)
  await sleep(110)
}
await browser.close()
execFileSync('python3', ['-c', `
from PIL import Image
import sys
ims = [Image.open(p).convert('RGB') for p in sys.argv[1:]]
w, h = ims[0].size
tw, th = w // 2, h // 2
cols = 6
rows = (len(ims) + cols - 1) // cols
out = Image.new('RGB', (tw * cols, th * rows), 'white')
for i, im in enumerate(ims):
    out.paste(im.resize((tw, th)), ((i % cols) * tw, (i // cols) * th))
out.save('/tmp/jelly-howto.png')
`, ...shots])
console.log(JSON.stringify({ frames: shots.length, errors }))
