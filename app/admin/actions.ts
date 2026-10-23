'use server'
/* eslint-disable @typescript-eslint/no-explicit-any */
/** Server actions for /admin. Every action re-checks the admin session; writes go through src/lib/admin/* (audited). */
import { redirect } from 'next/navigation'
import * as C from '@/lib/admin/content'
import { idList, numOrNull, OpError, twLocalToIso } from '@/lib/admin/core'
import { requireAdmin, signIn, signOut } from '@/lib/admin/session'
import * as S from '@/lib/admin/shop'
import * as O from '@/lib/admin/site-ops'

// browsers submit textarea newlines as CRLF; store LF like WordPress does
const str = (fd: FormData, k: string) => {
  const v = fd.get(k)
  return typeof v === 'string' ? v.replace(/\r\n?/g, '\n') : ''
}
const has = (fd: FormData, k: string) => fd.has(k)
const bool = (fd: FormData, k: string) => ['on', '1', 'true', 'yes'].includes(str(fd, k))
const num = (fd: FormData, k: string) => numOrNull(str(fd, k))
const ids = (fd: FormData, k: string) => fd.getAll(k).map(Number).filter((n) => Number.isFinite(n) && n > 0)
const names = (v: string) => v.split(/[,，、\n]/).map((x) => x.trim()).filter(Boolean)

function withParam(url: string, k: string, v: string) {
  return url + (url.includes('?') ? '&' : '?') + k + '=' + encodeURIComponent(v)
}

function safeBack(fd: FormData, fallback: string) {
  const b = str(fd, '_back')
  return b.startsWith('/admin/') ? b : fallback
}

/** run an operation, then redirect with ?msg= / ?err= (redirect() must stay outside the try) */
async function act(back: string, fn: () => Promise<string | void>, okMsg = '已儲存。') {
  let to: string
  try {
    const r = await fn()
    to = withParam(r || back, 'msg', okMsg)
  } catch (e) {
    const m = e instanceof OpError ? e.message : e instanceof Error ? e.message : String(e)
    console.error('[admin]', e)
    to = withParam(back, 'err', m)
  }
  redirect(to)
}

// ---------------------------------------------------------------- auth
export async function loginAction(_prev: { error?: string; email?: string } | undefined, fd: FormData): Promise<{ error?: string; email?: string }> {
  const email = str(fd, 'email').trim()
  const password = str(fd, 'password')
  if (!email || !password) return { error: '請輸入帳號與密碼。', email }
  const err = await signIn(email, password)
  if (err) return { error: err, email }
  redirect('/admin/')
}

export async function logoutAction() {
  await signOut()
  redirect('/admin/login/')
}

// ---------------------------------------------------------------- posts / pages / blocks
export async function newContentAction(fd: FormData) {
  const actor = await requireAdmin('content')
  const type = (str(fd, 'post_type') || 'post') as C.ContentType
  await act(`/admin/content/?type=${type}`, async () => {
    const c = await C.createContent(actor, { post_type: type, title: '', status: 'draft' })
    return `/admin/content/${c.id}/`
  }, '已建立草稿。')
}

function contentInput(fd: FormData, current: any): C.ContentInput {
  const intent = str(fd, 'intent')
  const pub = has(fd, 'published_at') ? twLocalToIso(str(fd, 'published_at')) : undefined
  let status = str(fd, 'status') || current.status
  if (intent === 'draft') status = 'draft'
  if (intent === 'publish') status = pub && new Date(pub).getTime() > Date.now() ? 'future' : 'publish'
  if (status === 'future' && (!pub || new Date(pub).getTime() <= Date.now())) status = 'publish'
  const input: C.ContentInput = {
    title: str(fd, 'title'),
    content_html: has(fd, 'content_html') ? str(fd, 'content_html') : undefined,
    excerpt_html: has(fd, 'excerpt_html') ? str(fd, 'excerpt_html') : undefined,
    status,
    published_at: pub === undefined ? undefined : pub,
    featured_media_id: has(fd, 'featured_media_id') ? num(fd, 'featured_media_id') : undefined,
    menu_order: has(fd, 'menu_order') ? Number(str(fd, 'menu_order') || 0) : undefined,
    template: has(fd, 'template') ? str(fd, 'template') : undefined,
    comment_status: has(fd, 'comment_status_present') ? (bool(fd, 'comment_status') ? 'open' : 'closed') : undefined,
    sticky: has(fd, 'sticky_present') ? bool(fd, 'sticky') : undefined,
    seo: { title: str(fd, 'seo_title') || undefined, description: str(fd, 'seo_description') || undefined, robots: str(fd, 'seo_robots') || undefined },
  }
  if (has(fd, 'slug') && str(fd, 'slug').trim()) input.slug = str(fd, 'slug').trim()
  if (has(fd, 'parent_id')) input.parent_id = num(fd, 'parent_id')
  if (has(fd, 'terms_present')) {
    input.category_ids = ids(fd, 'category_ids')
    input.tag_ids = []
    input.tag_names = names(str(fd, 'tag_names'))
  }
  // empty SEO strings clear the override (fall back to captured/automatic values)
  for (const k of ['title', 'description', 'robots'] as const) if (!input.seo![k]) delete input.seo![k]
  return input
}

export async function saveContentAction(fd: FormData) {
  const actor = await requireAdmin('content')
  const id = Number(str(fd, 'id'))
  const back = `/admin/content/${id}/`
  await act(back, async () => {
    const current = await C.getContent(id)
    const input = contentInput(fd, current)
    const seoClear: Record<string, any> = { ...(current.seo || {}) }
    for (const k of ['title', 'description', 'robots']) if (!(input.seo as any)[k]) delete seoClear[k]
    input.seo = { ...seoClear, ...input.seo }
    if (!input.title && !current.title && input.status === 'publish') throw new OpError('發布前請輸入標題。')
    input.replace_seo = true
    await C.updateContent(actor, id, input)
  }, str(fd, 'intent') === 'publish' ? '已發布 / 更新。' : '已儲存。')
}

export async function trashContentAction(fd: FormData) {
  const actor = await requireAdmin('content')
  const id = Number(str(fd, 'id'))
  const type = str(fd, 'post_type') || 'post'
  await act(`/admin/content/?type=${type}`, async () => {
    await C.deleteContent(actor, id, false)
  }, '已移至垃圾桶。')
}

export async function restoreContentAction(fd: FormData) {
  const actor = await requireAdmin('content')
  const id = Number(str(fd, 'id'))
  await act(safeBack(fd, `/admin/content/${id}/`), async () => {
    await C.restoreContent(actor, id)
  }, '已還原。')
}

export async function deleteContentAction(fd: FormData) {
  const actor = await requireAdmin('content')
  const id = Number(str(fd, 'id'))
  const type = str(fd, 'post_type') || 'post'
  await act(`/admin/content/?type=${type}&status=trash`, async () => {
    await C.deleteContent(actor, id, true)
  }, '已永久刪除。')
}

// ---------------------------------------------------------------- terms
export async function saveTermAction(fd: FormData) {
  const actor = await requireAdmin(str(fd, 'taxonomy').startsWith('product') ? 'shop' : 'content')
  const taxonomy = str(fd, 'taxonomy')
  const id = num(fd, 'id')
  const back = `/admin/terms/?taxonomy=${taxonomy}`
  await act(back, async () => {
    const input = { name: str(fd, 'name').trim(), slug: str(fd, 'slug').trim() || undefined, description: str(fd, 'description'), parent_id: num(fd, 'parent_id'), menu_order: Number(str(fd, 'menu_order') || 0), image_id: has(fd, 'image_id') ? num(fd, 'image_id') : undefined }
    if (id) await C.updateTerm(actor, id, input)
    else await C.createTerm(actor, { taxonomy, ...input })
  })
}

export async function deleteTermAction(fd: FormData) {
  const actor = await requireAdmin(str(fd, 'taxonomy').startsWith('product') ? 'shop' : 'content')
  await act(`/admin/terms/?taxonomy=${str(fd, 'taxonomy')}`, async () => {
    await C.deleteTerm(actor, Number(str(fd, 'id')))
  }, '已刪除。')
}

// ---------------------------------------------------------------- products
export async function newProductAction() {
  const actor = await requireAdmin('shop')
  await act('/admin/products/', async () => {
    const p = await S.createProduct(actor, { name: '新商品', status: 'draft' })
    return `/admin/products/${p.id}/`
  }, '已建立商品草稿。')
}

export async function saveProductAction(fd: FormData) {
  const actor = await requireAdmin('shop')
  const id = Number(str(fd, 'id'))
  await act(`/admin/products/${id}/`, async () => {
    const intent = str(fd, 'intent')
    let status = str(fd, 'status')
    if (intent === 'draft') status = 'draft'
    if (intent === 'publish') status = 'publish'
    const input: S.ProductInput = {
      name: str(fd, 'name').trim(),
      type: str(fd, 'type') || undefined,
      status,
      featured: bool(fd, 'featured'),
      catalog_visibility: str(fd, 'catalog_visibility') || 'visible',
      sku: str(fd, 'sku').trim(),
      description_html: has(fd, 'description_html') ? str(fd, 'description_html') : undefined,
      short_description_html: has(fd, 'short_description_html') ? str(fd, 'short_description_html') : undefined,
      regular_price: has(fd, 'regular_price') ? num(fd, 'regular_price') : undefined,
      sale_price: has(fd, 'sale_price') ? num(fd, 'sale_price') : undefined,
      sale_starts_at: twLocalToIso(str(fd, 'sale_starts_at')),
      sale_ends_at: twLocalToIso(str(fd, 'sale_ends_at')),
      tax_status: str(fd, 'tax_status') || 'taxable',
      manage_stock: bool(fd, 'manage_stock'),
      stock_quantity: num(fd, 'stock_quantity'),
      stock_status: str(fd, 'stock_status') || 'instock',
      backorders: str(fd, 'backorders') || 'no',
      low_stock_amount: num(fd, 'low_stock_amount'),
      sold_individually: bool(fd, 'sold_individually'),
      weight: num(fd, 'weight'),
      length: num(fd, 'length'),
      width: num(fd, 'width'),
      height: num(fd, 'height'),
      shipping_class: str(fd, 'shipping_class'),
      featured_media_id: num(fd, 'featured_media_id'),
      gallery_media_ids: idList(str(fd, 'gallery_media_ids')),
      menu_order: Number(str(fd, 'menu_order') || 0),
      reviews_allowed: bool(fd, 'reviews_allowed'),
      upsell_ids: idList(str(fd, 'upsell_ids')),
      cross_sell_ids: idList(str(fd, 'cross_sell_ids')),
      category_ids: ids(fd, 'category_ids'),
      tag_ids: [],
      tag_names: names(str(fd, 'tag_names')),
    }
    if (str(fd, 'slug').trim()) input.slug = str(fd, 'slug').trim()
    const current = await S.getProduct(id)
    const seo: Record<string, any> = { ...(current.seo || {}) }
    for (const k of ['title', 'description', 'robots']) {
      const v = str(fd, 'seo_' + k)
      if (v) seo[k] = v
      else delete seo[k]
    }
    await S.updateProduct(actor, id, { ...input, seo, replace_seo: true })
  })
}

export async function trashProductAction(fd: FormData) {
  const actor = await requireAdmin('shop')
  await act('/admin/products/', async () => {
    await S.deleteProduct(actor, Number(str(fd, 'id')), false)
  }, '已移至垃圾桶。')
}

export async function restoreProductAction(fd: FormData) {
  const actor = await requireAdmin('shop')
  const id = Number(str(fd, 'id'))
  await act(safeBack(fd, `/admin/products/${id}/`), async () => {
    await S.restoreProduct(actor, id)
  }, '已還原。')
}

export async function deleteProductAction(fd: FormData) {
  const actor = await requireAdmin('shop')
  await act('/admin/products/?status=trash', async () => {
    await S.deleteProduct(actor, Number(str(fd, 'id')), true)
  }, '已永久刪除。')
}

function variationInput(fd: FormData, p: string) {
  const attrs: { name: string; value: string | null }[] = []
  for (const [k, v] of fd.entries()) {
    const m = k.match(new RegExp(`^${p}attr\\[(.+)\\]$`))
    if (m && typeof v === 'string') attrs.push({ name: m[1], value: v === '' ? null : v })
  }
  const out: Record<string, any> = {
    sku: str(fd, p + 'sku'),
    regular_price: num(fd, p + 'regular_price'),
    sale_price: num(fd, p + 'sale_price'),
    manage_stock: bool(fd, p + 'manage_stock'),
    stock_quantity: num(fd, p + 'stock_quantity'),
    stock_status: str(fd, p + 'stock_status') || 'instock',
    status: bool(fd, p + 'enabled') ? 'publish' : 'private',
    image_id: num(fd, p + 'image_id'),
    menu_order: Number(str(fd, p + 'menu_order') || 0),
  }
  if (attrs.length) out.attributes = attrs
  return out
}

export async function saveVariationsAction(fd: FormData) {
  const actor = await requireAdmin('shop')
  const productId = Number(str(fd, 'product_id'))
  await act(`/admin/products/${productId}/#variations`, async () => {
    for (const vid of ids(fd, 'variation_ids')) await S.updateVariation(actor, vid, variationInput(fd, `v${vid}_`))
  }, '變體已儲存。')
}

export async function addVariationAction(fd: FormData) {
  const actor = await requireAdmin('shop')
  const productId = Number(str(fd, 'product_id'))
  await act(`/admin/products/${productId}/#variations`, async () => {
    await S.createVariation(actor, productId, { ...variationInput(fd, 'new_'), status: 'publish' })
  }, '已新增變體。')
}

export async function deleteVariationAction(fd: FormData) {
  const actor = await requireAdmin('shop')
  const productId = Number(str(fd, 'product_id'))
  await act(`/admin/products/${productId}/#variations`, async () => {
    await S.deleteVariation(actor, Number(str(fd, 'variation_id')))
  }, '已刪除變體。')
}

export async function saveAttributeAction(fd: FormData) {
  const actor = await requireAdmin('shop')
  const productId = Number(str(fd, 'product_id'))
  await act(`/admin/products/${productId}/#attributes`, async () => {
    await S.upsertAttributeValue(actor, productId, {
      id: num(fd, 'attr_id') || undefined,
      name: str(fd, 'attr_name').trim(),
      options: str(fd, 'attr_options').split(/\||\n/).map((x) => x.trim()).filter(Boolean),
      visible: bool(fd, 'attr_visible'),
      used_for_variations: bool(fd, 'attr_variation'),
      position: Number(str(fd, 'attr_position') || 0),
    })
  }, '屬性已儲存。')
}

export async function deleteAttributeAction(fd: FormData) {
  const actor = await requireAdmin('shop')
  const productId = Number(str(fd, 'product_id'))
  await act(`/admin/products/${productId}/#attributes`, async () => {
    await S.deleteAttributeValue(actor, Number(str(fd, 'attr_id')))
  }, '已刪除屬性。')
}

// ---------------------------------------------------------------- orders & customers
export async function orderStatusAction(fd: FormData) {
  const actor = await requireAdmin('orders')
  const id = Number(str(fd, 'id'))
  await act(`/admin/orders/${id}/`, async () => {
    await S.updateOrderStatus(actor, id, str(fd, 'status'), str(fd, 'note').trim() || undefined)
  }, '訂單已更新。')
}

export async function orderNoteAction(fd: FormData) {
  const actor = await requireAdmin('orders')
  const id = Number(str(fd, 'id'))
  await act(`/admin/orders/${id}/`, async () => {
    await S.addOrderNote(actor, id, str(fd, 'content'), bool(fd, 'is_customer_note'))
  }, '已新增備註。')
}

const ADDR = ['first_name', 'last_name', 'company', 'address_1', 'address_2', 'city', 'state', 'postcode', 'country', 'email', 'phone']
function addr(fd: FormData, p: string) {
  const o: Record<string, string> = {}
  for (const k of ADDR) if (has(fd, `${p}_${k}`)) o[k] = str(fd, `${p}_${k}`)
  return o
}

export async function orderAddressAction(fd: FormData) {
  const actor = await requireAdmin('orders')
  const id = Number(str(fd, 'id'))
  await act(`/admin/orders/${id}/`, async () => {
    await S.updateOrderAddresses(actor, id, { billing: addr(fd, 'billing'), shipping: addr(fd, 'shipping'), customer_note: str(fd, 'customer_note') })
  })
}

export async function saveCustomerAction(fd: FormData) {
  const actor = await requireAdmin('orders')
  const id = Number(str(fd, 'id'))
  await act(`/admin/customers/${id}/`, async () => {
    await S.updateCustomer(actor, id, { first_name: str(fd, 'first_name'), last_name: str(fd, 'last_name'), display_name: str(fd, 'display_name'), email: str(fd, 'email').trim(), billing: addr(fd, 'billing'), shipping: addr(fd, 'shipping') })
  })
}

// ---------------------------------------------------------------- coupons & discount rules
export async function saveCouponAction(fd: FormData) {
  const actor = await requireAdmin('shop')
  const id = num(fd, 'id')
  await act(id ? `/admin/coupons/${id}/` : '/admin/coupons/new/', async () => {
    const input = {
      code: str(fd, 'code'),
      description: str(fd, 'description'),
      status: str(fd, 'status') || 'publish',
      discount_type: str(fd, 'discount_type'),
      amount: num(fd, 'amount'),
      free_shipping: bool(fd, 'free_shipping'),
      expires_at: twLocalToIso(str(fd, 'expires_at')),
      minimum_amount: num(fd, 'minimum_amount'),
      maximum_amount: num(fd, 'maximum_amount'),
      individual_use: bool(fd, 'individual_use'),
      exclude_sale_items: bool(fd, 'exclude_sale_items'),
      product_ids: idList(str(fd, 'product_ids')),
      excluded_product_ids: idList(str(fd, 'excluded_product_ids')),
      product_category_ids: ids(fd, 'product_category_ids'),
      excluded_category_ids: ids(fd, 'excluded_category_ids'),
      email_restrictions: names(str(fd, 'email_restrictions')),
      usage_limit: num(fd, 'usage_limit'),
      usage_limit_per_user: num(fd, 'usage_limit_per_user'),
      limit_usage_to_x_items: num(fd, 'limit_usage_to_x_items'),
    }
    if (id) await S.updateCoupon(actor, id, input)
    else return `/admin/coupons/${(await S.createCoupon(actor, input)).id}/`
  })
}

export async function deleteCouponAction(fd: FormData) {
  const actor = await requireAdmin('shop')
  await act('/admin/coupons/', async () => {
    await S.deleteCoupon(actor, Number(str(fd, 'id')))
  }, '已刪除優惠券。')
}

export async function saveRuleAction(fd: FormData) {
  const actor = await requireAdmin('shop')
  await act('/admin/coupons/#rules', async () => {
    await S.saveRule(actor, num(fd, 'id'), {
      title: str(fd, 'title'),
      enabled: bool(fd, 'enabled'),
      priority: Number(str(fd, 'priority') || 10),
      applies_to: str(fd, 'applies_to') || 'all',
      product_ids: idList(str(fd, 'product_ids')),
      category_ids: ids(fd, 'category_ids'),
      min_qty: Number(str(fd, 'min_qty') || 0),
      max_qty: num(fd, 'max_qty'),
      discount_type: str(fd, 'discount_type') || 'percent',
      amount: num(fd, 'amount'),
      starts_at: twLocalToIso(str(fd, 'starts_at')),
      ends_at: twLocalToIso(str(fd, 'ends_at')),
    })
  }, '折扣規則已儲存。')
}

export async function deleteRuleAction(fd: FormData) {
  const actor = await requireAdmin('shop')
  await act('/admin/coupons/#rules', async () => {
    await S.deleteRule(actor, Number(str(fd, 'id')))
  }, '已刪除折扣規則。')
}

// ---------------------------------------------------------------- media
export async function saveMediaAction(fd: FormData) {
  const actor = await requireAdmin('media')
  const id = Number(str(fd, 'id'))
  await act(safeBack(fd, `/admin/media/?edit=${id}`), async () => {
    await O.updateMedia(actor, id, { title: str(fd, 'title'), alt_text: str(fd, 'alt_text'), caption_html: str(fd, 'caption_html') })
  })
}

export async function deleteMediaAction(fd: FormData) {
  const actor = await requireAdmin('media')
  await act('/admin/media/', async () => {
    await O.deleteMedia(actor, Number(str(fd, 'id')))
  }, '已刪除檔案。')
}

// ---------------------------------------------------------------- menus
export async function saveMenuItemsAction(fd: FormData) {
  const actor = await requireAdmin('menus')
  const menuId = str(fd, 'menu_id')
  await act(`/admin/menus/?menu=${menuId}`, async () => {
    for (const id of ids(fd, 'item_ids')) {
      await O.saveMenuItem(actor, id, { title: str(fd, `i${id}_title`), url: str(fd, `i${id}_url`), position: str(fd, `i${id}_position`), parent_id: str(fd, `i${id}_parent_id`), target: str(fd, `i${id}_target`) })
    }
  }, '選單已儲存。')
}

export async function addMenuItemAction(fd: FormData) {
  const actor = await requireAdmin('menus')
  const menuId = Number(str(fd, 'menu_id'))
  await act(`/admin/menus/?menu=${menuId}`, async () => {
    await O.saveMenuItem(actor, null, { menu_id: menuId, title: str(fd, 'title'), url: str(fd, 'url'), position: str(fd, 'position') || '99', parent_id: str(fd, 'parent_id'), target: str(fd, 'target'), object_type: 'custom' })
  }, '已新增選單項目。')
}

export async function deleteMenuItemAction(fd: FormData) {
  const actor = await requireAdmin('menus')
  await act(`/admin/menus/?menu=${str(fd, 'menu_id')}`, async () => {
    await O.deleteMenuItem(actor, Number(str(fd, 'id')))
  }, '已刪除選單項目。')
}

// ---------------------------------------------------------------- forms
export async function submissionStatusAction(fd: FormData) {
  const actor = await requireAdmin('forms')
  await act(safeBack(fd, '/admin/forms/'), async () => {
    await O.setSubmissionStatus(actor, Number(str(fd, 'id')), str(fd, 'status'))
  }, '已更新。')
}

// ---------------------------------------------------------------- settings
export async function saveSettingsAction(fd: FormData) {
  const actor = await requireAdmin('settings')
  await act('/admin/settings/', async () => {
    const cur = Object.fromEntries((await O.getSettings()).map((r: any) => [r.key, r.value]))
    const set = async (k: string, v: any) => {
      if (JSON.stringify(cur[k]) !== JSON.stringify(v)) await O.setSetting(actor, k, v)
    }
    await set('site_name', str(fd, 'site_name').trim())
    await set('site_description', str(fd, 'site_description').trim())
    const logoId = num(fd, 'site_logo_id')
    if (logoId && logoId !== Number(cur.site_logo?.media_id)) {
      const m = await O.getMedia(logoId)
      await set('site_logo', { ...(cur.site_logo || {}), url: m.url, media_id: m.id, original_url: cur.site_logo?.original_url || cur.site_logo?.url })
    }
    await set('contact_phone', str(fd, 'contact_phone').trim())
    await set('contact_email', str(fd, 'contact_email').trim())
    await set('contact_address', str(fd, 'contact_address').trim())
    await set('contact_line', str(fd, 'contact_line').trim())
    await set('social_links', names(str(fd, 'social_links')))
    const t = { ...(cur.tracking || {}) }
    const gtm = str(fd, 'gtm').trim()
    const gtag = str(fd, 'google_tag').trim()
    const ads = str(fd, 'google_ads').trim()
    const adsense = str(fd, 'adsense').trim()
    for (const [label, v, re] of [['GTM', gtm, /^GTM-[A-Z0-9]+$/], ['Google tag', gtag, /^(G|GT|AW)-[A-Z0-9]+$/], ['Google Ads', ads, /^AW-\d+$/], ['AdSense', adsense, /^ca-pub-\d+$/]] as const) {
      if (v && !re.test(v)) throw new OpError(`${label} 代碼格式不正確：${v}`)
    }
    t.gtm = gtm ? [gtm] : []
    t.google_tag = { ...(t.google_tag || {}), ids: gtag ? [gtag] : [] }
    t.google_ads = { ...(t.google_ads || {}), ids: ads ? [ads] : [] }
    t.adsense = { ...(t.adsense || {}), publisher_id: adsense }
    await set('tracking', t)
    await set('tracking_custom', { enabled: bool(fd, 'tracking_enabled'), head_html: str(fd, 'head_html'), body_html: str(fd, 'body_html') })
    const front = num(fd, 'page_on_front')
    if (front) await set('page_on_front', front)
  }, '設定已儲存。')
}

// ---------------------------------------------------------------- redirects
export async function saveRedirectAction(fd: FormData) {
  const actor = await requireAdmin('redirects')
  await act(safeBack(fd, '/admin/redirects/'), async () => {
    await O.saveRedirect(actor, num(fd, 'id'), { source_path: str(fd, 'source_path'), target: str(fd, 'target').trim(), status_code: Number(str(fd, 'status_code') || 301), enabled: bool(fd, 'enabled') })
  }, '轉址已儲存。')
}

export async function deleteRedirectAction(fd: FormData) {
  const actor = await requireAdmin('redirects')
  await act(safeBack(fd, '/admin/redirects/'), async () => {
    await O.deleteRedirect(actor, Number(str(fd, 'id')))
  }, '已刪除轉址。')
}
