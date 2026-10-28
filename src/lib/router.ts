/* eslint-disable @typescript-eslint/no-explicit-any */
/** URL → view, following the old WordPress permalink structure of kcasa.pro. */
import { cookies, headers } from 'next/headers'
import { paymentMethods } from './newebpay'
import { customerFor, currentUser } from './auth'
import { loadCart, removeItem, updateCartMeta } from './cart'
import { renderDocument } from './document'
import { robotsTxt, rss, sitemapIndex, sitemapXml } from './feeds'
import { fetchAll } from './sb'
import { getSite, seenContentVersion, type Post, type Site } from './site'
import { normPath } from './util'
import { withTracking } from './tracking'
import { accountView, loginView, lostPasswordView, registerView } from './views/account'
import { cartView, checkoutView, orderReceivedView } from './views/checkout'
import type { Ctx, Notice, View } from './views/common'
import { authorView, notFoundView, pageView, postView, searchView, termArchiveView } from './views/content'
import { catalogView, productView } from './views/shop'

export const NOTICE_COOKIE = 'kc_notice'

export type Out =
  | { type: 'html'; status: number; body: string; private: boolean }
  | { type: 'redirect'; to: string; status: 301 | 302 | 303 | 307 | 308 }
  | { type: 'raw'; status: number; body: string; contentType: string }

// ---------------------------------------------------------------- legacy redirect maps
let redirectCache: { at: number; v: string; map: Map<string, { target: string; code: number }> } | null = null
async function redirects(): Promise<Map<string, { target: string; code: number }>> {
  if (redirectCache && redirectCache.v === seenContentVersion() && Date.now() - redirectCache.at < 600_000) return redirectCache.map
  const rows = await fetchAll<any>('redirects', 'source_path,target,status_code,enabled')
  const map = new Map<string, { target: string; code: number }>()
  for (const r of rows) if (r.enabled) map.set(normPath(r.source_path), { target: r.target, code: Number(r.status_code) || 301 })
  redirectCache = { at: Date.now(), v: seenContentVersion(), map }
  return map
}

let mediaMapCache: { at: number; map: Map<string, string> } | null = null
async function mediaMap(): Promise<Map<string, string>> {
  if (mediaMapCache && Date.now() - mediaMapCache.at < 3600_000) return mediaMapCache.map
  const rows = await fetchAll<any>('media_url_map', 'old_url,new_url', 'old_url')
  const map = new Map<string, string>()
  for (const r of rows) {
    try {
      map.set(normPath(new URL(r.old_url, 'https://kcasa.pro').pathname), r.new_url)
    } catch {
      /* skip */
    }
  }
  mediaMapCache = { at: Date.now(), map }
  return map
}

/** drop the per-instance redirect / media-url caches (after admin or MCP writes) */
export function invalidateRouterCaches() {
  redirectCache = null
  mediaMapCache = null
}

export async function readNotices(): Promise<Notice[]> {
  const store = await cookies()
  const raw = store.get(NOTICE_COOKIE)?.value
  if (!raw) return []
  store.delete(NOTICE_COOKIE)
  try {
    const v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    return Array.isArray(v) ? v.slice(0, 5) : []
  } catch {
    return []
  }
}

export async function pushNotice(n: Notice | Notice[]) {
  const store = await cookies()
  const list = Array.isArray(n) ? n : [n]
  store.set(NOTICE_COOKIE, Buffer.from(JSON.stringify(list), 'utf8').toString('base64url'), { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 120 })
}

function pageByPath(site: Site, path: string): Post | null {
  const p = site.byPath.get(normPath(path))
  return p && p.status === 'publish' && p.post_type === 'page' ? p : null
}

function wcPage(site: Site, id: number, slug: string): Post {
  return site.postById.get(id) || site.posts.find((p) => p.post_type === 'page' && p.slug === slug) || ({ id, title: slug, post_type: 'page', slug, path: `/${slug}/`, content_html: '', excerpt_html: '', status: 'publish', meta: {}, seo: {} } as unknown as Post)
}

function html(view: View, site: Site, cart: Awaited<ReturnType<typeof loadCart>> | null, path: string): Out {
  // per-visitor pages never go to the shared CDN cache
  const priv = view.cache === 'private' || !!cart || /^\/(cart|checkout|my-account)\//.test(path)
  return { type: 'html', status: view.status, body: renderDocument(site, view, cart, path), private: priv }
}

export async function route(url: URL): Promise<Out> {
  // the visitor-facing host (route handlers may see the internal origin in req.url)
  const h = await headers()
  const host = (h.get('x-forwarded-host') || h.get('host') || url.host).split(',')[0].trim()
  return withTracking(host, () => routeUrl(url))
}

async function routeUrl(url: URL): Promise<Out> {
  const rawPath = url.pathname
  const last = rawPath.slice(rawPath.lastIndexOf('/') + 1)
  // WordPress adds the trailing slash with a 301
  if (!rawPath.endsWith('/') && !last.includes('.')) return { type: 'redirect', to: rawPath + '/' + url.search, status: 301 }

  const path = normPath(rawPath)
  const q = url.searchParams
  const site = await getSite()

  // ---- static-ish endpoints
  // old WordPress dashboard / login → the new admin (admin-ajax stays a 404 like any unknown path)
  if ((path === '/wp-admin/' || path.startsWith('/wp-admin/') || path === '/wp-login.php/' || rawPath === '/wp-login.php') && !path.startsWith('/wp-admin/admin-ajax')) return { type: 'redirect', to: '/admin/', status: 302 }
  if (path === '/robots.txt') return { type: 'raw', status: 200, body: robotsTxt(), contentType: 'text/plain; charset=utf-8' }
  if (path === '/sitemap_index.xml') return { type: 'raw', status: 200, body: sitemapIndex(site), contentType: 'application/xml; charset=UTF-8' }
  if (path === '/sitemap.xml' || path === '/wp-sitemap.xml') return { type: 'redirect', to: '/sitemap_index.xml', status: 301 }
  const sm = path.match(/^\/([a-z_]+)-sitemap\d*\.xml$/)
  if (sm) {
    const body = sitemapXml(site, sm[1])
    if (body) return { type: 'raw', status: 200, body, contentType: 'application/xml; charset=UTF-8' }
  }
  if (path === '/feed/') return { type: 'raw', status: 200, body: rss(site), contentType: 'application/rss+xml; charset=UTF-8' }
  if (path.startsWith('/wp-content/uploads/')) {
    const m = await mediaMap()
    const hit = m.get(path) || m.get(path.replace(/-\d+x\d+(?=\.\w+$)/, '')) || m.get(path.replace(/-scaled(?=\.\w+$)/, ''))
    if (hit) return { type: 'redirect', to: hit, status: 301 }
  }

  const notices = await readNotices()
  const ctx: Ctx = { site, path, rawPath, query: q, notices }
  const needsCart = (await cookies()).has('kc_cart')
  let cart = needsCart ? await loadCart() : null
  if (cart?.errors.length) ctx.notices.push(...cart.errors.map((e) => ({ type: 'error' as const, html: e })))
  const out = (v: View | null): Out => html(v || notFoundView(ctx), site, cart, path)

  // ---- front page & query-string URLs
  if (path === '/' || /^\/page\/\d+\/$/.test(path)) {
    const page = Number(path.match(/^\/page\/(\d+)\//)?.[1] || 1)
    if (q.has('s')) return out(searchView(q.get('s') || '', ctx, page))
    for (const k of ['p', 'page_id', 'attachment_id', 'product', 'post_type']) {
      const v = q.get(k)
      if (v === null) continue
      const r = (await redirects()).get(normPath(`/?${k}=${v}`))
      if (r) return { type: 'redirect', to: r.target, status: r.code as 301 }
      const id = Number(v)
      if ((k === 'p' || k === 'page_id') && id) {
        const p = site.postById.get(id)
        if (p?.path && p.status === 'publish') return { type: 'redirect', to: p.path, status: 301 }
        const pr = site.productById.get(id)
        if (pr && pr.status === 'publish') return { type: 'redirect', to: `/product/${pr.slug}/`, status: 301 }
      }
      if (k === 'attachment_id' && id) {
        const m = site.media.get(id)
        if (m) return { type: 'redirect', to: m.url, status: 301 }
      }
    }
    if (page > 1) return out(null)
    const front = site.postById.get(Number(site.settings.page_on_front || 0))
    if (front) {
      const v = pageView(front, ctx)
      v.legacyPath = '/'
      v.kind = 'front'
      v.seo.canonical = '/'
      return out(v)
    }
  }

  // ---- paged archives: /<base>/page/N/
  let page = 1
  let base = path
  const pm = path.match(/^(.*\/)page\/(\d+)\/$/)
  if (pm) {
    base = pm[1]
    page = Math.max(1, Number(pm[2]))
  }
  const seg = base.split('/').filter(Boolean)

  // ---- WooCommerce endpoints
  if (seg[0] === 'cart' && seg.length === 1 && page === 1) {
    const rm = q.get('remove_item')
    if (rm) {
      const name = await removeItem(Number(rm))
      if (name) await pushNotice({ type: 'success', html: `「${name}」已移除。` })
      return { type: 'redirect', to: '/cart/', status: 303 }
    }
    const rc = q.get('remove_coupon')
    if (rc && cart) {
      await updateCartMeta({ coupon_codes: cart.coupons.map((c) => c.code).filter((c) => c.toLowerCase() !== rc.toLowerCase()) })
      await pushNotice({ type: 'success', html: '已成功移除優惠券。' })
      return { type: 'redirect', to: '/cart/', status: 303 }
    }
    cart = cart || (await loadCart())
    const v = cartView(wcPage(site, 7, 'cart'), ctx, cart)
    return html(v, site, cart, path)
  }
  if (seg[0] === 'checkout' && page === 1) {
    if (seg[1] === 'order-received' && seg[2]) {
      const v = await orderReceivedView(wcPage(site, 8, 'checkout'), ctx, Number(seg[2]), q.get('key') || '')
      return out(v)
    }
    if (seg.length > 1) return out(null)
    const rc = q.get('remove_coupon')
    if (rc && cart) {
      await updateCartMeta({ coupon_codes: cart.coupons.map((c) => c.code).filter((c) => c.toLowerCase() !== rc.toLowerCase()) })
      await pushNotice({ type: 'success', html: '已成功移除優惠券。' })
      return { type: 'redirect', to: '/checkout/', status: 303 }
    }
    cart = cart || (await loadCart())
    // WooCommerce (woocommerce_checkout_redirect_empty_cart) sends an empty-cart checkout to the cart page
    if (!cart.lines.length) return { type: 'redirect', to: '/cart/', status: 302 }
    const user = await currentUser()
    let prefill: Record<string, string> = {}
    if (user) {
      const c = await customerFor(user).catch(() => null)
      if (c) {
        for (const [k, v] of Object.entries(c.billing || {})) prefill['billing_' + k] = String(v ?? '')
        for (const [k, v] of Object.entries(c.shipping || {})) prefill['shipping_' + k] = String(v ?? '')
        prefill.billing_email = prefill.billing_email || user.email
      }
    }
    const saved = (await cookies()).get('kc_checkout_form')?.value
    if (saved) {
      try {
        prefill = { ...prefill, ...JSON.parse(Buffer.from(saved, 'base64url').toString('utf8')) }
      } catch {
        /* ignore */
      }
      ;(await cookies()).delete('kc_checkout_form')
    }
    const hh = await headers()
    const methods = paymentMethods((hh.get('x-forwarded-host') || hh.get('host') || '').split(',')[0].trim() || null)
    return html(checkoutView(wcPage(site, 8, 'checkout'), ctx, cart, prefill, methods), site, cart, path)
  }
  if (seg[0] === 'my-account' && page === 1) {
    const acc = wcPage(site, 9, 'my-account')
    const endpoint = seg[1] || ''
    if (endpoint === 'lost-password') return out(lostPasswordView(acc, ctx, q.has('reset-link-sent')))
    const user = await currentUser()
    if (endpoint === 'customer-logout') return { type: 'redirect', to: '/api/auth/logout/', status: 303 }
    if (!user) {
      if (endpoint && endpoint !== 'lost-password') return { type: 'redirect', to: '/my-account/', status: 302 }
      return out(q.get('action') === 'register' ? registerView(acc, ctx) : loginView(acc, ctx))
    }
    const customer = await customerFor(user)
    const v = await accountView(acc, ctx, user, customer, endpoint, seg[2] || '')
    return out(v)
  }
  if (seg[0] === 'shop' && seg.length === 1) {
    const shop = wcPage(site, 6, 'shop')
    return out(catalogView(ctx, { page, base: '/shop/', legacyPath: '/shop/', kind: 'shop', title: shop.title || 'Shop', stored: shop.seo }))
  }
  if ((seg[0] === 'product-category' || seg[0] === 'product-tag') && seg.length >= 2) {
    const tax = seg[0] === 'product-category' ? 'product_cat' : 'product_tag'
    const t = site.termBySlug.get(`${tax}:${seg[seg.length - 1]}`)
    if (t) {
      const v = catalogView(ctx, { term: t, page, base: `/${seg[0]}/${t.slug}/`, legacyPath: `/${seg[0]}/${t.slug}/`, kind: tax, title: t.name, stored: t.meta?.seo })
      if (v) v.objectId = t.id
      return out(v)
    }
  }
  if (seg[0] === 'product' && seg.length === 2 && page === 1) {
    const p = site.productBySlug.get(seg[1])
    if (p && p.status === 'publish') {
      const v = productView(p, ctx)
      v.objectId = p.id
      return out(v)
    }
  }
  // ---- blog archives
  if ((seg[0] === 'category' || seg[0] === 'tag') && seg.length >= 2) {
    const t = site.termBySlug.get(`${seg[0] === 'category' ? 'category' : 'post_tag'}:${seg[seg.length - 1]}`)
    if (t) {
      const v = termArchiveView(t, ctx, page)
      if (v) v.objectId = t.id
      return out(v)
    }
  }
  if (seg[0] === 'author' && seg.length === 2) {
    const a = site.authorBySlug.get(seg[1])
    if (a) return out(authorView(a, ctx, page))
  }

  // ---- pages and posts by permalink
  if (page === 1) {
    const p = site.byPath.get(path)
    if (p && p.status === 'publish') {
      const v = p.post_type === 'page' ? pageView(p, ctx) : postView(p, ctx)
      v.objectId = p.id
      if (p.id === Number(site.settings.page_on_front || 0)) return { type: 'redirect', to: '/', status: 301 }
      return out(v)
    }
  }

  // ---- legacy redirects (attachment pages → file, manual)
  const r = (await redirects()).get(path)
  if (r) return { type: 'redirect', to: r.target, status: r.code as 301 }

  void pageByPath
  return out(null)
}
