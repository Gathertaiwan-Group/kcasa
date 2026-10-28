/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from 'next/link'
import { Badge, money, Notice, Pager, sp1, type SP } from '@/components/admin/ui'
import { twDateTime } from '@/lib/admin/core'
import { listOrders, ORDER_STATUSES, orderStatusCounts } from '@/lib/admin/shop'
import { requireAdmin } from '@/lib/admin/session'
import { cancelUnpaidNewebpayOrders } from '@/lib/newebpay'

export const metadata = { title: '訂單' }

export default async function Orders({ searchParams }: { searchParams: SP }) {
  await requireAdmin('orders')
  await cancelUnpaidNewebpayOrders().catch(() => 0) // 60-minute unpaid hold, like WooCommerce
  const q = await searchParams
  const status = sp1(q.status)
  const search = sp1(q.s)
  const offset = Number(sp1(q.offset) || 0)
  const limit = 30
  const [{ rows, total }, counts] = await Promise.all([listOrders({ status, search, offset, limit }), orderStatusCounts()])
  return (
    <>
      <h1>訂單</h1>
      <Notice q={q} />
      <div className="tabs">
        <Link href="/admin/orders/" className={!status ? 'on' : ''}>全部</Link>
        {Object.entries(ORDER_STATUSES).filter(([k]) => counts[k]).map(([k, l]) => (
          <Link key={k} href={`/admin/orders/?status=${k}`} className={status === k ? 'on' : ''}>| {l} ({counts[k]})</Link>
        ))}
      </div>
      <form className="toolbar" action="/admin/orders/">
        {status && <input type="hidden" name="status" value={status} />}
        <input type="search" name="s" defaultValue={search} placeholder="訂單編號 / Email / 姓名 / 電話" />
        <button type="submit">搜尋</button>
      </form>
      <table className="list">
        <thead><tr><th>訂單</th><th>日期</th><th>狀態</th><th>付款方式</th><th className="num">總計</th></tr></thead>
        <tbody>
          {rows.map((o: any) => (
            <tr key={o.id}>
              <td><Link href={`/admin/orders/${o.id}/`}><strong>#{o.order_number || o.id} {o.billing?.last_name}{o.billing?.first_name}</strong></Link><div className="row-actions">{o.billing?.email}</div></td>
              <td className="small">{twDateTime(o.created_at)}</td>
              <td><Badge s={o.status} label={ORDER_STATUSES[o.status]} /></td>
              <td className="small">{o.payment_method_title || '—'}</td>
              <td className="num">{money(o.total)}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={5} className="muted">尚無訂單。舊站訂單會在資料庫備份匯入後出現；新訂單由前台結帳建立（狀態「等待付款中」）。</td></tr>}
        </tbody>
      </table>
      <Pager base="/admin/orders/" params={{ status, s: search }} total={total} offset={offset} limit={limit} />
    </>
  )
}
