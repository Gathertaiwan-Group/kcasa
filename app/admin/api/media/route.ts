/** GET: media library listing for the picker (admin only). */
import { adminOrNull } from '@/lib/admin/session'
import { listMedia } from '@/lib/admin/site-ops'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  if (!(await adminOrNull('media'))) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const u = new URL(req.url)
  const r = await listMedia({ search: u.searchParams.get('search') || '', mime: u.searchParams.get('mime') || '', limit: Number(u.searchParams.get('limit') || 60), offset: Number(u.searchParams.get('offset') || 0) })
  return Response.json({ rows: r.rows, total: r.total })
}
