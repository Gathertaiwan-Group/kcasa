/** WordPress admin-ajax.php replacement for the legacy front-end scripts (wpforms_settings.ajaxurl points here). */
import type { NextRequest } from 'next/server'
import { wpformsToken } from '@/lib/wpforms-token'
import { getSite } from '@/lib/site'

export const dynamic = 'force-dynamic'

const json = (o: unknown, status = 200) => Response.json(o, { status, headers: { 'Cache-Control': 'no-store' } })

export async function POST(req: NextRequest) {
  const ct = req.headers.get('content-type') || ''
  const fd = /form|urlencoded/.test(ct) ? await req.formData() : new FormData()
  const action = String(fd.get('action') || req.nextUrl.searchParams.get('action') || '')
  switch (action) {
    case 'wpforms_get_token': {
      const formId = Number(fd.get('formId'))
      const site = await getSite()
      if (!site.forms.some((f) => Number(f.id) === formId)) return json({ success: false, data: 'invalid form' }, 400)
      const { token } = wpformsToken(formId)
      // wpforms.min.js reads e.data.token
      return json({ success: true, data: { token } })
    }
    default:
      // same answer WordPress gives for an unknown action
      return new Response('0', { status: 400, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } })
  }
}

export async function GET(req: NextRequest) {
  return POST(req)
}
