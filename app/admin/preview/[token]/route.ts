/* eslint-disable @typescript-eslint/no-explicit-any */
/** GET: render a post/page/product with unsaved edits inside the storefront chrome (admin only, noindex). */
import { renderDocument } from '@/lib/document'
import { getContent } from '@/lib/admin/content'
import { getProduct } from '@/lib/admin/shop'
import { adminOrNull } from '@/lib/admin/session'
import { svc } from '@/lib/sb'
import { getSite, type Post, type Product } from '@/lib/site'
import type { Ctx } from '@/lib/views/common'
import { pageView, postView } from '@/lib/views/content'
import { productView } from '@/lib/views/shop'

export const dynamic = 'force-dynamic'

const BANNER = `<div style="position:fixed;z-index:99999;left:0;right:0;bottom:0;background:#1d2327;color:#fff;font:13px/1.4 sans-serif;padding:8px 16px;text-align:center">預覽模式：此畫面包含尚未儲存或尚未發布的內容，訪客看不到。</div>`

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const admin = await adminOrNull()
  if (!admin) return new Response(null, { status: 302, headers: { Location: '/admin/login/' } })
  const { token } = await params
  if (!/^[0-9a-f-]{36}$/.test(token)) return new Response('Not found', { status: 404 })
  const { data: snap } = await svc().from('previews').select('*').eq('token', token).maybeSingle()
  if (!snap) return new Response('預覽已過期，請回到編輯畫面重新按「預覽」。', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  const site = await getSite()
  let html: string
  if (snap.kind === 'product') {
    const base = await getProduct(Number(snap.object_id))
    const p = { ...base, ...snap.data } as unknown as Product
    const path = p.path || `/product/${p.slug}/`
    const ctx: Ctx = { site, path, rawPath: path, query: new URLSearchParams(), notices: [] }
    html = renderDocument(site, productView(p, ctx), null, path)
  } else {
    const base = await getContent(Number(snap.object_id))
    const p = { ...base, ...snap.data } as unknown as Post
    const path = p.path || `/${p.slug}/`
    const ctx: Ctx = { site, path, rawPath: path, query: new URLSearchParams(), notices: [] }
    const view = p.post_type === 'post' ? postView(p, ctx) : pageView(p, ctx)
    html = renderDocument(site, view, null, path)
  }
  html = html.replace('<head>', '<head>\n<meta name="robots" content="noindex, nofollow">').replace(/<\/body>/, `${BANNER}</body>`)
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=UTF-8', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' } })
}
