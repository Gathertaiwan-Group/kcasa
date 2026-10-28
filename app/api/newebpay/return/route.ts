/**
 * POST /api/newebpay/return — NewebPay ReturnURL (the shopper's browser). Display only: it never changes the
 * order; it just finds the order from the verified payload and shows the order-received page.
 */
import { svc } from '@/lib/sb'
import { orderIdFrom, parseCallback } from '@/lib/newebpay/core'
import { GATEWAY_ID, hostOf, newebpayConfig, originOf } from '@/lib/newebpay'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const origin = originOf(req)
  const cfg = newebpayConfig(hostOf(req))
  const home = new URL('/my-account/orders/', origin)
  if (!cfg) return Response.redirect(home, 303)
  const form: Record<string, string> = {}
  try {
    const fd = await req.formData()
    for (const [k, v] of fd.entries()) if (typeof v === 'string') form[k] = v
  } catch {}
  const p = parseCallback(form, cfg)
  if (!p.ok) return Response.redirect(home, 303)
  const id = orderIdFrom(p.data.MerchantOrderNo)
  const { data: o } = id ? await svc().from('orders').select('id,order_key,payment_method').eq('id', id).maybeSingle() : { data: null }
  if (!o || o.payment_method !== GATEWAY_ID) return Response.redirect(home, 303)
  return Response.redirect(new URL(`/checkout/order-received/${o.id}/?key=${encodeURIComponent(o.order_key)}`, origin), 303)
}

export async function GET(req: Request) {
  return Response.redirect(new URL('/my-account/orders/', originOf(req)), 303)
}
