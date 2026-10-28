// node --test tests/  (Node ≥22.18 strips TypeScript types natively)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildMpgForm, buildQuery, decryptTradeInfo, encryptTradeInfo, handleNotify, isProductionHost, isValidMerchantOrderNo, merchantOrderNo, orderIdFrom, parseCallback, resolveConfig, tradeSha, verifyTradeSha,
} from '../src/lib/newebpay/core.ts'

// NewebPay MPG technical document example (HashKey / HashIV / TradeInfo / TradeSha)
const OFFICIAL = { merchantId: '3430112', hashKey: '12345678901234567890123456789012', hashIv: '1234567890123456' }
const OFFICIAL_PLAIN = 'MerchantID=3430112&RespondType=JSON&TimeStamp=1485232229&Version=1.4&MerchantOrderNo=S_1485232229&Amt=40&ItemDesc=UnitTest'
const OFFICIAL_CT = 'ff91c8aa01379e4de621a44e5f11f72e4d25bdb1a18242db6cef9ef07d80b0165e476fd1d9acaa53170272c82d122961e1a0700a7427cfa1cf90db7f6d6593bbc93102a4d4b9b66d9974c13c31a7ab4bba1d4e0790f0cbbbd7ad64c6d3c8012a601ceaa808bff70f94a8efa5a4f984b9d41304ffd879612177c622f75f4214fa'
const OFFICIAL_SHA = 'EA0A6CC37F40C1EA5692E7CBB8AE097653DF3E91365E6A9CD7E91312413C7BB8'

// self-made test keys; expected values computed independently with `openssl enc -aes-256-cbc -nopad` + `shasum -a 256`
const K = { merchantId: 'MS0000001', hashKey: 'abcdefghijklmnopqrstuvwxyz012345', hashIv: 'ABCDEFGHIJKLMNOP' }
const CUSTOM_PLAIN = 'MerchantID=MS0000001&Amt=1280&MerchantOrderNo=KC123'
const CUSTOM_CT = '6157ba9c6b2cbe1eabe12eac633421f9b23f9335400cff6f88d81b7ccdbdff916ded777bb68d16870d09ee98e7a0542e1696b76208b33f6e95c3b26c7a03221f'
const CUSTOM_SHA = 'C6E9021C2BC6BB306B7B3F39DCE8F1F13084F000BF15A23E2E8F40C0076B3792'

test('official vector: encrypt / decrypt / TradeSha', () => {
  assert.equal(encryptTradeInfo(OFFICIAL_PLAIN, OFFICIAL), OFFICIAL_CT)
  assert.equal(decryptTradeInfo(OFFICIAL_CT, OFFICIAL), OFFICIAL_PLAIN)
  assert.equal(tradeSha(OFFICIAL_CT, OFFICIAL), OFFICIAL_SHA)
})

test('custom-key vector (openssl): encrypt / decrypt / TradeSha', () => {
  assert.equal(encryptTradeInfo(CUSTOM_PLAIN, K), CUSTOM_CT)
  assert.equal(decryptTradeInfo(CUSTOM_CT, K), CUSTOM_PLAIN)
  assert.equal(tradeSha(CUSTOM_CT, K), CUSTOM_SHA)
  assert.ok(verifyTradeSha(CUSTOM_CT, CUSTOM_SHA.toLowerCase(), K))
  assert.ok(!verifyTradeSha(CUSTOM_CT, CUSTOM_SHA.replace(/^C/, 'D'), K))
})

test('decrypt rejects tampered ciphertext / wrong key', () => {
  assert.throws(() => decryptTradeInfo(CUSTOM_CT.slice(0, -2), K))
  assert.throws(() => decryptTradeInfo('zz' + CUSTOM_CT.slice(2), K))
  assert.throws(() => decryptTradeInfo(CUSTOM_CT, { ...K, hashKey: 'X'.repeat(32) }))
})

test('MPG form round-trips and carries server amount', () => {
  const f = buildMpgForm(K, { merchantOrderNo: 'KC7', amount: 1280, itemDesc: 'x', email: 'a@b.c', notifyUrl: 'https://s/n', returnUrl: 'https://s/r', clientBackUrl: 'https://s/b', timestamp: 1 })
  assert.equal(f.TradeSha, tradeSha(f.TradeInfo, K))
  const q = new URLSearchParams(decryptTradeInfo(f.TradeInfo, K))
  assert.equal(q.get('Amt'), '1280')
  assert.equal(q.get('MerchantOrderNo'), 'KC7')
  assert.equal(q.get('CREDIT'), '1')
  assert.throws(() => buildMpgForm(K, { merchantOrderNo: 'KC7', amount: 12.5, itemDesc: 'x', email: '', notifyUrl: '', returnUrl: '', clientBackUrl: '' }))
})

// ---------------------------------------------------------------- notify handling with an in-memory store
function notifyBody(keys, { status = 'SUCCESS', amt = 1280, mon = 'KC123', tradeNo = '24102812345678', merchant = keys.merchantId } = {}) {
  const payload = JSON.stringify({ Status: status, Message: status === 'SUCCESS' ? '授權成功' : '授權失敗', Result: { MerchantID: merchant, Amt: amt, TradeNo: tradeNo, MerchantOrderNo: mon, PaymentType: 'CREDIT', PayTime: '2026-10-28 12:00:00', RespondCode: '00', Auth: '123456', Card6No: '400022', Card4No: '1111' } })
  const TradeInfo = encryptTradeInfo(payload, keys)
  return { Status: status, MerchantID: merchant, Version: '2.0', TradeInfo, TradeSha: tradeSha(TradeInfo, keys) }
}

function memStore(order, attempts = []) {
  const s = { order: { ...order }, stockReduced: 0, notes: [], audits: [], txns: [], attempts: new Map(attempts.map((m) => [m, order.id])) }
  s.api = {
    async getOrder(id) { return id === s.order.id ? { ...s.order } : null },
    async isOrderNo(id, mon) { return s.attempts.get(mon) === id },
    async markPaid(id, tradeNo, meta) {
      const o = s.order
      if (id !== o.id || !['pending', 'failed', 'cancelled'].includes(o.status) || o.transaction_id || o.meta.stock_reduced) return false
      Object.assign(o, { status: 'processing', transaction_id: tradeNo, meta: { ...o.meta, stock_reduced: true, newebpay: { ...o.meta.newebpay, ...meta } } })
      s.stockReduced += 1
      return true
    },
    async markFailed(id) {
      if (s.order.status !== 'pending' || s.order.transaction_id) return false
      s.order.status = 'failed'
      return true
    },
    async addNote(_id, c) { s.notes.push(c) },
    async audit(a) { s.audits.push(a) },
    async recordTxn(r) { s.txns.push(r.outcome) },
  }
  return s
}
const ORDER = { id: 123, status: 'pending', total: '1280.00', payment_method: 'ry_newebpay_credit', transaction_id: '', meta: { newebpay: { merchant_order_no: 'KC123' } } }

test('valid notify marks paid once; re-sent notify is a no-op (idempotent)', async () => {
  const s = memStore(ORDER)
  const body = notifyBody(K)
  const r1 = await handleNotify(body, K, s.api)
  assert.equal(r1.outcome, 'paid'); assert.equal(r1.httpStatus, 200)
  assert.equal(s.order.status, 'processing'); assert.equal(s.order.transaction_id, '24102812345678')
  const r2 = await handleNotify(body, K, s.api)
  const r3 = await handleNotify(body, K, s.api)
  assert.equal(r2.outcome, 'duplicate'); assert.equal(r3.outcome, 'duplicate')
  assert.equal(s.stockReduced, 1)
  assert.equal(s.notes.length, 1)
  assert.deepEqual(s.audits, ['order.payment'])
})

test('concurrent duplicate notifies reduce stock once', async () => {
  const s = memStore(ORDER)
  const body = notifyBody(K)
  const rs = await Promise.all([1, 2, 3, 4].map(() => handleNotify(body, K, s.api)))
  assert.equal(rs.filter((r) => r.outcome === 'paid').length, 1)
  assert.equal(s.stockReduced, 1)
})

test('bad signature is rejected and changes nothing', async () => {
  const s = memStore(ORDER)
  const body = notifyBody(K)
  const r = await handleNotify({ ...body, TradeSha: tradeSha(body.TradeInfo, K).replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')) }, K, s.api)
  assert.equal(r.outcome, 'rejected'); assert.equal(r.reason, 'bad_signature'); assert.equal(r.httpStatus, 400)
  // payload signed with a different key (forged) is rejected too
  const forged = notifyBody({ ...K, hashKey: 'Z'.repeat(32) })
  assert.equal((await handleNotify(forged, K, s.api)).reason, 'bad_signature')
  assert.equal(s.order.status, 'pending'); assert.equal(s.stockReduced, 0)
})

test('amount mismatch is rejected, noted and audited', async () => {
  const s = memStore(ORDER)
  const r = await handleNotify(notifyBody(K, { amt: 1 }), K, s.api)
  assert.equal(r.reason, 'amount_mismatch'); assert.equal(r.httpStatus, 400)
  assert.equal(s.order.status, 'pending'); assert.equal(s.stockReduced, 0)
  assert.equal(s.notes.length, 1); assert.deepEqual(s.audits, ['order.payment.reject'])
})

test('unknown order number / other merchant are rejected', async () => {
  const s = memStore(ORDER)
  assert.equal((await handleNotify(notifyBody(K, { mon: 'KC999' }), K, s.api)).reason, 'unknown_order')
  assert.equal((await handleNotify(notifyBody(K, { merchant: 'OTHER01' }), K, s.api)).reason, 'merchant_mismatch')
  const cheque = memStore({ ...ORDER, payment_method: 'cheque' })
  assert.equal((await handleNotify(notifyBody(K), K, cheque.api)).reason, 'unknown_order')
  assert.equal(s.order.status, 'pending'); assert.equal(cheque.order.status, 'pending')
})

test('failed payment → failed once; later duplicates ignored; paid order never downgraded', async () => {
  const s = memStore(ORDER)
  const fail = notifyBody(K, { status: 'MPG03008', tradeNo: '' })
  assert.equal((await handleNotify(fail, K, s.api)).outcome, 'failed')
  assert.equal(s.order.status, 'failed')
  assert.equal((await handleNotify(fail, K, s.api)).outcome, 'ignored')
  assert.equal(s.notes.length, 1)
  const p = memStore(ORDER)
  await handleNotify(notifyBody(K), K, p.api)
  assert.equal((await handleNotify(fail, K, p.api)).outcome, 'ignored')
  assert.equal(p.order.status, 'processing')
})

test('parseCallback: missing fields', () => {
  assert.deepEqual(parseCallback({}, K), { ok: false, reason: 'missing_fields' })
  assert.equal(buildQuery({ a: 'x y', b: 1 }), 'a=x+y&b=1')
})

// ---------------------------------------------------------------- MerchantOrderNo per attempt
test('MerchantOrderNo: unique per attempt, ≤30 chars, letters/digits/underscore only', () => {
  const nos = [1, 2, 3, 20].map((n) => merchantOrderNo(123, n))
  assert.deepEqual(nos, ['KC123_1', 'KC123_2', 'KC123_3', 'KC123_20'])
  assert.equal(new Set(nos).size, nos.length)
  const longest = merchantOrderNo(999999999999999, 9999)
  assert.ok(longest.length <= 30, longest)
  for (const m of [...nos, longest]) assert.match(m, /^[A-Za-z0-9_]{1,30}$/)
  assert.throws(() => merchantOrderNo(123, 0)); assert.throws(() => merchantOrderNo(123, 10000)); assert.throws(() => merchantOrderNo(0, 1))
})

test('orderIdFrom: new KC<id>_<n> and legacy KC<id> both map to the order; junk does not', () => {
  assert.equal(orderIdFrom('KC123_2'), 123)
  assert.equal(orderIdFrom('KC123'), 123) // legacy format still accepted
  for (const bad of ['', 'KC', 'KC_1', 'KCabc', 'XX123', 'KC123_', 'KC123_1_2', 'KC123-1', 'KC123_12345', 'kc123', 'KC' + '9'.repeat(16)]) {
    assert.equal(orderIdFrom(bad), null, bad); assert.equal(isValidMerchantOrderNo(bad), false, bad)
  }
})

test('MPG form carries the attempt number and a clamped TradeLimit', () => {
  const base = { amount: 1280, itemDesc: 'x', email: '', notifyUrl: 'https://s/n', returnUrl: 'https://s/r', clientBackUrl: 'https://s/b', timestamp: 1 }
  const q = (f) => new URLSearchParams(decryptTradeInfo(f.TradeInfo, K))
  assert.equal(q(buildMpgForm(K, { ...base, merchantOrderNo: 'KC7_3', tradeLimit: 3599 })).get('MerchantOrderNo'), 'KC7_3')
  assert.equal(q(buildMpgForm(K, { ...base, merchantOrderNo: 'KC7_3', tradeLimit: 3599 })).get('TradeLimit'), '900')
  assert.equal(q(buildMpgForm(K, { ...base, merchantOrderNo: 'KC7_3', tradeLimit: 75 })).get('TradeLimit'), '75')
  assert.equal(q(buildMpgForm(K, { ...base, merchantOrderNo: 'KC7_3', tradeLimit: 5 })).get('TradeLimit'), '60')
  assert.throws(() => buildMpgForm(K, { ...base, merchantOrderNo: 'KC7-3' }))
})

test('notify: a re-pay attempt number (KC<id>_<n>) issued for the order is accepted; one never issued is rejected', async () => {
  const s = memStore({ ...ORDER, meta: { newebpay: { merchant_order_no: 'KC123_2' } } }, ['KC123_1', 'KC123_2'])
  // first attempt's late notify (meta already points at attempt 2) still maps through newebpay_attempts
  const r = await handleNotify(notifyBody(K, { mon: 'KC123_1' }), K, s.api)
  assert.equal(r.outcome, 'paid'); assert.equal(s.order.status, 'processing')
  const s2 = memStore({ ...ORDER, meta: { newebpay: { merchant_order_no: 'KC123_2' } } }, ['KC123_1', 'KC123_2'])
  assert.equal((await handleNotify(notifyBody(K, { mon: 'KC123_3' }), K, s2.api)).reason, 'unknown_order')
  // another order's attempt number must not pay this order
  const s3 = memStore(ORDER, ['KC123_1'])
  s3.attempts.set('KC124_1', 124)
  assert.equal((await handleNotify(notifyBody(K, { mon: 'KC124_1' }), K, s3.api)).reason, 'unknown_order')
  assert.equal(s2.order.status, 'pending'); assert.equal(s3.order.status, 'pending')
})

test('notify: legacy KC<id> order (pre-attempt) still accepted', async () => {
  const s = memStore(ORDER) // meta.newebpay.merchant_order_no = 'KC123', no attempts rows
  assert.equal((await handleNotify(notifyBody(K, { mon: 'KC123' }), K, s.api)).outcome, 'paid')
})

// ---------------------------------------------------------------- NEWEBPAY_ENV=test on the live domain
test('test-mode keys are refused on kcasa.pro (fail closed), allowed elsewhere; production keys work everywhere', () => {
  const env = { NEWEBPAY_ENV: 'test', NEWEBPAY_MERCHANT_ID: K.merchantId, NEWEBPAY_HASH_KEY: K.hashKey, NEWEBPAY_HASH_IV: K.hashIv }
  for (const h of ['kcasa.pro', 'www.kcasa.pro', 'KCASA.PRO', 'kcasa.pro:443', 'kcasa.pro.']) {
    assert.ok(isProductionHost(h), h)
    assert.deepEqual(resolveConfig(env, h), { cfg: null, blocked: true })
  }
  const ok = resolveConfig(env, 'kcasa.vercel.app')
  assert.equal(ok.blocked, false); assert.equal(ok.cfg.env, 'test'); assert.match(ok.cfg.gateway, /ccore\.newebpay\.com/)
  assert.ok(!isProductionHost('kcasa.pro.evil.com')); assert.ok(!isProductionHost('notkcasa.pro'))
  const prod = resolveConfig({ ...env, NEWEBPAY_ENV: 'production' }, 'kcasa.pro')
  assert.equal(prod.cfg.env, 'production'); assert.match(prod.cfg.gateway, /\/\/core\.newebpay\.com/)
  assert.deepEqual(resolveConfig({}, 'kcasa.pro'), { cfg: null, blocked: false })
})
