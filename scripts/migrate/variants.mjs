// Responsive WebP variants (BRIEF phase 3 §1): for every migrated image, widths 480 / 960 / 1440 (q75, never
// upscaled — only widths below the stored image's width) generated from the export/media original and uploaded to
// site-kcasa/v/<width>/<storage key> with an immutable cache-control. Writes work/variants.json
// ({ storage_key: [{ w, h, path, bytes }] }) which is then loaded into site_kcasa.media.variants.
// Resumable: files already generated / uploaded (work/variants_log.json) are skipped.
// usage: source ~/.config/gather-migrate/env && node scripts/migrate/variants.mjs
import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
const require = createRequire(path.join(process.env.HOME, 'gather-migrate/_tools/package.json'))
const sharp = require('sharp')

const WIDTHS = [480, 960, 1440]
const W = path.join(process.env.HOME, 'gather-migrate/kcasa/work')
const OUT = path.join(W, 'variants')
const plan = JSON.parse(fs.readFileSync(path.join(W, 'media_plan.json')))
const URL0 = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL0 || !KEY) throw new Error('source ~/.config/gather-migrate/env first')
const manifestF = path.join(W, 'variants.json')
const logF = path.join(W, 'variants_log.json')
const manifest = fs.existsSync(manifestF) ? JSON.parse(fs.readFileSync(manifestF)) : {}
const log = fs.existsSync(logF) ? JSON.parse(fs.readFileSync(logF)) : {}
const todo = plan.filter((p) => p.key && !p.dup && p.isImg && p.width)
const enc = (k) => k.split('/').map(encodeURIComponent).join('/')

async function upload(key, body) {
  for (let a = 0; a < 3; a++) {
    const r = await fetch(`${URL0}/storage/v1/object/site-kcasa/${enc(key)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, apikey: KEY, 'Content-Type': 'image/webp', 'x-upsert': 'true', 'cache-control': 'public, max-age=31536000, immutable' },
      body,
    })
    if (r.ok) return true
    const t = await r.text()
    if (a === 2) console.log('ERR', key, r.status, t.slice(0, 160))
    await new Promise((s) => setTimeout(s, 1000))
  }
  return false
}

let i = 0, made = 0, up = 0, fail = 0
async function worker() {
  while (i < todo.length) {
    const p = todo[i++]
    const list = []
    for (const w of WIDTHS) {
      if (w >= p.width) continue
      const key = `v/${w}/${p.key.replace(/\.[^./]+$/, '')}.webp`
      const dst = path.join(OUT, key)
      if (!fs.existsSync(dst)) {
        fs.mkdirSync(path.dirname(dst), { recursive: true })
        await sharp(p.src, { failOn: 'none' }).rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: 75 }).toFile(dst)
        made++
      }
      const m = await sharp(dst).metadata()
      const bytes = fs.statSync(dst).size
      if (log[key] !== 'ok') {
        if (await upload(key, fs.readFileSync(dst))) { log[key] = 'ok'; up++ } else { fail++; continue }
      }
      list.push({ w: m.width, h: m.height, path: key, bytes })
    }
    manifest[p.key] = list
    if ((made + up) % 300 === 0) { fs.writeFileSync(logF, JSON.stringify(log)); fs.writeFileSync(manifestF, JSON.stringify(manifest)) }
  }
}
await Promise.all([1, 2, 3, 4].map(worker))
fs.writeFileSync(logF, JSON.stringify(log))
fs.writeFileSync(manifestF, JSON.stringify(manifest))
const all = Object.values(manifest).flat()
console.log({ images: todo.length, variants: all.length, generated: made, uploaded: up, failed: fail, MB: +(all.reduce((a, v) => a + v.bytes, 0) / 1048576).toFixed(1) })
