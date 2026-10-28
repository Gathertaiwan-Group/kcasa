/**
 * NewebPay (藍新金流) MPG — pure logic with no app imports, so it runs both inside Next.js and directly
 * under `node --test` (tests/newebpay.test.mjs).
 *
 *  - TradeInfo = hex(AES-256-CBC(urlencoded params)), padded to 32-byte blocks like NewebPay's PHP sample
 *  - TradeSha  = upper(SHA256("HashKey=<key>&<TradeInfo>&HashIV=<iv>"))
 *  - handleNotify(): signature → decrypt → order / merchant / amount checks → idempotent state change
 */
import { createCipheriv, createDecipheriv, createHash, timingSafeEqual } from 'node:crypto'

export type NewebpayKeys = { merchantId: string; hashKey: string; hashIv: string }

export const GATEWAY_ID = 'ry_newebpay_credit'
export const ORDER_PREFIX = 'KC'

export function validKeys(k: Partial<NewebpayKeys> | null | undefined): k is NewebpayKeys {
  return !!k && typeof k.merchantId === 'string' && /^[A-Za-z0-9_]{1,20}$/.test(k.merchantId) && typeof k.hashKey === 'string' && k.hashKey.length === 32 && typeof k.hashIv === 'string' && k.hashIv.length === 16
}

/** the live shop domain(s): a NewebPay *test* configuration must never take orders there */
export const PRODUCTION_HOSTS = ['kcasa.pro', 'www.kcasa.pro']
export function isProductionHost(host: string | null | undefined): boolean {
  const h = String(host || '').trim().toLowerCase().split(':')[0].replace(/\.$/, '')
  return PRODUCTION_HOSTS.includes(h)
}

/** running as the Vercel production deployment (reached by any host / alias, all sharing the production database) */
export function isProductionEnv(e: Record<string, string | undefined>): boolean {
  return (e.VERCEL_ENV || '').trim() === 'production'
}

export type ResolvedConfig = NewebpayKeys & { env: 'test' | 'production'; gateway: string }
/**
 * Gateway config from env for the host serving the request. `blocked` = NEWEBPAY_ENV=test in the Vercel
 * *production* environment (VERCEL_ENV=production — whatever host it is reached by, incl. *.vercel.app aliases
 * that share the production database) or on kcasa.pro: refused outright (fail closed) — the test gateway
 * approves test cards, so honouring it there would mark real orders paid with no money taken.
 * Test keys belong in the Vercel *Preview* environment only.
 */
export function resolveConfig(e: Record<string, string | undefined>, host: string | null): { cfg: ResolvedConfig | null; blocked: boolean } {
  const env = (e.NEWEBPAY_ENV || '').trim()
  const k = { merchantId: (e.NEWEBPAY_MERCHANT_ID || '').trim(), hashKey: (e.NEWEBPAY_HASH_KEY || '').trim(), hashIv: (e.NEWEBPAY_HASH_IV || '').trim() }
  if ((env !== 'test' && env !== 'production') || !validKeys(k)) return { cfg: null, blocked: false }
  if (env === 'test' && (isProductionEnv(e) || isProductionHost(host))) return { cfg: null, blocked: true }
  return { cfg: { ...k, env, gateway: env === 'production' ? 'https://core.newebpay.com/MPG/mpg_gateway' : 'https://ccore.newebpay.com/MPG/mpg_gateway' }, blocked: false }
}

export function buildQuery(params: Record<string, string | number>): string {
  return new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()
}

const BLOCK = 32

export function encryptTradeInfo(plain: string, k: NewebpayKeys): string {
  const buf = Buffer.from(plain, 'utf8')
  const pad = BLOCK - (buf.length % BLOCK)
  const padded = Buffer.concat([buf, Buffer.alloc(pad, pad)])
  const c = createCipheriv('aes-256-cbc', Buffer.from(k.hashKey, 'utf8'), Buffer.from(k.hashIv, 'utf8'))
  c.setAutoPadding(false)
  return Buffer.concat([c.update(padded), c.final()]).toString('hex')
}

export function decryptTradeInfo(hex: string, k: NewebpayKeys): string {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 32 !== 0) throw new Error('bad_ciphertext')
  const d = createDecipheriv('aes-256-cbc', Buffer.from(k.hashKey, 'utf8'), Buffer.from(k.hashIv, 'utf8'))
  d.setAutoPadding(false)
  const out = Buffer.concat([d.update(Buffer.from(hex, 'hex')), d.final()])
  const pad = out[out.length - 1]
  if (!pad || pad > BLOCK || pad > out.length) throw new Error('bad_padding')
  for (let i = out.length - pad; i < out.length; i++) if (out[i] !== pad) throw new Error('bad_padding')
  return out.subarray(0, out.length - pad).toString('utf8')
}

export function tradeSha(tradeInfoHex: string, k: NewebpayKeys): string {
  return createHash('sha256').update(`HashKey=${k.hashKey}&${tradeInfoHex}&HashIV=${k.hashIv}`).digest('hex').toUpperCase()
}

export function verifyTradeSha(tradeInfoHex: string, sha: string, k: NewebpayKeys): boolean {
  const want = Buffer.from(tradeSha(tradeInfoHex, k))
  const got = Buffer.from(String(sha || '').toUpperCase())
  return want.length === got.length && timingSafeEqual(want, got)
}

/**
 * MerchantOrderNo: one per payment attempt, `KC<id>_<n>` (NewebPay refuses a number it has already seen, so a
 * second "pay" click needs a new one). Legacy `KC<id>` (orders created before attempts existed) is still
 * accepted on Notify / Return. NewebPay limit: ≤30 chars, letters / digits / underscore.
 */
export function merchantOrderNo(orderId: number, attempt?: number): string {
  if (!Number.isSafeInteger(orderId) || orderId <= 0) throw new Error('bad_order_id')
  if (attempt === undefined) return `${ORDER_PREFIX}${orderId}`
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > 9999) throw new Error('bad_attempt')
  return `${ORDER_PREFIX}${orderId}_${attempt}`
}
const MON_RE = new RegExp(`^${ORDER_PREFIX}(\\d{1,15})(?:_(\\d{1,4}))?$`)
export function isValidMerchantOrderNo(mon: string): boolean {
  return typeof mon === 'string' && mon.length <= 30 && /^[A-Za-z0-9_]+$/.test(mon) && MON_RE.test(mon)
}
export function orderIdFrom(mon: string): number | null {
  const s = String(mon || '')
  if (!isValidMerchantOrderNo(s)) return null
  const n = Number(MON_RE.exec(s)![1])
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

/** the MPG form NewebPay expects (POST to the gateway) */
export function buildMpgForm(k: NewebpayKeys, p: { merchantOrderNo: string; amount: number; tradeLimit?: number; itemDesc: string; email: string; notifyUrl: string; returnUrl: string; clientBackUrl: string; timestamp?: number }) {
  if (!Number.isInteger(p.amount) || p.amount <= 0) throw new Error('bad_amount')
  if (!isValidMerchantOrderNo(p.merchantOrderNo)) throw new Error('bad_merchant_order_no')
  const params: Record<string, string | number> = {
    MerchantID: k.merchantId,
    RespondType: 'JSON',
    TimeStamp: p.timestamp ?? Math.floor(Date.now() / 1000),
    Version: '2.0',
    MerchantOrderNo: p.merchantOrderNo,
    Amt: p.amount,
    ItemDesc: p.itemDesc.slice(0, 50),
    Email: p.email,
    EmailModify: 0,
    LoginType: 0,
    NotifyURL: p.notifyUrl,
    ReturnURL: p.returnUrl,
    ClientBackURL: p.clientBackUrl,
    CREDIT: 1,
  }
  // seconds the NewebPay payment page stays valid (NewebPay accepts 60–900)
  if (p.tradeLimit !== undefined) params.TradeLimit = Math.max(60, Math.min(900, Math.floor(p.tradeLimit)))
  const TradeInfo = encryptTradeInfo(buildQuery(params), k)
  return { MerchantID: k.merchantId, TradeInfo, TradeSha: tradeSha(TradeInfo, k), Version: '2.0' }
}

export type CallbackData = {
  Status: string
  Message: string
  MerchantID: string
  Amt: number
  TradeNo: string
  MerchantOrderNo: string
  PaymentType: string
  PayTime: string
  Result: Record<string, unknown>
}

export type ParseResult = { ok: true; data: CallbackData } | { ok: false; reason: 'missing_fields' | 'bad_signature' | 'bad_payload' | 'merchant_mismatch' }

/** verify + decrypt a Notify / Return POST body */
export function parseCallback(form: Record<string, string | undefined>, k: NewebpayKeys): ParseResult {
  const ti = form.TradeInfo || ''
  const sha = form.TradeSha || ''
  if (!ti || !sha) return { ok: false, reason: 'missing_fields' }
  if (!verifyTradeSha(ti, sha, k)) return { ok: false, reason: 'bad_signature' }
  let plain: string
  try {
    plain = decryptTradeInfo(ti, k)
  } catch {
    return { ok: false, reason: 'bad_payload' }
  }
  let top: Record<string, unknown>
  let result: Record<string, unknown>
  try {
    top = JSON.parse(plain)
    const r = top.Result
    result = (typeof r === 'string' ? JSON.parse(r) : r || {}) as Record<string, unknown>
  } catch {
    // RespondType=String fallback
    const q = Object.fromEntries(new URLSearchParams(plain))
    top = q
    result = q
  }
  const mid = String(result.MerchantID ?? top.MerchantID ?? '')
  if (mid !== k.merchantId || (form.MerchantID && form.MerchantID !== k.merchantId)) return { ok: false, reason: 'merchant_mismatch' }
  const amt = Number(result.Amt)
  if (!Number.isFinite(amt) || !result.MerchantOrderNo) return { ok: false, reason: 'bad_payload' }
  return {
    ok: true,
    data: {
      Status: String(top.Status ?? ''),
      Message: String(top.Message ?? ''),
      MerchantID: mid,
      Amt: amt,
      TradeNo: String(result.TradeNo ?? ''),
      MerchantOrderNo: String(result.MerchantOrderNo),
      PaymentType: String(result.PaymentType ?? ''),
      PayTime: String(result.PayTime ?? ''),
      Result: result,
    },
  }
}

// ---------------------------------------------------------------- notify handling (store injected)
export type OrderRow = { id: number; status: string; total: number | string; payment_method: string; transaction_id: string; meta: Record<string, any> | null } // eslint-disable-line @typescript-eslint/no-explicit-any

export interface NotifyStore {
  getOrder(id: number): Promise<OrderRow | null>
  /** true when `mon` is a MerchantOrderNo this site issued for order `id` (newebpay_attempts) */
  isOrderNo(id: number, mon: string): Promise<boolean>
  /** atomic: change status → processing + reduce stock; true only for the call that changed the order */
  markPaid(id: number, tradeNo: string, meta: Record<string, unknown>): Promise<boolean>
  /** atomic: pending → failed and release the stock hold; true only for the call that changed the order */
  markFailed(id: number, meta: Record<string, unknown>): Promise<boolean>
  addNote(orderId: number, content: string): Promise<void>
  audit(action: string, orderId: number | null, before: unknown, after: unknown): Promise<void>
  recordTxn(row: { order_id: number | null; merchant_order_no: string | null; trade_no: string | null; status: string | null; message: string | null; amount: number | null; payment_type: string | null; outcome: string; result: Record<string, unknown> }): Promise<void>
}

const STATUS_ZH: Record<string, string> = { pending: '等待付款中', failed: '失敗', cancelled: '已取消' }

export type NotifyOutcome = { httpStatus: number; outcome: 'paid' | 'duplicate' | 'failed' | 'ignored' | 'rejected'; reason?: string; orderId?: number }

/** keep only non-sensitive, display-worthy fields from the decrypted result */
export function txnMeta(d: CallbackData): Record<string, unknown> {
  const r = d.Result
  const pick = (k: string) => (r[k] === undefined || r[k] === null || r[k] === '' ? undefined : String(r[k]))
  const m: Record<string, unknown> = {
    merchant_order_no: d.MerchantOrderNo,
    trade_no: d.TradeNo,
    status: d.Status,
    message: d.Message,
    amount: d.Amt,
    payment_type: d.PaymentType,
    pay_time: d.PayTime,
    auth_bank: pick('AuthBank'),
    respond_code: pick('RespondCode'),
    auth_code: pick('Auth'),
    card6: pick('Card6No'),
    card4: pick('Card4No'),
    eci: pick('ECI'),
    escrow_bank: pick('EscrowBank'),
    ip: pick('IP'),
  }
  for (const k of Object.keys(m)) if (m[k] === undefined) delete m[k]
  return m
}

export async function handleNotify(form: Record<string, string | undefined>, k: NewebpayKeys, store: NotifyStore): Promise<NotifyOutcome> {
  const p = parseCallback(form, k)
  if (!p.ok) return { httpStatus: 400, outcome: 'rejected', reason: p.reason }
  const d = p.data
  const meta = txnMeta(d)
  const base = { merchant_order_no: d.MerchantOrderNo, trade_no: d.TradeNo || null, status: d.Status, message: d.Message, amount: d.Amt, payment_type: d.PaymentType || null, result: meta }

  const id = orderIdFrom(d.MerchantOrderNo)
  const order = id ? await store.getOrder(id) : null
  const issued = !!order && (order.meta?.newebpay?.merchant_order_no === d.MerchantOrderNo || (await store.isOrderNo(order.id, d.MerchantOrderNo)))
  if (!order || order.payment_method !== GATEWAY_ID || !issued) {
    await store.recordTxn({ ...base, order_id: order?.id ?? null, outcome: 'rejected:unknown_order' })
    await store.audit('order.payment.reject', order?.id ?? null, null, { reason: 'unknown_order', ...meta })
    return { httpStatus: 404, outcome: 'rejected', reason: 'unknown_order' }
  }

  const expected = Number(order.total)
  if (!Number.isInteger(d.Amt) || d.Amt !== expected) {
    await store.recordTxn({ ...base, order_id: order.id, outcome: 'rejected:amount_mismatch' })
    await store.addNote(order.id, `藍新金流通知金額 NT$${d.Amt} 與訂單金額 NT$${expected} 不符，未變更訂單狀態（交易序號：${d.TradeNo || '—'}）。`)
    await store.audit('order.payment.reject', order.id, { status: order.status, total: expected }, { reason: 'amount_mismatch', ...meta })
    return { httpStatus: 400, outcome: 'rejected', reason: 'amount_mismatch', orderId: order.id }
  }

  if (d.Status === 'SUCCESS') {
    if (order.transaction_id) {
      const same = order.transaction_id === d.TradeNo
      await store.recordTxn({ ...base, order_id: order.id, outcome: 'duplicate' })
      if (!same) {
        await store.addNote(order.id, `收到另一筆藍新付款成功通知（交易序號：${d.TradeNo}），本訂單已於交易序號 ${order.transaction_id} 付款，請至藍新後台確認是否重複扣款。`)
        await store.audit('order.payment.duplicate', order.id, { transaction_id: order.transaction_id }, meta)
      }
      return { httpStatus: 200, outcome: 'duplicate', orderId: order.id }
    }
    const won = await store.markPaid(order.id, d.TradeNo, meta)
    if (!won) {
      await store.recordTxn({ ...base, order_id: order.id, outcome: 'duplicate' })
      return { httpStatus: 200, outcome: 'duplicate', orderId: order.id }
    }
    await store.recordTxn({ ...base, order_id: order.id, outcome: 'paid' })
    await store.addNote(order.id, `藍新金流付款完成（${d.PaymentType || 'CREDIT'}）。交易序號：${d.TradeNo}，付款時間：${d.PayTime || '—'}。訂單狀態已從「${STATUS_ZH[order.status] || order.status}」變更為「處理中」。`)
    await store.audit('order.payment', order.id, { status: order.status }, { status: 'processing', ...meta })
    return { httpStatus: 200, outcome: 'paid', orderId: order.id }
  }

  // payment failed (Status is an error code): pending → failed and the stock hold is released
  if (order.status !== 'pending' || order.transaction_id) {
    await store.recordTxn({ ...base, order_id: order.id, outcome: 'ignored' })
    return { httpStatus: 200, outcome: 'ignored', orderId: order.id }
  }
  const changed = await store.markFailed(order.id, meta)
  if (!changed) {
    await store.recordTxn({ ...base, order_id: order.id, outcome: 'ignored' })
    return { httpStatus: 200, outcome: 'ignored', orderId: order.id }
  }
  await store.recordTxn({ ...base, order_id: order.id, outcome: 'failed' })
  await store.addNote(order.id, `藍新金流付款失敗（${d.Status}：${d.Message}）。訂單狀態已從「等待付款中」變更為「失敗」。`)
  await store.audit('order.payment.failed', order.id, { status: order.status }, { status: 'failed', ...meta })
  return { httpStatus: 200, outcome: 'failed', orderId: order.id }
}
