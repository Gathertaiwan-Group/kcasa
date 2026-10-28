/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * NewebPay (藍新金流) MPG wiring: env config, the checkout payment-method list, the Supabase-backed
 * NotifyStore, the auto-submitting pay form, and WooCommerce-style cancellation of unpaid orders.
 * Keys come only from NEWEBPAY_MERCHANT_ID / NEWEBPAY_HASH_KEY / NEWEBPAY_HASH_IV / NEWEBPAY_ENV;
 * without them the gateway is simply not offered and checkout keeps working with 領取報價 only.
 */
import { audit as auditLog } from '../admin/core'
import { purgePublicPages } from '../page-cache'
import { svc } from '../sb'
import { invalidateSite } from '../site'
import { esc } from '../util'
import { GATEWAY_ID, buildMpgForm, isProductionEnv, isProductionHost, isValidMerchantOrderNo, resolveConfig, type NewebpayKeys, type NotifyStore } from './core'

export { GATEWAY_ID }

export type NewebpayConfig = NewebpayKeys & { env: 'test' | 'production'; gateway: string }

export { isProductionHost }

/**
 * Gateway config for the host serving this request, or null (gateway off). NEWEBPAY_ENV=test on kcasa.pro is
 * refused (core.resolveConfig): the gateway is then not offered, the pay page 404s and Notify answers 503
 * without touching any order; the misconfiguration is logged on every use and shown as a banner in the admin
 * order screens (newebpayWarning).
 */
export function newebpayConfig(host: string | null): NewebpayConfig | null {
  const { cfg, blocked } = resolveConfig(process.env, host)
  if (blocked) console.error(`[newebpay] NEWEBPAY_ENV=test in production (VERCEL_ENV=${process.env.VERCEL_ENV || '-'}, host ${host}): gateway disabled, no order will be marked paid`)
  return cfg
}

/** admin banner text (null = nothing to warn about) */
export function newebpayWarning(host: string | null): string | null {
  const env = (process.env.NEWEBPAY_ENV || '').trim()
  if (env !== 'test') return null
  if (isProductionEnv(process.env) || isProductionHost(host) || isProductionHost(new URL(process.env.SITE_URL || 'https://kcasa.pro').host))
    return '藍新金流目前是「測試模式」（NEWEBPAY_ENV=test）。正式環境（Vercel Production／kcasa.pro）已自動停用信用卡付款，測試交易不會把任何訂單標為已付款；測試金鑰請只設在 Vercel Preview 環境，正式上線請改用正式金鑰並設 NEWEBPAY_ENV=production。'
  return '藍新金流目前是「測試模式」（NEWEBPAY_ENV=test）：信用卡付款走藍新測試環境，不會真的收款。'
}

/** visitor-facing host of a route-handler request */
export function hostOf(req: Request): string | null {
  const h = req.headers
  const host = (h.get('x-forwarded-host') || h.get('host') || '').split(',')[0].trim()
  return host || null
}

export type PaymentMethod = { id: string; title: string; description: string }

/** old site (wp_options): woocommerce_cheque_settings + woocommerce_ry_newebpay_credit_settings, in woocommerce_gateway_order */
export const CHEQUE: PaymentMethod = { id: 'cheque', title: '領取報價', description: '小編會進一步與您聯繫＆報價' }
export const NEWEBPAY_CREDIT: PaymentMethod = { id: GATEWAY_ID, title: '藍新信用卡', description: '使用信用卡付款' }

export function paymentMethods(host: string | null): PaymentMethod[] {
  return newebpayConfig(host) ? [CHEQUE, NEWEBPAY_CREDIT] : [CHEQUE]
}

/** woocommerce_hold_stock_minutes on the old site */
export const HOLD_MINUTES = 60
/** flood guard: unpaid 藍新 orders allowed per IP and per e-mail inside the hold window */
export const MAX_UNPAID_PER_BUYER = 3
/** payment attempts (MerchantOrderNo) per order */
export const MAX_ATTEMPTS = 20

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
  async isOrderNo(id, mon) {
    if (!isValidMerchantOrderNo(mon)) return false
    const { data } = await svc().from('newebpay_attempts').select('order_id').eq('merchant_order_no', mon).maybeSingle()
    return !!data && Number((data as any).order_id) === id
  },
  async markFailed(id, meta) {
    const { data, error } = await svc().rpc('order_release_stock', { p_order_id: id, p_new_status: 'failed', p_meta: meta })
    if (error) throw new Error(`order_release_stock: ${error.message}`)
    return data === true
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
export function payFormHtml(cfg: NewebpayConfig, order: any, origin: string, mon: string, tradeLimit: number): string {
  const received = `${origin}/checkout/order-received/${order.id}/?key=${encodeURIComponent(order.order_key)}`
  const f = buildMpgForm(cfg, {
    merchantOrderNo: mon,
    amount: Number(order.total),
    tradeLimit,
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

export type HoldResult = { ok: true } | { ok: false; reason: 'out_of_stock' | 'too_many_unpaid' | 'no_order' | 'error'; short?: any[] }

/** reserve stock for a just-placed 藍新 order (atomic, row-locked; refuses when short or flooding) */
export async function holdStock(orderId: number): Promise<HoldResult> {
  const { data, error } = await svc().rpc('order_hold_stock', { p_order_id: orderId, p_max_unpaid: MAX_UNPAID_PER_BUYER, p_window_minutes: HOLD_MINUTES })
  if (error || !data) {
    console.error('[newebpay] order_hold_stock', error?.message)
    return { ok: false, reason: 'error' }
  }
  return data as HoldResult
}

/** a fresh MerchantOrderNo for this payment attempt, or null when the order can no longer be paid */
export async function newAttempt(orderId: number): Promise<string | null> {
  const { data, error } = await svc().rpc('newebpay_new_attempt', { p_order_id: orderId, p_max: MAX_ATTEMPTS })
  if (error) throw new Error(`newebpay_new_attempt: ${error.message}`)
  return typeof data === 'string' && isValidMerchantOrderNo(data) ? data : null
}

/**
 * Admin / MCP status change on an order with a stock hold: cancelled / failed / refunded give the stock back,
 * processing / completed / on-hold turn the hold into the final reduction (WooCommerce does the same).
 */
export async function settleHoldForStatus(orderId: number, status: string, always = false): Promise<'released' | 'converted' | null> {
  if (['cancelled', 'failed', 'refunded', 'trash'].includes(status)) {
    const { data, error } = await svc().rpc('order_release_stock', { p_order_id: orderId })
    if (error) throw new Error(`order_release_stock: ${error.message}`)
    return data === true ? 'released' : null
  }
  if (['processing', 'completed', 'on-hold'].includes(status)) {
    const { data, error } = await svc().rpc('order_convert_hold', { p_order_id: orderId, p_always: always })
    if (error) throw new Error(`order_convert_hold: ${error.message}`)
    return data === true ? 'converted' : null
  }
  return null
}

/**
 * WooCommerce cancels unpaid checkout orders after woocommerce_hold_stock_minutes (60). Only NewebPay orders
 * qualify here (領取報價 orders stay pending for manual follow-up). Cancelling releases the order's stock hold and
 * writes the order note + audit row in the same transaction (site_kcasa.newebpay_cancel_expired). The pg_cron job
 * site_kcasa_expire_holds runs the same function every 5 minutes; the app also runs it before every stock check
 * (add to cart, checkout, admin order list) so an expired hold never blocks a buyer.
 */
export async function cancelUnpaidNewebpayOrders(): Promise<number> {
  const { data, error } = await svc().rpc('newebpay_cancel_expired', { p_minutes: HOLD_MINUTES })
  if (error) {
    console.error('[newebpay] cancel_expired', error.message)
    return 0
  }
  return ((data as any[]) || []).length
}

/** run the expiry before a stock check (add to cart / checkout); refresh cached stock when anything was released */
export async function releaseExpiredHolds(): Promise<number> {
  const n = await cancelUnpaidNewebpayOrders().catch(() => 0)
  if (n > 0) {
    invalidateSite()
    await purgePublicPages().catch(() => undefined)
  }
  return n
}

/** seconds left in the 60-minute payment window */
export function secondsLeft(order: any): number {
  return Math.floor((new Date(order.created_at).getTime() + HOLD_MINUTES * 60_000 - Date.now()) / 1000)
}

export function isExpired(order: any): boolean {
  return Date.now() - new Date(order.created_at).getTime() > HOLD_MINUTES * 60_000
}
