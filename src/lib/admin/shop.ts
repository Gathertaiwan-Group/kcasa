/* eslint-disable @typescript-eslint/no-explicit-any */
/** WooCommerce data: products, variations, attributes, prices/stock, orders, customers, coupons, quantity discounts. */
import { svc } from '../sb'
import { setObjectTerms, termIdsByName, upsertRedirectRaw } from './content'
import { audit, diff, must, normSlug, nowIso, numOrNull, OpError, pick, touched, wpSlug, type Actor } from './core'

export const PRODUCT_STATUSES = ['publish', 'draft', 'pending', 'private', 'trash'] as const
export const STOCK_STATUSES = ['instock', 'outofstock', 'onbackorder'] as const
export const ORDER_STATUSES: Record<string, string> = {
  pending: '等待付款中',
  processing: '處理中',
  'on-hold': '保留',
  completed: '已完成',
  cancelled: '已取消',
  refunded: '已退款',
  failed: '失敗',
  'checkout-draft': '草稿',
  trash: '垃圾桶',
}

const PRODUCT_FIELDS = [
  'name', 'slug', 'type', 'status', 'featured', 'catalog_visibility', 'sku', 'description_html', 'short_description_html',
  'regular_price', 'sale_price', 'sale_starts_at', 'sale_ends_at', 'tax_status', 'tax_class', 'manage_stock', 'stock_quantity',
  'stock_status', 'backorders', 'low_stock_amount', 'sold_individually', 'min_purchase_qty', 'max_purchase_qty', 'purchasable',
  'weight', 'length', 'width', 'height', 'shipping_class', 'featured_media_id', 'gallery_media_ids', 'menu_order', 'reviews_allowed',
  'external_url', 'button_text', 'upsell_ids', 'cross_sell_ids', 'seo', 'meta', 'published_at',
] as const
const VARIATION_FIELDS = ['sku', 'attributes', 'description_html', 'status', 'regular_price', 'sale_price', 'sale_starts_at', 'sale_ends_at', 'manage_stock', 'stock_quantity', 'stock_status', 'backorders', 'weight', 'length', 'width', 'height', 'image_id', 'menu_order', 'purchasable', 'meta'] as const

// ---------------------------------------------------------------- products
export async function listProducts(o: { status?: string; search?: string; category_id?: number; stock_status?: string; limit?: number; offset?: number }) {
  let q = svc().from('products').select('id,name,slug,type,status,sku,price,regular_price,sale_price,price_min,price_max,stock_status,stock_quantity,manage_stock,featured_media_id,modified_at,featured', { count: 'exact' })
  if (o.status && o.status !== 'all') q = q.eq('status', o.status)
  else q = q.neq('status', 'trash')
  if (o.stock_status) q = q.eq('stock_status', o.stock_status)
  if (o.search) {
    const s = o.search.replace(/[%,()]/g, ' ')
    q = q.or(`name.ilike.%${s}%,sku.ilike.%${s}%`)
  }
  if (o.category_id) {
    const rel = must(await svc().from('term_relationships').select('object_id').eq('object_type', 'product').eq('term_id', o.category_id), 'rels') as any[]
    q = q.in('id', rel.length ? rel.map((x) => x.object_id) : [-1])
  }
  const limit = Math.min(Math.max(o.limit || 50, 1), 500)
  const offset = Math.max(o.offset || 0, 0)
  const r = await q.order('menu_order').order('id', { ascending: false }).range(offset, offset + limit - 1)
  return { rows: must(r, 'products') as any[], total: r.count || 0 }
}

export async function getProduct(id: number) {
  const p = must(await svc().from('products').select('*').eq('id', id).maybeSingle(), 'products') as any
  if (!p) throw new OpError(`product ${id} not found`, 404)
  const [vars, attrs, rels] = await Promise.all([
    svc().from('product_variations').select('*').eq('product_id', id).order('menu_order').order('id'),
    svc().from('product_attribute_values').select('*').eq('product_id', id).order('position'),
    svc().from('term_relationships').select('term_id').eq('object_type', 'product').eq('object_id', id),
  ])
  p.variations = must(vars, 'variations')
  p.attributes = must(attrs, 'attributes')
  p.term_ids = (must(rels, 'rels') as any[]).map((x) => Number(x.term_id))
  return p
}

function saleActive(x: any, now = Date.now()) {
  if (x.sale_price === null || x.sale_price === undefined || x.sale_price === '') return false
  if (x.sale_starts_at && new Date(x.sale_starts_at).getTime() > now) return false
  if (x.sale_ends_at && new Date(x.sale_ends_at).getTime() <= now) return false
  return true
}

function effectivePrice(x: any): number | null {
  const reg = numOrNull(x.regular_price)
  return saleActive(x) ? numOrNull(x.sale_price) : reg
}

function autoStockStatus(x: any): string | undefined {
  if (!x.manage_stock || x.stock_quantity === null || x.stock_quantity === undefined) return undefined
  if (Number(x.stock_quantity) > 0) return 'instock'
  return x.backorders && x.backorders !== 'no' ? 'onbackorder' : 'outofstock'
}

/** recompute price / price_min / price_max (and variable-product stock status) like WC_Product_Data_Store */
export async function syncProduct(id: number) {
  const p = (await svc().from('products').select('*').eq('id', id).maybeSingle()).data as any
  if (!p) return
  const patch: Record<string, any> = {}
  if (p.type === 'variable') {
    const vars = (must(await svc().from('product_variations').select('*').eq('product_id', id), 'variations') as any[]).filter((v) => v.status === 'publish')
    const prices = vars.map(effectivePrice).filter((n): n is number => n !== null)
    patch.price_min = prices.length ? Math.min(...prices) : null
    patch.price_max = prices.length ? Math.max(...prices) : null
    patch.price = patch.price_min
    if (!p.manage_stock) patch.stock_status = vars.some((v) => v.stock_status === 'instock') ? 'instock' : vars.some((v) => v.stock_status === 'onbackorder') ? 'onbackorder' : vars.length ? 'outofstock' : p.stock_status
  } else {
    patch.price = effectivePrice(p)
    patch.price_min = patch.price
    patch.price_max = patch.price
  }
  const changed = Object.keys(patch).some((k) => String(p[k] ?? '') !== String(patch[k] ?? ''))
  if (changed) await svc().from('products').update(patch).eq('id', id)
}

export type ProductInput = Record<string, any> & { category_ids?: number[]; tag_ids?: number[]; tag_names?: string[] }

function cleanProductPatch(input: ProductInput) {
  const patch: Record<string, any> = pick(input, PRODUCT_FIELDS)
  for (const k of ['regular_price', 'sale_price', 'weight', 'length', 'width', 'height']) if (k in patch) patch[k] = numOrNull(patch[k])
  for (const k of ['stock_quantity', 'low_stock_amount', 'max_purchase_qty']) if (k in patch) patch[k] = patch[k] === null || patch[k] === '' ? null : Math.trunc(Number(patch[k]))
  if (patch.status && !PRODUCT_STATUSES.includes(patch.status)) throw new OpError(`bad status ${patch.status}`)
  if (patch.stock_status && !STOCK_STATUSES.includes(patch.stock_status)) throw new OpError(`bad stock_status ${patch.stock_status}`)
  if (patch.regular_price !== undefined && patch.regular_price !== null && patch.regular_price < 0) throw new OpError('price must be ≥ 0')
  return patch
}

async function uniqueProductSlug(slug: string, excludeId?: number) {
  let c = slug
  for (let i = 2; i < 200; i++) {
    let q = svc().from('products').select('id').eq('slug', c)
    if (excludeId) q = q.neq('id', excludeId)
    const { data } = await q.limit(1)
    if (!data || !data.length) return c
    c = `${slug}-${i}`
  }
  throw new OpError('no free slug')
}

async function setProductTerms(id: number, input: ProductInput, actor: Actor) {
  if (input.category_ids) await setObjectTerms('product', id, 'product_cat', input.category_ids)
  let tags = input.tag_ids
  if (input.tag_names) tags = [...(tags || []), ...(await termIdsByName('product_tag', input.tag_names, actor))]
  if (tags) await setObjectTerms('product', id, 'product_tag', tags)
}

export async function createProduct(actor: Actor, input: ProductInput) {
  if (!input.name) throw new OpError('name is required')
  const patch = cleanProductPatch(input)
  const slug = await uniqueProductSlug(normSlug(input.slug || '') || wpSlug(input.name))
  const row: Record<string, any> = { type: 'simple', status: 'draft', ...patch, slug, path: `/product/${slug}/`, modified_at: nowIso() }
  if (row.status === 'publish' && !row.published_at) row.published_at = nowIso()
  const auto = autoStockStatus(row)
  if (auto) row.stock_status = auto
  const p = must(await svc().from('products').insert(row).select('*').single(), 'products insert') as any
  await setProductTerms(p.id, input, actor)
  await syncProduct(p.id)
  await audit(actor, 'product.create', 'product', p.id, null, row)
  await touched()
  return getProduct(p.id)
}

export async function updateProduct(actor: Actor, id: number, input: ProductInput) {
  const before = await getProduct(id)
  const patch = cleanProductPatch(input)
  if (patch.slug !== undefined) {
    patch.slug = await uniqueProductSlug(normSlug(patch.slug) || before.slug, id)
    if (patch.slug !== before.slug) {
      patch.path = `/product/${patch.slug}/`
      if (before.status === 'publish') await upsertRedirectRaw(before.path || `/product/${before.slug}/`, patch.path, 'auto')
    }
  }
  if (patch.seo && !input.replace_seo) patch.seo = { ...(before.seo || {}), ...patch.seo }
  if (patch.meta) patch.meta = { ...(before.meta || {}), ...patch.meta }
  if (patch.status === 'publish' && !before.published_at && !patch.published_at) patch.published_at = nowIso()
  // like WooCommerce: when stock is managed, the status follows the quantity
  const auto = autoStockStatus({ ...before, ...patch })
  if (auto) patch.stock_status = auto
  patch.modified_at = nowIso()
  must(await svc().from('products').update(patch).eq('id', id), 'products update')
  await setProductTerms(id, input, actor)
  await syncProduct(id)
  const after = await getProduct(id)
  const d = diff(before, patch)
  if (input.category_ids || input.tag_ids || input.tag_names) d.after.term_ids = after.term_ids
  await audit(actor, 'product.update', 'product', id, d.before, d.after)
  await touched()
  return after
}

export async function deleteProduct(actor: Actor, id: number, force = false) {
  const before = await getProduct(id)
  if (!force) {
    must(await svc().from('products').update({ status: 'trash', meta: { ...(before.meta || {}), _wp_trash_meta_status: before.status }, modified_at: nowIso() }).eq('id', id), 'products trash')
    await audit(actor, 'product.trash', 'product', id, { status: before.status }, { status: 'trash' })
    await touched()
    return { id, trashed: true }
  }
  await svc().from('term_relationships').delete().eq('object_type', 'product').eq('object_id', id)
  must(await svc().from('products').delete().eq('id', id), 'products delete')
  await audit(actor, 'product.delete', 'product', id, { ...before, description_html: undefined }, null)
  await touched()
  return { id, deleted: true }
}

export async function restoreProduct(actor: Actor, id: number) {
  const before = await getProduct(id)
  const status = before.meta?._wp_trash_meta_status && before.meta._wp_trash_meta_status !== 'trash' ? before.meta._wp_trash_meta_status : 'draft'
  const meta = { ...(before.meta || {}) }
  delete meta._wp_trash_meta_status
  must(await svc().from('products').update({ status, meta, modified_at: nowIso() }).eq('id', id), 'products restore')
  await audit(actor, 'product.restore', 'product', id, { status: 'trash' }, { status })
  await touched()
  return { id, status }
}

// ---------------------------------------------------------------- variations & attributes
export async function createVariation(actor: Actor, productId: number, input: Record<string, any>) {
  const p = await getProduct(productId)
  if (p.type !== 'variable') throw new OpError('only variable products have variations')
  const patch: Record<string, any> = pick(input, VARIATION_FIELDS)
  for (const k of ['regular_price', 'sale_price']) if (k in patch) patch[k] = numOrNull(patch[k])
  const row: Record<string, any> = { status: 'publish', attributes: [], ...patch, product_id: productId, menu_order: patch.menu_order ?? p.variations.length }
  row.price = effectivePrice(row)
  const auto = autoStockStatus(row)
  if (auto) row.stock_status = auto
  const v = must(await svc().from('product_variations').insert(row).select('*').single(), 'variation insert') as any
  await syncProduct(productId)
  await audit(actor, 'variation.create', 'product_variation', v.id, null, row)
  await touched()
  return v
}

export async function updateVariation(actor: Actor, id: number, input: Record<string, any>) {
  const before = must(await svc().from('product_variations').select('*').eq('id', id).maybeSingle(), 'variation') as any
  if (!before) throw new OpError(`variation ${id} not found`, 404)
  const patch: Record<string, any> = pick(input, VARIATION_FIELDS)
  for (const k of ['regular_price', 'sale_price']) if (k in patch) patch[k] = numOrNull(patch[k])
  if ('stock_quantity' in patch) patch.stock_quantity = patch.stock_quantity === null || patch.stock_quantity === '' ? null : Math.trunc(Number(patch.stock_quantity))
  if (patch.stock_status && !STOCK_STATUSES.includes(patch.stock_status)) throw new OpError(`bad stock_status ${patch.stock_status}`)
  const merged = { ...before, ...patch }
  patch.price = effectivePrice(merged)
  const auto = autoStockStatus(merged)
  if (auto) patch.stock_status = auto
  const v = must(await svc().from('product_variations').update(patch).eq('id', id).select('*').single(), 'variation update')
  await syncProduct(before.product_id)
  const d = diff(before, patch)
  await audit(actor, 'variation.update', 'product_variation', id, d.before, d.after)
  await touched()
  return v
}

export async function deleteVariation(actor: Actor, id: number) {
  const before = must(await svc().from('product_variations').select('*').eq('id', id).maybeSingle(), 'variation') as any
  if (!before) throw new OpError(`variation ${id} not found`, 404)
  must(await svc().from('product_variations').delete().eq('id', id), 'variation delete')
  await syncProduct(before.product_id)
  await audit(actor, 'variation.delete', 'product_variation', id, before, null)
  await touched()
  return { id, deleted: true }
}

export async function upsertAttributeValue(actor: Actor, productId: number, input: { id?: number; name: string; options: string[]; visible?: boolean; used_for_variations?: boolean; position?: number; attribute_id?: number | null }) {
  if (!input.name) throw new OpError('attribute name required')
  const row: Record<string, any> = { product_id: productId, name: input.name, options: input.options || [], visible: input.visible ?? true, used_for_variations: input.used_for_variations ?? false, position: input.position ?? 0 }
  if (input.attribute_id !== undefined) row.attribute_id = input.attribute_id
  let before: any = null
  let saved: any
  if (input.id) {
    before = (await svc().from('product_attribute_values').select('*').eq('id', input.id).maybeSingle()).data
    saved = must(await svc().from('product_attribute_values').update(row).eq('id', input.id).eq('product_id', productId).select('*').single(), 'attr update')
  } else {
    saved = must(await svc().from('product_attribute_values').insert(row).select('*').single(), 'attr insert')
  }
  await audit(actor, input.id ? 'attribute.update' : 'attribute.create', 'product_attribute', saved.id, before, row)
  await touched()
  return saved
}

export async function deleteAttributeValue(actor: Actor, id: number) {
  const before = (await svc().from('product_attribute_values').select('*').eq('id', id).maybeSingle()).data
  must(await svc().from('product_attribute_values').delete().eq('id', id), 'attr delete')
  await audit(actor, 'attribute.delete', 'product_attribute', id, before, null)
  await touched()
  return { id, deleted: true }
}

// ---------------------------------------------------------------- price & stock shortcuts
export async function setPrice(actor: Actor, o: { product_id: number; variation_id?: number; regular_price?: number | null; sale_price?: number | null; sale_starts_at?: string | null; sale_ends_at?: string | null }) {
  const patch = pick(o as any, ['regular_price', 'sale_price', 'sale_starts_at', 'sale_ends_at'])
  if (!Object.keys(patch).length) throw new OpError('nothing to change')
  if (o.variation_id) return updateVariation(actor, o.variation_id, patch)
  return updateProduct(actor, o.product_id, patch)
}

export async function adjustStock(actor: Actor, o: { product_id: number; variation_id?: number; set?: number; delta?: number; stock_status?: string; manage_stock?: boolean }) {
  const table = o.variation_id ? 'product_variations' : 'products'
  const id = o.variation_id || o.product_id
  const cur = must(await svc().from(table).select('stock_quantity,manage_stock,stock_status,backorders').eq('id', id).maybeSingle(), table) as any
  if (!cur) throw new OpError(`${table} ${id} not found`, 404)
  const patch: Record<string, any> = {}
  if (o.set !== undefined && o.set !== null) {
    patch.stock_quantity = Math.trunc(o.set)
    patch.manage_stock = true
  } else if (o.delta) {
    patch.stock_quantity = Math.trunc(Number(cur.stock_quantity || 0) + o.delta)
    patch.manage_stock = true
  }
  if (o.manage_stock !== undefined) patch.manage_stock = o.manage_stock
  if (o.stock_status) patch.stock_status = o.stock_status
  if (o.variation_id) return updateVariation(actor, o.variation_id, patch)
  return updateProduct(actor, o.product_id, patch)
}

// ---------------------------------------------------------------- orders
export async function listOrders(o: { status?: string; search?: string; customer_id?: number; limit?: number; offset?: number }) {
  let q = svc().from('orders').select('id,order_number,status,total,currency,billing,payment_method_title,created_at,customer_id', { count: 'exact' })
  if (o.status && o.status !== 'all') q = q.eq('status', o.status)
  else q = q.neq('status', 'trash')
  if (o.customer_id) q = q.eq('customer_id', o.customer_id)
  if (o.search) {
    const s = o.search.replace(/[%,()]/g, ' ').trim()
    if (/^\d+$/.test(s)) q = q.or(`id.eq.${s},order_number.eq.${s}`)
    else q = q.or(`billing->>email.ilike.%${s}%,billing->>first_name.ilike.%${s}%,billing->>last_name.ilike.%${s}%,billing->>phone.ilike.%${s}%`)
  }
  const limit = Math.min(Math.max(o.limit || 50, 1), 500)
  const offset = Math.max(o.offset || 0, 0)
  const r = await q.order('created_at', { ascending: false }).range(offset, offset + limit - 1)
  return { rows: must(r, 'orders') as any[], total: r.count || 0 }
}

export async function orderStatusCounts() {
  const r = await svc().from('orders').select('status')
  const out: Record<string, number> = {}
  for (const x of must(r, 'orders') as any[]) out[x.status] = (out[x.status] || 0) + 1
  return out
}

export async function getOrder(id: number) {
  const o = must(await svc().from('orders').select('*').eq('id', id).maybeSingle(), 'orders') as any
  if (!o) throw new OpError(`order ${id} not found`, 404)
  const [items, notes, refunds] = await Promise.all([
    svc().from('order_items').select('*').eq('order_id', id).order('id'),
    svc().from('order_notes').select('*').eq('order_id', id).order('created_at', { ascending: false }),
    svc().from('order_refunds').select('*').eq('order_id', id).order('created_at'),
  ])
  o.items = must(items, 'order_items')
  o.notes = must(notes, 'order_notes')
  o.refunds = must(refunds, 'order_refunds')
  if (o.customer_id) o.customer = (await svc().from('customers').select('id,email,display_name,first_name,last_name').eq('id', o.customer_id).maybeSingle()).data
  return o
}

export async function addOrderNote(actor: Actor, orderId: number, content: string, isCustomerNote = false) {
  if (!content.trim()) throw new OpError('note is empty')
  const n = must(await svc().from('order_notes').insert({ order_id: orderId, content, is_customer_note: isCustomerNote, added_by: actor.email }).select('*').single(), 'note insert')
  await audit(actor, 'order.note', 'order', orderId, null, { content, is_customer_note: isCustomerNote })
  return n
}

export async function updateOrderStatus(actor: Actor, id: number, status: string, note?: string) {
  if (!ORDER_STATUSES[status]) throw new OpError(`bad order status ${status}`)
  const before = await getOrder(id)
  if (before.status === status && !note) return before
  const patch: Record<string, any> = { status }
  if ((status === 'processing' || status === 'completed') && !before.paid_at) patch.paid_at = nowIso()
  if (status === 'completed' && !before.completed_at) patch.completed_at = nowIso()
  must(await svc().from('orders').update(patch).eq('id', id), 'order update')
  if (before.status !== status) {
    await svc().from('order_notes').insert({ order_id: id, content: `訂單狀態已從「${ORDER_STATUSES[before.status] || before.status}」變更為「${ORDER_STATUSES[status]}」。${note ? ' ' + note : ''}`, is_customer_note: false, added_by: actor.email })
  } else if (note) {
    await svc().from('order_notes').insert({ order_id: id, content: note, is_customer_note: false, added_by: actor.email })
  }
  await audit(actor, 'order.status', 'order', id, { status: before.status }, { ...patch, note: note || undefined })
  return getOrder(id)
}

export async function updateOrderAddresses(actor: Actor, id: number, o: { billing?: Record<string, string>; shipping?: Record<string, string>; customer_note?: string }) {
  const before = await getOrder(id)
  const patch: Record<string, any> = {}
  if (o.billing) patch.billing = { ...(before.billing || {}), ...o.billing }
  if (o.shipping) patch.shipping = { ...(before.shipping || {}), ...o.shipping }
  if (o.customer_note !== undefined) patch.customer_note = o.customer_note
  must(await svc().from('orders').update(patch).eq('id', id), 'order update')
  const d = diff(before, patch)
  await audit(actor, 'order.update', 'order', id, d.before, d.after)
  return getOrder(id)
}

// ---------------------------------------------------------------- customers
export async function listCustomers(o: { search?: string; limit?: number; offset?: number }) {
  let q = svc().from('customers').select('id,email,display_name,first_name,last_name,orders_count,total_spent,registered_at,billing', { count: 'exact' })
  if (o.search) {
    const s = o.search.replace(/[%,()]/g, ' ').trim()
    q = q.or(`email.ilike.%${s}%,display_name.ilike.%${s}%,first_name.ilike.%${s}%,last_name.ilike.%${s}%`)
  }
  const limit = Math.min(Math.max(o.limit || 50, 1), 500)
  const offset = Math.max(o.offset || 0, 0)
  const r = await q.order('id', { ascending: false }).range(offset, offset + limit - 1)
  return { rows: must(r, 'customers') as any[], total: r.count || 0 }
}

export async function getCustomer(id: number) {
  const c = must(await svc().from('customers').select('*').eq('id', id).maybeSingle(), 'customers') as any
  if (!c) throw new OpError(`customer ${id} not found`, 404)
  c.orders = (await listOrders({ customer_id: id, limit: 100 })).rows
  return c
}

export async function updateCustomer(actor: Actor, id: number, input: Record<string, any>) {
  const before = await getCustomer(id)
  const patch: Record<string, any> = pick(input, ['first_name', 'last_name', 'display_name', 'email', 'billing', 'shipping', 'meta'])
  if (patch.billing) patch.billing = { ...(before.billing || {}), ...patch.billing }
  if (patch.shipping) patch.shipping = { ...(before.shipping || {}), ...patch.shipping }
  must(await svc().from('customers').update(patch).eq('id', id), 'customer update')
  const d = diff(before, patch)
  await audit(actor, 'customer.update', 'customer', id, d.before, d.after)
  return getCustomer(id)
}

// ---------------------------------------------------------------- coupons
const COUPON_FIELDS = ['code', 'description', 'status', 'discount_type', 'amount', 'free_shipping', 'expires_at', 'minimum_amount', 'maximum_amount', 'individual_use', 'exclude_sale_items', 'product_ids', 'excluded_product_ids', 'product_category_ids', 'excluded_category_ids', 'email_restrictions', 'usage_limit', 'usage_limit_per_user', 'limit_usage_to_x_items', 'meta'] as const

export async function listCoupons() {
  return must(await svc().from('coupons').select('*').order('id', { ascending: false }), 'coupons') as any[]
}

export async function getCoupon(id: number) {
  const c = must(await svc().from('coupons').select('*').eq('id', id).maybeSingle(), 'coupons') as any
  if (!c) throw new OpError(`coupon ${id} not found`, 404)
  return c
}

function cleanCoupon(input: Record<string, any>) {
  const patch: Record<string, any> = pick(input, COUPON_FIELDS)
  if (patch.code !== undefined) patch.code = String(patch.code).trim().toLowerCase()
  for (const k of ['amount']) if (k in patch) patch[k] = numOrNull(patch[k]) ?? 0
  for (const k of ['minimum_amount', 'maximum_amount']) if (k in patch) patch[k] = numOrNull(patch[k])
  for (const k of ['usage_limit', 'usage_limit_per_user', 'limit_usage_to_x_items']) if (k in patch) patch[k] = numOrNull(patch[k])
  if (patch.discount_type && !['percent', 'fixed_cart', 'fixed_product'].includes(patch.discount_type)) throw new OpError('bad discount_type')
  return patch
}

export async function createCoupon(actor: Actor, input: Record<string, any>) {
  const patch = cleanCoupon(input)
  if (!patch.code) throw new OpError('code is required')
  const c = must(await svc().from('coupons').insert({ status: 'publish', ...patch }).select('*').single(), 'coupon insert') as any
  await audit(actor, 'coupon.create', 'coupon', c.id, null, patch)
  return c
}

export async function updateCoupon(actor: Actor, id: number, input: Record<string, any>) {
  const before = await getCoupon(id)
  const patch = cleanCoupon(input)
  const c = must(await svc().from('coupons').update(patch).eq('id', id).select('*').single(), 'coupon update')
  const d = diff(before, patch)
  await audit(actor, 'coupon.update', 'coupon', id, d.before, d.after)
  return c
}

export async function deleteCoupon(actor: Actor, id: number) {
  const before = await getCoupon(id)
  must(await svc().from('coupons').delete().eq('id', id), 'coupon delete')
  await audit(actor, 'coupon.delete', 'coupon', id, before, null)
  return { id, deleted: true }
}

// ---------------------------------------------------------------- quantity discount rules
const RULE_FIELDS = ['title', 'enabled', 'priority', 'applies_to', 'product_ids', 'category_ids', 'min_qty', 'max_qty', 'discount_type', 'amount', 'starts_at', 'ends_at', 'meta'] as const

export async function listRules() {
  return must(await svc().from('quantity_discount_rules').select('*').order('priority').order('id'), 'rules') as any[]
}

function cleanRule(input: Record<string, any>) {
  const patch: Record<string, any> = pick(input, RULE_FIELDS)
  for (const k of ['min_qty', 'priority']) if (k in patch) patch[k] = Math.trunc(Number(patch[k]) || 0)
  if ('max_qty' in patch) patch.max_qty = numOrNull(patch.max_qty)
  if ('amount' in patch) patch.amount = numOrNull(patch.amount) ?? 0
  return patch
}

export async function saveRule(actor: Actor, id: number | null, input: Record<string, any>) {
  const patch = cleanRule(input)
  if (id) {
    const before = (await svc().from('quantity_discount_rules').select('*').eq('id', id).maybeSingle()).data
    const r = must(await svc().from('quantity_discount_rules').update(patch).eq('id', id).select('*').single(), 'rule update')
    const d = diff(before, patch)
    await audit(actor, 'discount_rule.update', 'discount_rule', id, d.before, d.after)
    await touched()
    return r
  }
  if (!patch.title || !patch.min_qty) throw new OpError('title and min_qty are required')
  const r = must(await svc().from('quantity_discount_rules').insert(patch).select('*').single(), 'rule insert') as any
  await audit(actor, 'discount_rule.create', 'discount_rule', r.id, null, patch)
  await touched()
  return r
}

export async function deleteRule(actor: Actor, id: number) {
  const before = (await svc().from('quantity_discount_rules').select('*').eq('id', id).maybeSingle()).data
  must(await svc().from('quantity_discount_rules').delete().eq('id', id), 'rule delete')
  await audit(actor, 'discount_rule.delete', 'discount_rule', id, before, null)
  await touched()
  return { id, deleted: true }
}
