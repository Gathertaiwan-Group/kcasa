/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * WooCommerce-like cart stored in site_kcasa.carts / cart_items, keyed by an opaque cookie.
 * Prices are always recomputed from the catalogue (never trusted from the browser).
 */
import { cookies } from 'next/headers'
import { svc } from './sb'
import { getSite, img, productLink, type Product, type Site, type Variation, type QtyRule } from './site'
import { num, randomToken, wpEncodePath } from './util'

export const CART_COOKIE = 'kc_cart'

export type Line = {
  id: number
  product: Product
  variation: Variation | null
  quantity: number
  attributes: Record<string, string>
  name: string
  link: string
  image: string | null
  regularUnit: number
  unit: number
  lineSubtotal: number
  discountNote: string | null
}
export type ShipOpt = { id: string; method_id: string; instance: number; label: string; cost: number }
export type CouponApplied = { code: string; amount: number; free_shipping: boolean; row: any }
export type CartView = {
  key: string | null
  cartId: string | null
  lines: Line[]
  count: number
  subtotal: number
  coupons: CouponApplied[]
  discount: number
  shipping: ShipOpt[]
  chosenShipping: ShipOpt | null
  shippingTotal: number
  total: number
  errors: string[]
}

export async function cartKey(): Promise<string | null> {
  const c = (await cookies()).get(CART_COOKIE)?.value
  return c && /^[a-f0-9]{48}$/.test(c) ? c : null
}

export async function ensureCart(): Promise<{ key: string; id: string }> {
  const store = await cookies()
  let key = await cartKey()
  const db = svc()
  if (key) {
    const { data } = await db.from('carts').select('id').eq('session_key', key).maybeSingle()
    if (data) return { key, id: data.id }
  }
  key = randomToken(24)
  const { data, error } = await db.from('carts').insert({ session_key: key }).select('id').single()
  if (error) throw new Error(error.message)
  store.set(CART_COOKIE, key, { path: '/', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 60 * 60 * 24 * 14 })
  return { key, id: data.id }
}

export function unitPrice(p: Product, v: Variation | null): { regular: number; price: number } {
  const src: any = v || p
  const price = num(src.price) ?? num(src.sale_price) ?? num(src.regular_price) ?? 0
  const regular = num(src.regular_price) ?? price
  return { regular, price }
}

export function purchasable(p: Product, v: Variation | null): boolean {
  if (p.status !== 'publish' || !p.purchasable) return false
  if (p.type === 'variable') {
    if (!v || v.status !== 'publish' || !v.purchasable) return false
    return num(v.price) !== null && v.stock_status !== 'outofstock'
  }
  return num(p.price) !== null && p.stock_status !== 'outofstock'
}

function ruleApplies(site: Site, r: QtyRule, p: Product, qty: number): boolean {
  const now = Date.now()
  if (r.starts_at && new Date(r.starts_at).getTime() > now) return false
  if (r.ends_at && new Date(r.ends_at).getTime() < now) return false
  if (qty < r.min_qty || (r.max_qty && qty > r.max_qty)) return false
  if (r.applies_to === 'products') return (r.product_ids || []).map(Number).includes(Number(p.id))
  if (r.applies_to === 'categories') {
    const cats = site.objTerms.get(`product:${p.id}`) || []
    return (r.category_ids || []).map(Number).some((c) => cats.includes(c))
  }
  return true
}

/** quantity-discount rules that can apply to a product (for the product page table) */
export function rulesFor(site: Site, p: Product): QtyRule[] {
  return site.qtyRules
    .filter((r) => {
      if (r.applies_to === 'products') return (r.product_ids || []).map(Number).includes(Number(p.id))
      if (r.applies_to === 'categories') {
        const cats = site.objTerms.get(`product:${p.id}`) || []
        return (r.category_ids || []).map(Number).some((c) => cats.includes(c))
      }
      return true
    })
    .sort((a, b) => a.min_qty - b.min_qty)
}

export function discountedUnit(r: QtyRule, unit: number): number {
  const a = Number(r.amount)
  if (r.discount_type === 'percent') return Math.max(0, Math.round(unit * (1 - a / 100)))
  if (r.discount_type === 'fixed_per_item') return Math.max(0, unit - a)
  if (r.discount_type === 'fixed_price') return Math.max(0, a)
  return unit
}

function bestRule(site: Site, p: Product, qty: number, unit: number): { unit: number; rule: QtyRule | null } {
  let best = { unit, rule: null as QtyRule | null }
  for (const r of site.qtyRules) {
    if (!ruleApplies(site, r, p, qty)) continue
    const u = discountedUnit(r, unit)
    if (u < best.unit) best = { unit: u, rule: r }
  }
  return best
}

export function shippingOptions(site: Site): ShipOpt[] {
  return site.shipping.map((m) => ({ id: `${m.method_id}:${m.id}`, method_id: m.method_id, instance: Number(m.id), label: m.title, cost: Number(m.cost) || 0 }))
}

async function couponRow(code: string): Promise<any | null> {
  const { data } = await svc().from('coupons').select('*').ilike('code', code.replace(/[%_]/g, '')).eq('status', 'publish').limit(1).maybeSingle()
  return data || null
}

export function couponError(row: any, subtotal: number, email?: string): string | null {
  if (!row) return '優惠券不存在！'
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return '此折價券已經過期。'
  if (row.usage_limit && row.usage_count >= row.usage_limit) return '優惠券已達使用限制。'
  if (row.minimum_amount && subtotal < Number(row.minimum_amount)) return `此優惠券的最低消費金額為 NT$${Number(row.minimum_amount).toLocaleString('en-US')}。`
  if (row.maximum_amount && subtotal > Number(row.maximum_amount)) return `此優惠券的最高消費金額為 NT$${Number(row.maximum_amount).toLocaleString('en-US')}。`
  if (email && row.email_restrictions?.length && !row.email_restrictions.map((e: string) => e.toLowerCase()).includes(email.toLowerCase())) return '此優惠券不適用於您的帳號。'
  return null
}

export async function loadCart(opts: { key?: string | null; email?: string } = {}): Promise<CartView> {
  const site = await getSite()
  const key = opts.key === undefined ? await cartKey() : opts.key
  const empty: CartView = { key, cartId: null, lines: [], count: 0, subtotal: 0, coupons: [], discount: 0, shipping: shippingOptions(site), chosenShipping: null, shippingTotal: 0, total: 0, errors: [] }
  if (!key) return finish(empty)
  const db = svc()
  const { data: cart } = await db.from('carts').select('id,coupon_codes,shipping_method').eq('session_key', key).maybeSingle()
  if (!cart) return finish(empty)
  const { data: items } = await db.from('cart_items').select('id,product_id,variation_id,quantity,attributes').eq('cart_id', cart.id).order('id')
  const view: CartView = { ...empty, cartId: cart.id }
  for (const it of items || []) {
    const p = site.productById.get(Number(it.product_id))
    if (!p) continue
    const v = it.variation_id ? site.variationById.get(Number(it.variation_id)) || null : null
    if (!purchasable(p, v)) {
      view.errors.push(`「${p.name}」已無法購買，已從購物車中移除。`)
      await db.from('cart_items').delete().eq('id', it.id)
      continue
    }
    const { regular, price } = unitPrice(p, v)
    const qd = bestRule(site, p, it.quantity, price)
    const attrs = (it.attributes || {}) as Record<string, string>
    const m = img(site, v?.image_id || p.featured_media_id)
    view.lines.push({
      id: it.id,
      product: p,
      variation: v,
      quantity: it.quantity,
      attributes: attrs,
      name: p.name,
      link: productLink(p),
      image: m?.url || null,
      regularUnit: regular,
      unit: qd.unit,
      lineSubtotal: qd.unit * it.quantity,
      discountNote: qd.rule ? qd.rule.title : null,
    })
  }
  view.count = view.lines.reduce((a, l) => a + l.quantity, 0)
  view.subtotal = view.lines.reduce((a, l) => a + l.lineSubtotal, 0)
  for (const code of cart.coupon_codes || []) {
    const row = await couponRow(code)
    const err = couponError(row, view.subtotal, opts.email)
    if (err) {
      view.errors.push(err)
      continue
    }
    let amount = 0
    const a = Number(row.amount) || 0
    if (row.discount_type === 'percent') amount = Math.round(view.subtotal * Math.min(100, a) / 100)
    else if (row.discount_type === 'fixed_cart') amount = a
    else if (row.discount_type === 'fixed_product') {
      const ids = (row.product_ids || []).map(Number)
      amount = view.lines.filter((l) => !ids.length || ids.includes(Number(l.product.id))).reduce((s, l) => s + a * l.quantity, 0)
    }
    amount = Math.min(amount, view.subtotal - view.discount)
    view.coupons.push({ code: row.code, amount, free_shipping: !!row.free_shipping, row })
    view.discount += amount
  }
  const chosen = view.shipping.find((s) => s.id === cart.shipping_method) || view.shipping[0] || null
  view.chosenShipping = chosen
  return finish(view)
}

function finish(v: CartView): CartView {
  const free = v.coupons.some((c) => c.free_shipping)
  v.shippingTotal = v.lines.length && v.chosenShipping && !free ? v.chosenShipping.cost : 0
  v.total = Math.max(0, v.subtotal - v.discount) + v.shippingTotal
  if (!v.lines.length) v.chosenShipping = v.chosenShipping || v.shipping[0] || null
  return v
}

export async function addToCart(productId: number, variationId: number | null, qty: number, attributes: Record<string, string>): Promise<{ ok: boolean; error?: string; product?: Product }> {
  const site = await getSite()
  const p = site.productById.get(productId)
  if (!p) return { ok: false, error: '找不到此商品。' }
  let v: Variation | null = null
  if (p.type === 'variable') {
    if (variationId) v = site.variationById.get(variationId) || null
    if (!v) {
      // resolve from attributes
      const vars = site.variations.get(p.id) || []
      v =
        vars.find((x) =>
          (x.attributes || []).every((a) => {
            const want = attributes[`attribute_${attrKey(site, p.id, a.name)}`] ?? attributes[a.name]
            return a.value === null || a.value === '' || (want !== undefined && decodeSafe(want) === decodeSafe(a.value))
          }),
        ) || null
    }
    if (!v || Number(v.product_id) !== p.id) return { ok: false, error: '請選擇商品選項…' }
  }
  if (!purchasable(p, v)) return { ok: false, error: `抱歉，「${p.name}」目前無法購買。` }
  qty = Math.max(1, Math.floor(qty || 1))
  const src: any = v || p
  if (src.manage_stock && src.stock_quantity !== null && src.backorders === 'no' && qty > src.stock_quantity) {
    return { ok: false, error: `您無法將該數量加入購物車 — 我們只有 ${src.stock_quantity} 件庫存。` }
  }
  const { id: cartId } = await ensureCart()
  const db = svc()
  const q = db.from('cart_items').select('id,quantity').eq('cart_id', cartId).eq('product_id', p.id)
  const { data: existing } = await (v ? q.eq('variation_id', v.id) : q.is('variation_id', null)).maybeSingle()
  const { price } = unitPrice(p, v)
  if (existing) {
    const nq = p.sold_individually ? 1 : existing.quantity + qty
    if (src.manage_stock && src.stock_quantity !== null && src.backorders === 'no' && nq > src.stock_quantity) {
      return { ok: false, error: `您無法將該數量加入購物車 — 我們只有 ${src.stock_quantity} 件庫存，而您的購物車中已有 ${existing.quantity} 件。` }
    }
    await db.from('cart_items').update({ quantity: nq, unit_price: price, updated_at: new Date().toISOString() }).eq('id', existing.id)
  } else {
    const attrs: Record<string, string> = {}
    for (const a of v?.attributes || []) attrs[a.name] = decodeSafe(a.value ?? attributes[`attribute_${attrKey(site, p.id, a.name)}`] ?? '')
    await db.from('cart_items').insert({ cart_id: cartId, product_id: p.id, variation_id: v?.id ?? null, quantity: p.sold_individually ? 1 : qty, attributes: attrs, unit_price: price })
  }
  await db.from('carts').update({ updated_at: new Date().toISOString(), expires_at: new Date(Date.now() + 14 * 864e5).toISOString() }).eq('id', cartId)
  return { ok: true, product: p }
}

export function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** form field key (without "attribute_") for a product attribute, as WooCommerce prints it:
 *  taxonomy attributes → pa_<slug>, custom attributes → sanitize_title(name); both %-encoded lower-case */
export function attrKey(site: Site, productId: number, name: string): string {
  const av = (site.attrValues.get(productId) || []).find((a) => a.name === name)
  const tax = av?.attribute_id ? site.attributes.find((x) => Number(x.id) === Number(av.attribute_id)) : null
  if (tax) return 'pa_' + wpEncodePath(tax.slug.toLowerCase())
  return wpEncodePath(name.trim().toLowerCase().replace(/\s+/g, '-'))
}

export async function setQuantities(qtys: Record<number, number>) {
  const key = await cartKey()
  if (!key) return
  const db = svc()
  const { data: cart } = await db.from('carts').select('id').eq('session_key', key).maybeSingle()
  if (!cart) return
  for (const [id, q] of Object.entries(qtys)) {
    if (q <= 0) await db.from('cart_items').delete().eq('id', Number(id)).eq('cart_id', cart.id)
    else await db.from('cart_items').update({ quantity: Math.floor(q), updated_at: new Date().toISOString() }).eq('id', Number(id)).eq('cart_id', cart.id)
  }
}

export async function removeItem(itemId: number): Promise<string | null> {
  const key = await cartKey()
  if (!key) return null
  const db = svc()
  const { data: cart } = await db.from('carts').select('id').eq('session_key', key).maybeSingle()
  if (!cart) return null
  const { data } = await db.from('cart_items').delete().eq('id', itemId).eq('cart_id', cart.id).select('product_id')
  const site = await getSite()
  const p = data?.[0] ? site.productById.get(Number(data[0].product_id)) : null
  return p ? p.name : null
}

export async function updateCartMeta(patch: { coupon_codes?: string[]; shipping_method?: string }) {
  const { id } = await ensureCart()
  await svc().from('carts').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
}

export async function applyCoupon(code: string): Promise<string | null> {
  code = code.trim()
  if (!code) return '請輸入優惠券代碼。'
  const cart = await loadCart()
  const row = await couponRow(code)
  const err = couponError(row, cart.subtotal)
  if (err) return err
  const codes = cart.coupons.map((c) => c.code)
  if (codes.map((c) => c.toLowerCase()).includes(String(row.code).toLowerCase())) return '已套用優惠券代碼！'
  const next = row.individual_use ? [row.code] : [...codes, row.code]
  await updateCartMeta({ coupon_codes: next })
  return null
}

export async function clearCart(cartId: string) {
  await svc().from('cart_items').delete().eq('cart_id', cartId)
  await svc().from('carts').update({ coupon_codes: [] }).eq('id', cartId)
}
