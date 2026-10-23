/** GET ?form=&status= : form submissions as CSV (UTF-8 BOM, Excel-friendly). Admin only; the export is audited. */
import { audit } from '@/lib/admin/core'
import { adminOrNull } from '@/lib/admin/session'
import { listSubmissions, submissionsCsv } from '@/lib/admin/site-ops'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const admin = await adminOrNull('forms')
  if (!admin) return new Response('Unauthorized', { status: 401 })
  const u = new URL(req.url)
  const formId = Number(u.searchParams.get('form') || 0) || undefined
  const status = u.searchParams.get('status') || ''
  const { rows } = await listSubmissions({ form_id: formId, status, limit: 5000 })
  await audit(admin, 'form_submission.export', 'form', formId ?? null, null, { rows: rows.length, status })
  const name = `form-${formId || 'all'}-${new Date().toISOString().slice(0, 10)}.csv`
  return new Response(submissionsCsv(rows), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' } })
}
