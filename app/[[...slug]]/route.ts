/**
 * Storefront catch-all: every public URL of the old WordPress site (pages, posts, archives, shop,
 * cart/checkout/my-account, feeds, sitemaps, legacy redirects) is answered here with a complete HTML
 * document built from Supabase content inside the captured Astra/WooCommerce chrome.
 */
import type { NextRequest } from 'next/server'
import { handlePost } from '@/lib/actions'
import { route, type Out } from '@/lib/router'
import { syncWcCookies } from '@/lib/cart'
import { PAGE_CACHE_TAG, PRIVATE_PARAM, hasPrivateCookies } from '@/lib/page-cache'

export const dynamic = 'force-dynamic'

/**
 * Public pages are cached on the Vercel CDN (5 min fresh, then stale-while-revalidate; admin/MCP writes purge the
 * PAGE_CACHE_TAG). Browsers always revalidate. Visitors with a cart / notice / login cookie are routed around the
 * CDN cache by proxy.ts and get private, uncached pages.
 */
const PUBLIC_HTML = { 'Cache-Control': 'public, max-age=0, must-revalidate', 'Vercel-CDN-Cache-Control': 'max-age=300, stale-while-revalidate=86400', 'Vercel-Cache-Tag': PAGE_CACHE_TAG }

function respond(o: Out, head = false, cacheable = false): Response {
  if (o.type === 'redirect') {
    return new Response(null, { status: o.status, headers: { Location: encodeURI(decodeURISafe(o.to)), 'Cache-Control': 'no-store' } })
  }
  if (o.type === 'raw') {
    return new Response(head ? null : o.body, { status: o.status, headers: { 'Content-Type': o.contentType, 'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600' } })
  }
  return new Response(head ? null : o.body, {
    status: o.status,
    headers: { 'Content-Type': 'text/html; charset=UTF-8', ...(cacheable && !o.private && (o.status === 200 || o.status === 404) ? PUBLIC_HTML : { 'Cache-Control': 'private, no-store' }) },
  })
}

function decodeURISafe(s: string): string {
  try {
    return decodeURI(s)
  } catch {
    return s
  }
}

function errorPage(e: unknown): Response {
  console.error('[storefront]', e)
  return new Response('<!DOCTYPE html><html lang="zh-TW"><meta charset="utf-8"><title>暫時無法顯示 - Kcasa 工富家飾</title><body style="font-family:sans-serif;padding:3em;text-align:center"><h1>網站暫時無法顯示</h1><p>請稍後再試。</p></body></html>', { status: 503, headers: { 'Content-Type': 'text/html; charset=UTF-8', 'Cache-Control': 'no-store', 'Retry-After': '30' } })
}

/** request URL without proxy.ts' cache-bypass marker; cacheable = no per-visitor cookie */
function requestUrl(req: NextRequest): { url: URL; cacheable: boolean } {
  const url = new URL(req.url)
  const marked = url.searchParams.has(PRIVATE_PARAM)
  url.searchParams.delete(PRIVATE_PARAM)
  return { url, cacheable: !marked && !hasPrivateCookies(req.cookies.getAll().map((c) => c.name)) }
}

export async function GET(req: NextRequest) {
  try {
    const { url, cacheable } = requestUrl(req)
    // WooCommerce ?add-to-cart=ID links (non-AJAX fallback)
    if (url.searchParams.get('add-to-cart')) {
      const fd = new FormData()
      fd.set('add-to-cart', url.searchParams.get('add-to-cart')!)
      if (url.searchParams.get('quantity')) fd.set('quantity', url.searchParams.get('quantity')!)
      const target = new URL(url)
      target.searchParams.delete('add-to-cart')
      target.searchParams.delete('quantity')
      const r = await handlePost(target, fd)
      await syncWcCookies()
      return respond(r.type === 'redirect' ? { ...r, to: target.pathname + target.search } : r)
    }
    const out = await route(url)
    if (out.type === 'html') await syncWcCookies()
    return respond(out, false, cacheable)
  } catch (e) {
    return errorPage(e)
  }
}

export async function HEAD(req: NextRequest) {
  try {
    const { url, cacheable } = requestUrl(req)
    return respond(await route(url), true, cacheable)
  } catch (e) {
    return errorPage(e)
  }
}

export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const ct = req.headers.get('content-type') || ''
    if (!/form-data|x-www-form-urlencoded/.test(ct)) return new Response('Unsupported Media Type', { status: 415 })
    // same-origin check for state-changing form posts
    const origin = req.headers.get('origin')
    if (origin && new URL(origin).host !== url.host) return new Response('Forbidden', { status: 403 })
    const fd = await req.formData()
    const out = await handlePost(url, fd)
    await syncWcCookies()
    return respond(out)
  } catch (e) {
    return errorPage(e)
  }
}
