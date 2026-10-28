/**
 * POST /api/newebpay/notify — NewebPay NotifyURL (server-to-server). The only place a NewebPay order changes
 * state: TradeSha + AES verified, merchant / order number / amount checked, idempotent (see lib/newebpay/core).
 */
import { revalidatePath } from 'next/cache'
import { handleNotify } from '@/lib/newebpay/core'
import { dbStore, hostOf, newebpayConfig } from '@/lib/newebpay'
import { purgePublicPages } from '@/lib/page-cache'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  // null also when NEWEBPAY_ENV=test on kcasa.pro (fail closed, logged in newebpayConfig)
  const cfg = newebpayConfig(hostOf(req))
  if (!cfg) return new Response('gateway disabled', { status: 503 })
  let form: Record<string, string> = {}
  try {
    const fd = await req.formData()
    for (const [k, v] of fd.entries()) if (typeof v === 'string') form[k] = v
  } catch {
    form = {}
  }
  try {
    const r = await handleNotify(form, cfg, dbStore)
    if (r.outcome === 'rejected') console.warn('[newebpay] notify rejected', r.reason, r.orderId ?? '')
    if (r.outcome === 'paid') {
      await purgePublicPages().catch(() => {}) // stock / sales counts on product pages
      revalidatePath('/admin/orders/')
    }
    return new Response(r.outcome === 'rejected' ? `REJECTED ${r.reason}` : 'SUCCESS', { status: r.httpStatus, headers: { 'content-type': 'text/plain' } })
  } catch (e) {
    console.error('[newebpay] notify error', (e as Error).message)
    return new Response('ERROR', { status: 500 })
  }
}
