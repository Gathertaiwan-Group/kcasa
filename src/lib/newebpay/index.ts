/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * NewebPay (藍新金流) MPG wiring: env config, the checkout payment-method list, the Supabase-backed
 * NotifyStore, the auto-submitting pay form, and WooCommerce-style cancellation of unpaid orders.
 * Keys come only from NEWEBPAY_MERCHANT_ID / NEWEBPAY_HASH_KEY / NEWEBPAY_HASH_IV / NEWEBPAY_ENV;
 * without them the gateway is simply not offered and checkout keeps working with 領取報價 only.
 */
import { audit as auditLog } from '../admin/core'
import { svc } from '../sb'
import { esc } from '../util'
import { GATEWAY_ID, buildMpgForm, validKeys, type NewebpayKeys, type NotifyStore } from './core'

export { GATEWAY_ID }

export type NewebpayConfig = NewebpayKeys & { env: 'test' | 'production'; gateway: string }

export function newebpayConfig(): NewebpayConfig | null {
  const env = (process.env.NEWEBPAY_ENV || '').trim()
  const k = { merchantId: (process.env.NEWEBPAY_MERCHANT_ID || '').trim(), hashKey: (process.env.NEWEBPAY_HASH_KEY || '').trim(), hashIv: (process.env.NEWEBPAY_HASH_IV || '').trim() }
  if (env !== 'test' && env !== 'production') return null
  if (!validKeys(k)) return null
  return { ...k, env, gateway: env === 'production' ? 'https://core.newebpay.com/MPG/mpg_gateway' : 'https://ccore.newebpay.com/MPG/mpg_gateway' }
}

export type PaymentMethod = { id: string; title: string; description: string }

/** old site (wp_options): woocommerce_cheque_settings + woocommerce_ry_newebpay_credit_settings, in woocommerce_gateway_order */
export const CHEQUE: PaymentMethod = { id: 'cheque', title: '領取報價', description: '小編會進一步與您聯繫＆報價' }
export const NEWEBPAY_CREDIT: PaymentMethod = { id: GATEWAY_ID, title: '藍新信用卡', description: '使用信用卡付款' }

export function paymentMethods(): PaymentMethod[] {
  return newebpayConfig() ? [CHEQUE, NEWEBPAY_CREDIT] : [CHEQUE]
}

/** woocommerce_hold_stock_minutes on the old site */
export const HOLD_MINUTES = 60

const SYSTEM = { email: 'newebpay', via: 'system' as const }

export const dbStore: NotifyStore = {
  async getOrder(id) {
    const { data } = await svc().from('orders').select('id,status,total,payment_method,transaction_id,meta').eq('id', id).maybeSingle()
    return (data as any) || null
  },
  async markPaid(id, tradeNo, meta) {
    const { data, error } = await svc().rpc('newebpay_mark_paid', { p_order_id: id, p_trade_no: tradeNo, p_meta: meta })
    if (error) throw new Error(`newebpay_mark_paid: ${error.message}`)
    return data === true
  },
  async markFailed(id, meta) {
    const cur = await this.getOrder(id)
    if (!cur) return false
    const { data, error } = await svc()
      .from('orders')
      .update({ status: 'failed', meta: { ...(cur.meta || {}), newebpay: { ...(cur.meta?.newebpay || {}), ...meta } } })
      .eq('id', id)
      .eq('status', 'pending')
      .eq('transaction_id', '')
      .select('id')
    if (error) throw new Error(`markFailed: ${error.message}`)
    return (data || []).length === 1
  },
  async addNote(orderId, content) {
    await svc().from('order_notes').insert({ order_id: orderId, content, is_customer_note: false, added_by: 'system' })
  },
  async audit(action, orderId, before, after) {
    await auditLog(SYSTEM, action, 'order', orderId, before, after)
  },
  async recordTxn(row) {
    const { error } = await svc().from('payment_transactions').insert({ gateway: 'newebpay', source: 'notify', ...row })
    if (error) console.error('[newebpay] txn log', error.message)
  },
}

/** public origin of this request (works on *.vercel.app now and on kcasa.pro after the domain switch) */
export function originOf(req: Request): string {
  const h = req.headers
  const host = (h.get('x-forwarded-host') || h.get('host') || '').split(',')[0].trim()
  const proto = (h.get('x-forwarded-proto') || 'https').split(',')[0].trim()
  if (host && /^[a-z0-9.-]+(:\d+)?$/i.test(host)) return `${proto === 'http' ? 'http' : 'https'}://${host}`
  return new URL(req.url).origin
}

/** HTML page that POSTs the signed MPG form to NewebPay */
export function payFormHtml(cfg: NewebpayConfig, order: any, origin: string): string {
  const received = `${origin}/checkout/order-received/${order.id}/?key=${encodeURIComponent(order.order_key)}`
  const f = buildMpgForm(cfg, {
    orderId: order.id,
    amount: Number(order.total),
    itemDesc: `Kcasa 工富家飾 訂單 #${order.order_number || order.id}`,
    email: order.billing?.email || '',
    notifyUrl: `${origin}/api/newebpay/notify`,
    returnUrl: `${origin}/api/newebpay/return`,
    clientBackUrl: received,
  })
  const inputs = Object.entries(f)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join('')
  return `<!doctype html><html lang="zh-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>前往藍新金流付款…</title></head>
<body style="font-family:sans-serif;text-align:center;padding:48px 16px">
<form id="np" method="post" action="${esc(cfg.gateway)}">${inputs}<p>正在前往藍新金流付款頁面…</p><noscript><button type="submit">前往付款</button></noscript></form>
<script>document.getElementById('np').submit()</script></body></html>`
}

/**
 * WooCommerce cancels unpaid checkout orders after woocommerce_hold_stock_minutes (60). Only NewebPay orders
 * qualify here (領取報價 orders stay pending for manual follow-up). NewebPay orders do not reduce stock until
 * paid, so cancelling restores nothing — same as WooCommerce, which only reduces stock on payment.
 */
export async function cancelUnpaidNewebpayOrders(): Promise<number> {
  const cutoff = new Date(Date.now() - HOLD_MINUTES * 60_000).toISOString()
  const { data } = await svc()
    .from('orders')
    .update({ status: 'cancelled' })
    .eq('payment_method', GATEWAY_ID)
    .eq('status', 'pending')
    .eq('transaction_id', '')
    .eq('created_via', 'checkout')
    .lt('created_at', cutoff)
    .select('id')
  const ids = (data || []).map((r: any) => r.id)
  for (const id of ids) {
    await svc().from('order_notes').insert({ order_id: id, content: '未付款訂單已取消 - 已達付款時限。訂單狀態已從「等待付款中」變更為「已取消」。', is_customer_note: false, added_by: 'system' })
    await auditLog(SYSTEM, 'order.status', 'order', id, { status: 'pending' }, { status: 'cancelled', reason: `unpaid after ${HOLD_MINUTES} minutes` })
  }
  return ids.length
}

export function isExpired(order: any): boolean {
  return Date.now() - new Date(order.created_at).getTime() > HOLD_MINUTES * 60_000
}
