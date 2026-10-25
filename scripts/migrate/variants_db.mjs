// Load work/variants.json into site_kcasa.media.variants (matched by storage_path), via the Management API.
// usage: source ~/.config/gather-migrate/env && node scripts/migrate/variants_db.mjs
import fs from 'fs'
import path from 'path'
const manifest = JSON.parse(fs.readFileSync(path.join(process.env.HOME, 'gather-migrate/kcasa/work/variants.json')))
const entries = Object.entries(manifest).map(([k, list]) => [k, list.map(({ w, h, path }) => ({ w, h, path }))])
let updated = 0
for (let i = 0; i < entries.length; i += 400) {
  const chunk = JSON.stringify(Object.fromEntries(entries.slice(i, i + 400))).replace(/'/g, "''")
  const sql = `with v as (select key, value from jsonb_each('${chunk}'::jsonb))
    update site_kcasa.media m set variants = v.value, updated_at = now() from v where m.storage_path = v.key returning m.id`
  const r = await fetch('https://api.supabase.com/v1/projects/ozwftlkgqmewtadypsfi/database/query', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  const j = await r.json()
  if (!r.ok || !Array.isArray(j)) throw new Error(JSON.stringify(j).slice(0, 300))
  updated += j.length
}
console.log({ keys: entries.length, media_rows_updated: updated })
