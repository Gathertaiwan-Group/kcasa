/**
 * Screenshot the local rebuild with the same page list / viewports as export/screens/index.json and
 * compare against the old-site screenshots (pixel diff on the overlapping area, per-channel threshold).
 * Usage: NODE_PATH=<dir with playwright+sharp> node scripts/frontend/visual_diff.js <export_dir> <out_dir> <base_url> [filter]
 */
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')
const sharp = require('sharp')

const [EXPORT, OUT, BASE, FILTER] = process.argv.slice(2)
const shots = JSON.parse(fs.readFileSync(path.join(EXPORT, 'screens', 'index.json'), 'utf8')).filter((s) => !s.error && (!FILTER || s.name.includes(FILTER)))
fs.mkdirSync(path.join(OUT, 'desktop'), { recursive: true })
fs.mkdirSync(path.join(OUT, 'mobile'), { recursive: true })

async function diff(a, b, outFile) {
  const ma = await sharp(a).metadata()
  const mb = await sharp(b).metadata()
  const w = Math.min(ma.width, mb.width)
  const h = Math.min(ma.height, mb.height, 6000)
  const ra = await sharp(a).extract({ left: 0, top: 0, width: w, height: h }).removeAlpha().raw().toBuffer()
  const rb = await sharp(b).extract({ left: 0, top: 0, width: w, height: h }).removeAlpha().raw().toBuffer()
  const mask = Buffer.alloc(w * h * 3)
  let bad = 0
  for (let i = 0, p = 0; i < ra.length; i += 3, p++) {
    const d = Math.abs(ra[i] - rb[i]) + Math.abs(ra[i + 1] - rb[i + 1]) + Math.abs(ra[i + 2] - rb[i + 2])
    if (d > 60) {
      bad++
      mask[i] = 255
    } else {
      const g = (rb[i] + rb[i + 1] + rb[i + 2]) / 3 / 3 + 170
      mask[i] = mask[i + 1] = mask[i + 2] = g
    }
  }
  await sharp(mask, { raw: { width: w, height: h, channels: 3 } }).png().toFile(outFile)
  return { pct: +((bad / (w * h)) * 100).toFixed(2), oldH: ma.height, newH: mb.height }
}

;(async () => {
  const browser = await chromium.launch(process.env.PW_CHANNEL === 'bundled' ? {} : { channel: 'chrome' })
  const results = []
  for (const vp of (process.env.VP ? [process.env.VP] : ['desktop', 'mobile'])) {
    const ctx = await browser.newContext(vp === 'desktop' ? { viewport: { width: 1440, height: 900 } } : { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 })
    let cartReady = false
    for (const s of shots.filter((x) => x.viewport === vp)) {
      const u = new URL(s.url)
      const target = BASE + u.pathname + u.search
      const page = await ctx.newPage()
      try {
        if (/with-item/.test(s.name) && !cartReady) {
          await page.goto(BASE + '/product/w189tapesofa/', { waitUntil: 'networkidle', timeout: 60000 })
          await page.click('button.single_add_to_cart_button')
          await page.waitForLoadState('networkidle')
          cartReady = true
        }
        await page.goto(target, { waitUntil: 'networkidle', timeout: 60000 })
        // trigger lazy content, then back to top
        await page.evaluate(async () => {
          for (let y = 0; y < document.body.scrollHeight; y += 600) {
            window.scrollTo(0, y)
            await new Promise((r) => setTimeout(r, 120))
          }
          window.scrollTo(0, 0)
        })
        // wait for every image (lazy ones were triggered by the scroll) and web fonts
        await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete), null, { timeout: 20000 }).catch(() => {})
        await page.evaluate(() => document.fonts && document.fonts.ready)
        await page.waitForTimeout(1200)
        const file = path.join(OUT, vp, path.basename(s.file))
        await page.screenshot({ path: file, fullPage: true })
        const d = await diff(path.join(EXPORT, s.file), file, file.replace(/\.png$/, '.diff.png'))
        results.push({ name: s.name, viewport: vp, url: target, ...d })
        console.log(vp, s.name, d.pct + '%', `h ${d.oldH}→${d.newH}`)
      } catch (e) {
        console.log(vp, s.name, 'ERROR', e.message.split('\n')[0])
        results.push({ name: s.name, viewport: vp, url: target, error: e.message.split('\n')[0] })
      }
      await page.close()
    }
    await ctx.close()
  }
  await browser.close()
  results.sort((a, b) => (b.pct ?? 999) - (a.pct ?? 999))
  fs.writeFileSync(path.join(OUT, `results${process.env.VP ? '-' + process.env.VP : ''}.json`), JSON.stringify(results, null, 1))
  console.log('TOP5', results.slice(0, 5).map((r) => `${r.viewport}/${r.name} ${r.pct}%`).join(' | '))
})()
