/* eslint-disable @typescript-eslint/no-explicit-any */
/** POST: store the editor's unsaved values as a preview snapshot → { url } (admin only). */
import { twLocalToIso } from '@/lib/admin/core'
import { adminOrNull } from '@/lib/admin/session'
import { svc } from '@/lib/sb'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const fd = await req.formData()
  const kind = String(fd.get('_kind') || '')
  const admin = await adminOrNull(kind === 'product' ? 'shop' : 'content')
  if (!admin) return Response.json({ error: '未登入或沒有權限' }, { status: 401 })
  const id = Number(fd.get('_id'))
  if (!['post', 'product'].includes(kind) || !id) return Response.json({ error: 'bad request' }, { status: 400 })
  const g = (k: string) => (fd.has(k) ? String(fd.get(k)) : undefined)
  const data: Record<string, any> = {}
  if (kind === 'post') {
    for (const k of ['title', 'content_html', 'excerpt_html']) if (g(k) !== undefined) data[k] = g(k)
    if (g('published_at')) data.published_at = twLocalToIso(g('published_at'))
    if (g('featured_media_id') !== undefined) data.featured_media_id = Number(g('featured_media_id')) || null
  } else {
    for (const k of ['name', 'description_html', 'short_description_html', 'sku']) if (g(k) !== undefined) data[k] = g(k)
    for (const k of ['regular_price', 'sale_price']) if (g(k) !== undefined) data[k] = g(k) === '' ? null : Number(g(k))
    if (g('featured_media_id') !== undefined) data.featured_media_id = Number(g('featured_media_id')) || null
    if (g('gallery_media_ids') !== undefined) data.gallery_media_ids = String(g('gallery_media_ids')).split(',').map(Number).filter(Boolean)
  }
  // old snapshots are useless after a day
  await svc().from('previews').delete().lt('created_at', new Date(Date.now() - 86400_000).toISOString())
  const { data: row, error } = await svc().from('previews').insert({ kind, object_id: id, data, created_by: admin.email }).select('token').single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ url: `/admin/preview/${row.token}/` })
}
