/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from 'next/link'
import { orderAddressAction, orderNoteAction, orderStatusAction } from '../../../actions'
import { Badge, money, Notice, type SP } from '@/components/admin/ui'
import { twDateTime } from '@/lib/admin/core'
import { getOrder, ORDER_STATUSES } from '@/lib/admin/shop'
import { requireAdmin } from '@/lib/admin/session'
import { idParam, orNotFound } from '@/lib/admin/notfound'

export const metadata = { title: '訂單明細' }
const ADDR: [string, string][] = [['last_name', '姓'], ['first_name', '名'], ['company', '公司'], ['address_1', '地址'], ['address_2', '地址 2'], ['city', '鄉鎮市區'], ['state', '縣市'], ['postcode', '郵遞區號'], ['country', '國家'], ['phone', '電話'], ['email', 'Email']]

function AddrFields({ prefix, v }: { prefix: string; v: Record<string, string> }) {
  return (
    <div className="grid-cols" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))' }}>
      {ADDR.filter(([k]) => prefix === 'billing' || !['email'].includes(k)).map(([k, l]) => (
        <div key={k}>
          <label>{l}</label>
          <input type="text" name={`${prefix}_${k}`} defaultValue={v?.[k] || ''} className="w100" />
        </div>
      ))}
    </div>
  )
}

export default async function OrderDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  await requireAdmin('orders')
  const { id } = await params
  const q = await searchParams
  const o = await orNotFound(getOrder(idParam(id)))
  const lines = o.items.filter((i: any) => i.item_type === 'line_item')
  const others = o.items.filter((i: any) => i.item_type !== 'line_item')
  return (
    <>
      <h1>
        訂單 #{o.order_number || o.id} <Badge s={o.status} label={ORDER_STATUSES[o.status]} />
        <Link className="btn" href="/admin/orders/">返回列表</Link>
      </h1>
      <Notice q={q} />
      <div className="grid2">
        <div>
          <div className="card">
            <dl className="kv">
              <dt>建立時間</dt><dd>{twDateTime(o.created_at)}（{o.created_via}）</dd>
              <dt>付款方式</dt><dd>{o.payment_method_title || o.payment_method || '—'} {o.transaction_id && `· 交易編號 ${o.transaction_id}`}</dd>
              <dt>付款時間</dt><dd>{twDateTime(o.paid_at)}</dd>
              <dt>完成時間</dt><dd>{twDateTime(o.completed_at)}</dd>
              <dt>顧客</dt><dd>{o.customer ? <Link href={`/admin/customers/${o.customer.id}/`}>{o.customer.display_name || o.customer.email}</Link> : '訪客'}</dd>
              <dt>運送方式</dt><dd>{o.shipping_method || '—'}</dd>
              <dt>優惠券</dt><dd>{(o.coupon_codes || []).join(', ') || '—'}</dd>
              <dt>顧客備註</dt><dd>{o.customer_note || '—'}</dd>
            </dl>
          </div>
          <div className="card">
            <h2>商品</h2>
            <table className="list">
              <thead><tr><th>項目</th><th className="num">單價</th><th className="num">數量</th><th className="num">小計</th></tr></thead>
              <tbody>
                {lines.map((i: any) => (
                  <tr key={i.id}>
                    <td>
                      {i.product_id ? <Link href={`/admin/products/${i.product_id}/`}>{i.name}</Link> : i.name}
                      <div className="row-actions">{i.sku && `SKU ${i.sku}`} {i.variation_id ? `· 變體 #${i.variation_id}` : ''} {Object.entries(i.meta?.attributes || {}).map(([k, v]) => `${k}: ${v}`).join(' / ')}</div>
                    </td>
                    <td className="num">{money(i.quantity ? Number(i.subtotal) / i.quantity : i.subtotal)}</td>
                    <td className="num">× {i.quantity}</td>
                    <td className="num">{money(i.total)}</td>
                  </tr>
                ))}
                {others.map((i: any) => (
                  <tr key={i.id}><td className="muted">{i.item_type === 'shipping' ? '運費' : i.item_type === 'coupon' ? '優惠券' : i.item_type === 'fee' ? '手續費' : i.item_type}：{i.name}</td><td></td><td></td><td className="num">{money(i.total)}</td></tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td colSpan={3} className="num">商品小計</td><td className="num">{money(o.subtotal)}</td></tr>
                {Number(o.discount_total) > 0 && <tr><td colSpan={3} className="num">折扣</td><td className="num">-{money(o.discount_total)}</td></tr>}
                <tr><td colSpan={3} className="num">運費</td><td className="num">{money(o.shipping_total)}</td></tr>
                {Number(o.fee_total) > 0 && <tr><td colSpan={3} className="num">手續費</td><td className="num">{money(o.fee_total)}</td></tr>}
                <tr><td colSpan={3} className="num"><strong>訂單總計</strong></td><td className="num"><strong>{money(o.total)}</strong></td></tr>
                {o.refunds.map((r: any) => <tr key={r.id}><td colSpan={3} className="num">退款 {twDateTime(r.created_at)} {r.reason}</td><td className="num">-{money(r.amount)}</td></tr>)}
              </tfoot>
            </table>
          </div>
          <form className="card" action={orderAddressAction}>
            <input type="hidden" name="id" value={o.id} />
            <h2>帳單資料</h2>
            <AddrFields prefix="billing" v={o.billing} />
            <h2 style={{ marginTop: 16 }}>運送資料</h2>
            <AddrFields prefix="shipping" v={o.shipping} />
            <label>顧客備註</label>
            <textarea name="customer_note" defaultValue={o.customer_note} />
            <p><button type="submit">儲存地址資料</button></p>
          </form>
        </div>
        <div>
          <form className="card" action={orderStatusAction}>
            <input type="hidden" name="id" value={o.id} />
            <h3>訂單狀態</h3>
            <select name="status" defaultValue={o.status} className="w100">
              {Object.entries(ORDER_STATUSES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <label>備註（選填）</label>
            <input type="text" name="note" className="w100" />
            <p><button type="submit" className="primary">更新訂單</button></p>
            <p className="small muted">本站未串接金流：結帳只建立「等待付款中」訂單，收款後請手動改為「處理中」。</p>
          </form>
          <div className="card">
            <h3>訂單備註</h3>
            <form action={orderNoteAction}>
              <input type="hidden" name="id" value={o.id} />
              <textarea name="content" required placeholder="新增備註" />
              <label className="inline"><input type="checkbox" name="is_customer_note" /> 給顧客的備註</label>
              <p><button type="submit">新增</button></p>
            </form>
            {o.notes.map((n: any) => (
              <div key={n.id} style={{ background: n.is_customer_note ? '#a7cedc33' : '#f6f7f7', padding: '6px 8px', margin: '6px 0', borderRadius: 3 }}>
                <div className="small">{n.content}</div>
                <div className="small muted">{twDateTime(n.created_at)} · {n.added_by || 'system'}{n.is_customer_note ? ' · 給顧客' : ''}</div>
              </div>
            ))}
          </div>
          <p className="small"><Link href={`/admin/audit/?entity_type=order&entity_id=${o.id}`}>此訂單的稽核紀錄 →</Link></p>
        </div>
      </div>
    </>
  )
}
