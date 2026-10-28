/** GET /api/newebpay/pay/?order=<id>&key=<order_key> — auto-submits the signed MPG form for an unpaid NewebPay order. */
import type { NextRequest } from 'next/server'
import { svc } from '@/lib/sb'
import { GATEWAY_ID, isExpired, newebpayConfig, originOf, payFormHtml } from '@/lib/newebpay'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const cfg = newebpayConfig()
  const id = Number(req.nextUrl.searchParams.get('order'))
  const key = req.nextUrl.searchParams.get('key') || ''
  if (!cfg || !Number.isInteger(id) || id <= 0 || !key) return new Response('Not found', { status: 404 })
  const { data: o } = await svc().from('orders').select('id,order_key,order_number,status,total,billing,payment_method,transaction_id,created_at').eq('id', id).maybeSingle()
  if (!o || o.order_key !== key || o.payment_method !== GATEWAY_ID) return new Response('Not found', { status: 404 })
  const back = `/checkout/order-received/${o.id}/?key=${encodeURIComponent(o.order_key)}`
  // already paid / failed / cancelled, or past the 60-minute hold: show the order instead of paying again
  if (o.status !== 'pending' || o.transaction_id || isExpired(o)) return Response.redirect(new URL(back, originOf(req)), 303)
  return new Response(payFormHtml(cfg, o, originOf(req)), {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' },
  })
}
