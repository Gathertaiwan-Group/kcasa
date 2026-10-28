// DB integration tests for the 藍新 stock hold / flood guard / payment attempts (site_kcasa SQL functions,
// migration 20261029000100). They run against the real Supabase project and only when explicitly enabled:
//   KC_DB_TEST=1 SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm test
// Fixtures are a private test product + test orders tagged meta.kc_db_test; all are deleted afterwards.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'

const URL_ = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const enabled = process.env.KC_DB_TEST === '1' && !!URL_ && !!KEY
const skip = enabled ? false : 'set KC_DB_TEST=1 + SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to run'
const TAG = `kcdb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const NP = 'ry_newebpay_credit'

async function rest(method, path, body, prefer = 'return=representation') {
  const r = await fetch(`${URL_}/rest/v1/${path}`, {
    method,
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Accept-Profile': 'site_kcasa', 'Content-Profile': 'site_kcasa', 'Content-Type': 'application/json', Prefer: prefer },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await r.text()
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${t}`)
  return t ? JSON.parse(t) : null
}
const rpc = (fn, args) => rest('POST', `rpc/${fn}`, args)

let product
async function setStock(q) {
  await rest('PATCH', `products?id=eq.${product.id}`, { stock_quantity: q, stock_status: q > 0 ? 'instock' : 'outofstock' })
}
async function getProduct() {
  return (await rest('GET', `products?id=eq.${product.id}&select=stock_quantity,stock_status,total_sales`))[0]
}
let ipSeq = 0
const testOrderIds = []
async function newOrder({ ip = `198.51.100.${++ipSeq}`, email = `${TAG}-${ipSeq}@example.invalid`, qty = 1, method = NP } = {}) {
  const [o] = await rest('POST', 'orders', { status: 'pending', currency: 'TWD', payment_method: method, payment_method_title: 'test', billing: { email }, total: 100, customer_ip: ip, created_via: 'checkout', meta: { kc_db_test: TAG } })
  testOrderIds.push(o.id)
  await rest('POST', 'order_items', { order_id: o.id, item_type: 'line_item', name: 'kc db test', product_id: product.id, quantity: qty, subtotal: 100, total: 100 })
  return o.id
}
const getOrder = async (id) => (await rest('GET', `orders?id=eq.${id}&select=status,meta,transaction_id`))[0]

// every real product / variation stock row, compared row by row after the run (the test product is excluded)
async function stockSnapshot() {
  const ps = await rest('GET', 'products?select=id,stock_quantity,stock_status,total_sales&order=id')
  const vs = await rest('GET', 'product_variations?select=id,stock_quantity,stock_status&order=id')
  return { products: ps.filter((x) => !product || x.id !== product.id), variations: vs }
}
let snapshot

// pg_cron lives outside the REST API: the Management API runs SQL (only when SUPABASE_ACCESS_TOKEN is set)
const MGMT = process.env.SUPABASE_ACCESS_TOKEN
const PROJECT = 'ozwftlkgqmewtadypsfi'
async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${MGMT}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) })
  const t = await r.text()
  if (!r.ok) throw new Error(`sql → ${r.status} ${t}`)
  return JSON.parse(t)
}

before(async () => {
  if (!enabled) return
  snapshot = await stockSnapshot()
  ;[product] = await rest('POST', 'products', { name: `KC DB TEST ${TAG}`, slug: TAG, type: 'simple', status: 'private', manage_stock: true, stock_quantity: 1, backorders: 'no', stock_status: 'instock', regular_price: 100, price: 100 })
})
after(async () => {
  if (!enabled) return
  await rest('DELETE', `orders?meta->>kc_db_test=eq.${TAG}`, undefined, 'return=minimal') // items / notes / holds / attempts cascade
  for (let i = 0; i < testOrderIds.length; i += 50)
    await rest('DELETE', `audit_log?entity_type=eq.order&entity_id=in.(${testOrderIds.slice(i, i + 50).join(',')})`, undefined, 'return=minimal')
  if (product) await rest('DELETE', `products?id=eq.${product.id}`, undefined, 'return=minimal')
  const left = await rest('GET', `orders?meta->>kc_db_test=eq.${TAG}&select=id`)
  assert.equal(left.length, 0)
  const auditLeft = testOrderIds.length ? await rest('GET', `audit_log?entity_type=eq.order&entity_id=in.(${testOrderIds.join(',')})&select=id`) : []
  assert.equal(auditLeft.length, 0)
  const now = await stockSnapshot()
  assert.equal(now.products.length, snapshot.products.length); assert.equal(now.variations.length, snapshot.variations.length)
  for (let i = 0; i < now.products.length; i++) assert.deepEqual(now.products[i], snapshot.products[i])
  for (let i = 0; i < now.variations.length; i++) assert.deepEqual(now.variations[i], snapshot.variations[i])
  console.log(`# stock snapshot identical: ${now.products.length} products, ${now.variations.length} variations; test orders left: ${left.length}`)
})

test('two concurrent orders for the last unit: exactly one holds it, the other is refused', { skip }, async () => {
  await setStock(1)
  const [a, b] = await Promise.all([newOrder(), newOrder()])
  const rs = await Promise.all([rpc('order_hold_stock', { p_order_id: a }), rpc('order_hold_stock', { p_order_id: b })])
  assert.equal(rs.filter((r) => r.ok).length, 1, JSON.stringify(rs))
  const lost = rs.find((r) => !r.ok)
  assert.equal(lost.reason, 'out_of_stock'); assert.equal(lost.short[0].available, 0)
  const p = await getProduct()
  assert.equal(p.stock_quantity, 0); assert.equal(p.stock_status, 'outofstock')
})

test('hold → payment failure releases exactly once', { skip }, async () => {
  await setStock(1)
  const id = await newOrder()
  assert.equal((await rpc('order_hold_stock', { p_order_id: id })).ok, true)
  assert.equal((await getProduct()).stock_quantity, 0)
  const again = await rpc('order_hold_stock', { p_order_id: id }) // idempotent: no second reservation
  assert.equal(again.already, true); assert.equal((await getProduct()).stock_quantity, 0)
  const rel = await Promise.all([1, 2, 3].map(() => rpc('order_release_stock', { p_order_id: id, p_new_status: 'failed', p_meta: { status: 'MPG03008' } })))
  assert.equal(rel.filter((x) => x === true).length, 1)
  const p = await getProduct()
  assert.equal(p.stock_quantity, 1); assert.equal(p.stock_status, 'instock')
  const o = await getOrder(id)
  assert.equal(o.status, 'failed'); assert.equal(o.meta.stock_hold, 'released'); assert.equal(o.meta.newebpay.status, 'MPG03008')
})

test('hold → paid converts the hold: no second reduction, total_sales once, re-sent notify is a no-op', { skip }, async () => {
  await setStock(2)
  const before = await getProduct()
  const id = await newOrder()
  await rpc('order_hold_stock', { p_order_id: id })
  assert.equal((await getProduct()).stock_quantity, 1)
  const paid = await Promise.all([1, 2, 3].map((n) => rpc('newebpay_mark_paid', { p_order_id: id, p_trade_no: 'T' + TAG.slice(-6), p_meta: { n } })))
  assert.equal(paid.filter((x) => x === true).length, 1)
  const p = await getProduct()
  assert.equal(p.stock_quantity, 1, 'paid must not reduce stock again')
  assert.equal(p.total_sales, before.total_sales + 1)
  const o = await getOrder(id)
  assert.equal(o.status, 'processing'); assert.equal(o.meta.stock_hold, 'converted')
  // a late failure / timeout can no longer release a converted hold
  assert.equal(await rpc('order_release_stock', { p_order_id: id, p_new_status: 'failed' }), false)
  assert.equal(await rpc('order_release_stock', { p_order_id: id }), false)
  assert.equal((await getProduct()).stock_quantity, 1)
})

test('60-minute timeout cancels the unpaid order and releases its hold; paying afterwards reduces stock once', { skip }, async () => {
  await setStock(1)
  const id = await newOrder()
  await rpc('order_hold_stock', { p_order_id: id })
  await rest('PATCH', `orders?id=eq.${id}`, { created_at: new Date(Date.now() - 61 * 60_000).toISOString() })
  const ids = (await rpc('newebpay_cancel_expired', { p_minutes: 60 })).map(Number)
  assert.ok(ids.includes(id), JSON.stringify(ids))
  assert.equal((await getOrder(id)).status, 'cancelled')
  assert.equal((await getProduct()).stock_quantity, 1)
  assert.ok(!(await rpc('newebpay_cancel_expired', { p_minutes: 60 })).map(Number).includes(id))
  // late success notify after the release: money is taken, so it reduces now (once)
  assert.equal(await rpc('newebpay_mark_paid', { p_order_id: id, p_trade_no: 'L' + TAG.slice(-6), p_meta: {} }), true)
  assert.equal(await rpc('newebpay_mark_paid', { p_order_id: id, p_trade_no: 'L' + TAG.slice(-6), p_meta: {} }), false)
  assert.equal((await getProduct()).stock_quantity, 0)
})

test('admin cancel releases a hold (no status argument); nothing left to release afterwards', { skip }, async () => {
  await setStock(3)
  const id = await newOrder({ qty: 2 })
  await rpc('order_hold_stock', { p_order_id: id })
  assert.equal((await getProduct()).stock_quantity, 1)
  await rest('PATCH', `orders?id=eq.${id}`, { status: 'cancelled' })
  assert.equal(await rpc('order_release_stock', { p_order_id: id }), true)
  assert.equal(await rpc('order_release_stock', { p_order_id: id }), false)
  assert.equal((await getProduct()).stock_quantity, 3)
})

test('flood guard: max 3 unpaid 藍新 orders per IP and per e-mail (concurrent burst too); others unaffected', { skip }, async () => {
  await setStock(100)
  const ip = '203.0.113.77'
  const ids = await Promise.all([1, 2, 3, 4, 5].map((n) => newOrder({ ip, email: `${TAG}-flood${n}@example.invalid` })))
  const rs = await Promise.all(ids.map((id) => rpc('order_hold_stock', { p_order_id: id, p_max_unpaid: 3, p_window_minutes: 60 })))
  // refused orders are deleted by the checkout; do the same here so they do not count
  for (let i = 0; i < ids.length; i++) if (!rs[i].ok) await rest('DELETE', `orders?id=eq.${ids[i]}`, undefined, 'return=minimal')
  assert.equal(rs.filter((r) => r.ok).length, 3, JSON.stringify(rs))
  assert.ok(rs.filter((r) => !r.ok).every((r) => r.reason === 'too_many_unpaid'))
  // same e-mail from another IP is limited as well
  const email = `${TAG}-same@example.invalid`
  const byMail = []
  for (let i = 0; i < 4; i++) byMail.push(await rpc('order_hold_stock', { p_order_id: await newOrder({ email }), p_max_unpaid: 3, p_window_minutes: 60 }))
  assert.deepEqual(byMail.map((r) => r.ok), [true, true, true, false])
  // a different buyer is not affected
  assert.equal((await rpc('order_hold_stock', { p_order_id: await newOrder(), p_max_unpaid: 3, p_window_minutes: 60 })).ok, true)
  // 領取報價 orders are not limited
  const cheque = await newOrder({ ip, method: 'cheque' })
  assert.equal((await rpc('order_hold_stock', { p_order_id: cheque, p_max_unpaid: 3 })).ok, true)
})

test('payment attempts: unique KC<id>_<n> numbers even when requested concurrently; none once the order is no longer payable', { skip }, async () => {
  await setStock(5)
  const id = await newOrder()
  const nos = await Promise.all([1, 2, 3, 4, 5].map(() => rpc('newebpay_new_attempt', { p_order_id: id, p_max: 20 })))
  assert.equal(new Set(nos).size, 5)
  for (const m of nos) assert.match(m, new RegExp(`^KC${id}_[1-5]$`))
  const rows = await rest('GET', `newebpay_attempts?order_id=eq.${id}&select=merchant_order_no`)
  assert.equal(rows.length, 5)
  assert.equal((await getOrder(id)).meta.newebpay.attempts, 5)
  await rest('PATCH', `orders?id=eq.${id}`, { status: 'cancelled' })
  assert.equal(await rpc('newebpay_new_attempt', { p_order_id: id, p_max: 20 }), null)
  const capped = await newOrder()
  const c = []
  for (let i = 0; i < 3; i++) c.push(await rpc('newebpay_new_attempt', { p_order_id: capped, p_max: 2 }))
  assert.deepEqual(c, [`KC${capped}_1`, `KC${capped}_2`, null])
})

// ---------------------------------------------------------------- expiry is scheduled (pg_cron) and recorded in the DB
const notesOf = async (id) => (await rest('GET', `order_notes?order_id=eq.${id}&select=content,added_by`)).map((n) => n.content)
const auditOf = async (id) => rest('GET', `audit_log?entity_type=eq.order&entity_id=eq.${id}&select=action,actor,via,after`)

test('expiry writes the order note + audit row in the DB (so a cron cancel is recorded like an app cancel)', { skip }, async () => {
  await setStock(1)
  const id = await newOrder()
  await rpc('order_hold_stock', { p_order_id: id })
  await rest('PATCH', `orders?id=eq.${id}`, { created_at: new Date(Date.now() - 61 * 60_000).toISOString() })
  await rpc('newebpay_cancel_expired', { p_minutes: 60 })
  assert.equal((await getOrder(id)).status, 'cancelled')
  assert.equal((await getProduct()).stock_quantity, 1)
  assert.equal((await notesOf(id)).filter((c) => c.includes('已達付款時限')).length, 1)
  const a = (await auditOf(id)).filter((x) => x.action === 'order.status')
  assert.equal(a.length, 1); assert.equal(a[0].via, 'system'); assert.equal(a[0].after.status, 'cancelled')
  await rest('DELETE', `audit_log?entity_type=eq.order&entity_id=eq.${id}`, undefined, 'return=minimal')
})

test('pg_cron job site_kcasa_expire_holds: every 5 min, only calls site_kcasa.newebpay_cancel_expired; its command releases an expired hold', { skip: skip || (MGMT ? false : 'needs SUPABASE_ACCESS_TOKEN') }, async () => {
  const jobs = await sql(`select jobname, schedule, command, active from cron.job where jobname = 'site_kcasa_expire_holds'`)
  assert.equal(jobs.length, 1); assert.equal(jobs[0].schedule, '*/5 * * * *'); assert.equal(jobs[0].active, true)
  assert.equal(jobs[0].command, 'select count(*) from site_kcasa.newebpay_cancel_expired(60)')
  await setStock(1)
  const id = await newOrder()
  await rpc('order_hold_stock', { p_order_id: id })
  assert.equal((await getProduct()).stock_quantity, 0)
  await rest('PATCH', `orders?id=eq.${id}`, { created_at: new Date(Date.now() - 61 * 60_000).toISOString() })
  await sql(jobs[0].command) // exactly what the scheduler runs
  assert.equal((await getOrder(id)).status, 'cancelled')
  assert.equal((await getProduct()).stock_quantity, 1)
  await rest('DELETE', `audit_log?entity_type=eq.order&entity_id=eq.${id}`, undefined, 'return=minimal')
})

// ---------------------------------------------------------------- cancelled (hold released) → back to processing / completed
test('released hold, then admin sets processing: stock reduced again once, no stock check; repeated / later status changes do not reduce again', { skip }, async () => {
  await setStock(2)
  const before0 = await getProduct()
  const id = await newOrder()
  await rpc('order_hold_stock', { p_order_id: id })
  await rest('PATCH', `orders?id=eq.${id}`, { created_at: new Date(Date.now() - 61 * 60_000).toISOString() })
  await rpc('newebpay_cancel_expired', { p_minutes: 60 })
  assert.equal((await getProduct()).stock_quantity, 2)
  // paid another way; admin moves cancelled → processing (updateOrderStatus → settleHoldForStatus → order_convert_hold)
  await rest('PATCH', `orders?id=eq.${id}`, { status: 'processing' })
  const r = await Promise.all([1, 2, 3].map(() => rpc('order_convert_hold', { p_order_id: id, p_always: false })))
  assert.equal(r.filter((x) => x === true).length, 1)
  let p = await getProduct()
  assert.equal(p.stock_quantity, 1); assert.equal(p.total_sales, before0.total_sales + 1)
  const o = await getOrder(id)
  assert.equal(o.meta.stock_reduced, true); assert.equal(o.meta.stock_hold, 'rereduced')
  const notes = await notesOf(id)
  assert.equal(notes.filter((c) => c.includes('已重新扣除庫存')).length, 1)
  assert.ok(!notes.some((c) => c.includes('超賣')))
  // processing → completed: still once
  await rest('PATCH', `orders?id=eq.${id}`, { status: 'completed' })
  assert.equal(await rpc('order_convert_hold', { p_order_id: id, p_always: false }), false)
  p = await getProduct()
  assert.equal(p.stock_quantity, 1); assert.equal(p.total_sales, before0.total_sales + 1)
  await rest('DELETE', `audit_log?entity_type=eq.order&entity_id=eq.${id}`, undefined, 'return=minimal')
  await rest('PATCH', `products?id=eq.${product.id}`, { total_sales: before0.total_sales })
})

test('released hold, stock sold meanwhile, then admin sets completed: reduced anyway (goes negative) and an oversell note is written', { skip }, async () => {
  await setStock(1)
  const id = await newOrder({ qty: 1 })
  await rpc('order_hold_stock', { p_order_id: id })
  await rest('PATCH', `orders?id=eq.${id}`, { status: 'cancelled' })
  assert.equal(await rpc('order_release_stock', { p_order_id: id }), true) // admin cancel
  await setStock(0) // the unit was sold to someone else
  await rest('PATCH', `orders?id=eq.${id}`, { status: 'completed' })
  assert.equal(await rpc('order_convert_hold', { p_order_id: id, p_always: false }), true)
  const p = await getProduct()
  assert.equal(p.stock_quantity, -1); assert.equal(p.stock_status, 'outofstock')
  const notes = await notesOf(id)
  assert.equal(notes.filter((c) => c.includes('超賣') && c.includes(`商品 #${product.id}`) && c.includes('庫存 -1')).length, 1)
  assert.equal(await rpc('order_convert_hold', { p_order_id: id, p_always: false }), false)
  assert.equal((await getProduct()).stock_quantity, -1)
})

test('orders that never held stock (e.g. imported) are untouched by a status change to processing', { skip }, async () => {
  await setStock(5)
  const id = await newOrder()
  await rest('PATCH', `orders?id=eq.${id}`, { status: 'processing' })
  assert.equal(await rpc('order_convert_hold', { p_order_id: id, p_always: false }), false)
  assert.equal((await getProduct()).stock_quantity, 5)
})
