/** POST multipart (file): upload into the media library; images → WebP. */
import { OpError } from '@/lib/admin/core'
import { adminOrNull } from '@/lib/admin/session'
import { uploadMedia } from '@/lib/admin/site-ops'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: Request) {
  const admin = await adminOrNull('media')
  if (!admin) return Response.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const fd = await req.formData()
    const f = fd.get('file')
    if (!f || typeof f === 'string') return Response.json({ error: 'no file' }, { status: 400 })
    const m = await uploadMedia(admin, { buffer: Buffer.from(await f.arrayBuffer()), filename: f.name || 'file', mime: f.type }, { title: String(fd.get('title') || '') || undefined, alt_text: String(fd.get('alt_text') || '') || undefined })
    return Response.json(m)
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: e instanceof OpError ? e.status : 500 })
  }
}
