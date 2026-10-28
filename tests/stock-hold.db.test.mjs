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
async function newOrder({ ip = `198.51.100.${++ipSeq}`, email = `${TAG}-${ipSeq}@example.invalid`, qty = 1, method = NP } = {}) {
  const [o] = await rest('POST', 'orders', { status: 'pending', currency: 'TWD', payment_method: method, payment_method_title: 'test', billing: { email }, total: 100, customer_ip: ip, created_via: 'checkout', meta: { kc_db_test: TAG } })
  await rest('POST', 'order_items', { order_id: o.id, item_type: 'line_item', name: 'kc db test', product_id: product.id, quantity: qty, subtotal: 100, total: 100 })
  return o.id
}
const getOrder = async (id) => (await rest('GET', `orders?id=eq.${id}&select=status,meta,transaction_id`))[0]

before(async () => {
  if (!enabled) return
  ;[product] = await rest('POST', 'products', { name: `KC DB TEST ${TAG}`, slug: TAG, type: 'simple', status: 'private', manage_stock: true, stock_quantity: 1, backorders: 'no', stock_status: 'instock', regular_price: 100, price: 100 })
})
after(async () => {
  if (!enabled) return
  await rest('DELETE', `orders?meta->>kc_db_test=eq.${TAG}`, undefined, 'return=minimal') // items / holds / attempts cascade
  if (product) await rest('DELETE', `products?id=eq.${product.id}`, undefined, 'return=minimal')
  const left = await rest('GET', `orders?meta->>kc_db_test=eq.${TAG}&select=id`)
  assert.equal(left.length, 0)
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
