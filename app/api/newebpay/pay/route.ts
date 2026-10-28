/**
 * GET /api/newebpay/pay/?order=<id>&key=<order_key> — auto-submits the signed MPG form for an unpaid NewebPay order.
 * Every visit is a new payment attempt with its own MerchantOrderNo (KC<id>_<n>, site_kcasa.newebpay_new_attempt),
 * and the NewebPay page is limited to the time left in the 60-minute stock hold (TradeLimit).
 */
import type { NextRequest } from 'next/server'
import { svc } from '@/lib/sb'
import { GATEWAY_ID, hostOf, newAttempt, newebpayConfig, originOf, payFormHtml, secondsLeft } from '@/lib/newebpay'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const cfg = newebpayConfig(hostOf(req))
  const id = Number(req.nextUrl.searchParams.get('order'))
  const key = req.nextUrl.searchParams.get('key') || ''
  if (!cfg || !Number.isSafeInteger(id) || id <= 0 || !key) return new Response('Not found', { status: 404 })
  const { data: o } = await svc().from('orders').select('id,order_key,order_number,status,total,billing,payment_method,transaction_id,created_at').eq('id', id).maybeSingle()
  if (!o || o.order_key !== key || o.payment_method !== GATEWAY_ID) return new Response('Not found', { status: 404 })
  const back = Response.redirect(new URL(`/checkout/order-received/${o.id}/?key=${encodeURIComponent(o.order_key)}`, originOf(req)), 303)
  // already paid / failed / cancelled, or (almost) past the 60-minute hold: show the order instead of paying again
  const left = secondsLeft(o)
  if (o.status !== 'pending' || o.transaction_id || left < 60) return back
  const mon = await newAttempt(o.id)
  if (!mon) return back
  return new Response(payFormHtml(cfg, o, originOf(req), mon, left), {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' },
  })
}
