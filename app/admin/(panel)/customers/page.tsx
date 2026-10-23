/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from 'next/link'
import { money, Notice, Pager, sp1, type SP } from '@/components/admin/ui'
import { twDateTime } from '@/lib/admin/core'
import { listCustomers } from '@/lib/admin/shop'
import { requireAdmin } from '@/lib/admin/session'

export const metadata = { title: '顧客' }

export default async function Customers({ searchParams }: { searchParams: SP }) {
  await requireAdmin('orders')
  const q = await searchParams
  const search = sp1(q.s)
  const offset = Number(sp1(q.offset) || 0)
  const limit = 30
  const { rows, total } = await listCustomers({ search, offset, limit })
  return (
    <>
      <h1>顧客</h1>
      <Notice q={q} />
      <form className="toolbar" action="/admin/customers/">
        <input type="search" name="s" defaultValue={search} placeholder="Email / 姓名" />
        <button type="submit">搜尋</button>
      </form>
      <table className="list">
        <thead><tr><th>姓名</th><th>Email</th><th>電話</th><th className="num">訂單數</th><th className="num">消費總額</th><th>註冊時間</th></tr></thead>
        <tbody>
          {rows.map((c: any) => (
            <tr key={c.id}>
              <td><Link href={`/admin/customers/${c.id}/`}><strong>{c.display_name || `${c.last_name}${c.first_name}` || '—'}</strong></Link></td>
              <td>{c.email}</td>
              <td className="small">{c.billing?.phone || '—'}</td>
              <td className="num">{c.orders_count}</td>
              <td className="num">{money(c.total_spent)}</td>
              <td className="small">{twDateTime(c.registered_at)}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={6} className="muted">尚無顧客。舊站顧客會在資料庫備份匯入後出現。</td></tr>}
        </tbody>
      </table>
      <Pager base="/admin/customers/" params={{ s: search }} total={total} offset={offset} limit={limit} />
    </>
  )
}
