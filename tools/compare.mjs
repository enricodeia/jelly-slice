// Side-by-side with the reference photo: two upright bears (orange, red),
// straight-on telephoto, gravity off so they hold the pose. Writes
// /tmp/jelly-compare.png = [reference | render] at the same height.
import puppeteer from 'puppeteer-core'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const REF = path.join(here, 'reference', 'goldbears.png')
const URL = (process.env.URL || 'http://127.0.0.1:5220/') + '?nospawn&nointro' + (process.env.DEBUG ? '&debug=' + process.env.DEBUG : '')
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-sandbox', '--window-size=900,900'] })
const page = await browser.newPage()
await page.setViewport({ width: 900, height: 900, deviceScaleFactor: 1.5 })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
await page.goto(URL, { waitUntil: 'networkidle0', timeout: 90000 })
await page.waitForFunction(() => window.__jelly && window.__jelly.ctx)
const turn = Number(process.env.TURN || 0) // yaw in radians, to inspect depth
await page.evaluate((turn) => {
  const J = window.__jelly
  J.ctx.overrides.gravity = 0
  const s = Math.sin(turn / 2), c = Math.cos(turn / 2)
  J.spawn({ x: -0.66, y: -1.15, z: 0, q: [0, s, 0, c], v: [0, 0, 0], w: [0, 0, 0], colorway: 'orange' })
  J.spawn({ x: 0.66, y: -1.15, z: 0, q: [0, s, 0, c], v: [0, 0, 0], w: [0, 0, 0], colorway: 'strawberry' })
  J.camera.fov = 22
  J.camera.position.set(0, -1.12, 6.9)
  J.camera.lookAt(0, -1.12, 0)
  J.camera.updateProjectionMatrix()
  document.querySelector('.hud').style.display = 'none'
  document.querySelector('.brand').style.display = 'none'
  J.ctx.look.uDebug.value = Number(new URLSearchParams(location.search).get('debug') || 0)
}, turn)
await new Promise((r) => setTimeout(r, 1500))
await page.screenshot({ path: '/tmp/jelly-render.png' })
await browser.close()
execFileSync('python3', ['-c', `
from PIL import Image
ref = Image.open('${REF}').convert('RGB')
ren = Image.open('/tmp/jelly-render.png').convert('RGB')
h = 820
ref = ref.resize((int(ref.width * h / ref.height), h))
ren = ren.resize((int(ren.width * h / ren.height), h))
out = Image.new('RGB', (ref.width + ren.width + 20, h), 'white')
out.paste(ref, (0, 0)); out.paste(ren, (ref.width + 20, 0))
out.save('/tmp/jelly-compare.png')
`])
console.log('errors', errors)
