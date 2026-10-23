/** POST {path, mime, size, title}: create the media row for a file uploaded with a signed URL. */
import { OpError } from '@/lib/admin/core'
import { adminOrNull } from '@/lib/admin/session'
import { registerUploadedFile } from '@/lib/admin/site-ops'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const admin = await adminOrNull('media')
  if (!admin) return Response.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const { path, mime, size, title } = await req.json()
    return Response.json(await registerUploadedFile(admin, String(path), String(mime), Number(size) || 0, title ? String(title) : undefined))
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: e instanceof OpError ? e.status : 500 })
  }
}
