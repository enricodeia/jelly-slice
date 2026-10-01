// Close-up review: waits for bears to land, then frames the camera tight on the
// scene. Optional swipe through the middle first (CUT=1). Writes /tmp/jelly-close-*.png
import puppeteer from 'puppeteer-core'
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--window-size=1400,900'] })
const page = await browser.newPage()
await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 2 })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
await page.goto(process.env.URL || 'http://127.0.0.1:5220/', { waitUntil: 'networkidle0' })
await new Promise((r) => setTimeout(r, Number(process.env.WAIT || 4500)))
if (process.env.CUT) {
  await page.mouse.move(250, 700)
  await page.mouse.down()
  for (let i = 1; i <= 14; i++) { await page.mouse.move(250 + i * 70, 700 - i * 30); await new Promise((r) => setTimeout(r, 16)) }
  await page.mouse.up()
  await new Promise((r) => setTimeout(r, 600))
}
// freeze physics spawning by moving the camera only
await page.evaluate(() => {
  const { camera } = window.__jelly
  camera.position.set(0.4, -0.2, 6.2)
  camera.lookAt(0, -1.7, 0)
  camera.updateProjectionMatrix()
})
await new Promise((r) => setTimeout(r, 250))
await page.screenshot({ path: '/tmp/jelly-close-1.png' })
await browser.close()
console.log('errors', errors)
