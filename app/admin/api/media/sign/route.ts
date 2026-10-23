/** POST {filename, mime}: signed upload URL for large GIF / video / PDF (uploaded straight to storage). */
import { OpError } from '@/lib/admin/core'
import { adminOrNull } from '@/lib/admin/session'
import { signedUploadFor } from '@/lib/admin/site-ops'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  if (!(await adminOrNull('media'))) return Response.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const { filename, mime } = await req.json()
    return Response.json(await signedUploadFor(String(filename || 'file'), String(mime || '')))
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: e instanceof OpError ? e.status : 500 })
  }
}
