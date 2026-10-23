/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from 'next/link'
import { saveCustomerAction } from '../../../actions'
import { Badge, money, Notice, type SP } from '@/components/admin/ui'
import { twDateTime } from '@/lib/admin/core'
import { getCustomer, ORDER_STATUSES } from '@/lib/admin/shop'
import { requireAdmin } from '@/lib/admin/session'

export const metadata = { title: '顧客資料' }
const ADDR: [string, string][] = [['last_name', '姓'], ['first_name', '名'], ['company', '公司'], ['address_1', '地址'], ['address_2', '地址 2'], ['city', '鄉鎮市區'], ['state', '縣市'], ['postcode', '郵遞區號'], ['country', '國家'], ['phone', '電話'], ['email', 'Email']]

export default async function CustomerDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  await requireAdmin('orders')
  const { id } = await params
  const q = await searchParams
  const c = await getCustomer(Number(id))
  return (
    <>
      <h1>{c.display_name || c.email} <Link className="btn" href="/admin/customers/">返回列表</Link></h1>
      <Notice q={q} />
      <div className="grid2">
        <form className="card" action={saveCustomerAction}>
          <input type="hidden" name="id" value={c.id} />
          <div className="grid-cols">
            <div><label>顯示名稱</label><input type="text" name="display_name" defaultValue={c.display_name} className="w100" /></div>
            <div><label>姓</label><input type="text" name="last_name" defaultValue={c.last_name} className="w100" /></div>
            <div><label>名</label><input type="text" name="first_name" defaultValue={c.first_name} className="w100" /></div>
            <div><label>Email</label><input type="email" name="email" defaultValue={c.email} className="w100" /></div>
          </div>
          {(['billing', 'shipping'] as const).map((p) => (
            <div key={p}>
              <h2 style={{ marginTop: 16 }}>{p === 'billing' ? '帳單地址' : '運送地址'}</h2>
              <div className="grid-cols" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))' }}>
                {ADDR.filter(([k]) => p === 'billing' || k !== 'email').map(([k, l]) => (
                  <div key={k}><label>{l}</label><input type="text" name={`${p}_${k}`} defaultValue={c[p]?.[k] || ''} className="w100" /></div>
                ))}
              </div>
            </div>
          ))}
          <p><button type="submit" className="primary">儲存顧客資料</button></p>
        </form>
        <div className="card">
          <dl className="kv">
            <dt>顧客 ID</dt><dd>#{c.id}</dd>
            <dt>帳號</dt><dd>{c.username || '—'}</dd>
            <dt>註冊</dt><dd>{twDateTime(c.registered_at)}</dd>
            <dt>訂單數</dt><dd>{c.orders_count}</dd>
            <dt>消費總額</dt><dd>{money(c.total_spent)}</dd>
            <dt>已登入帳號</dt><dd>{c.auth_user_id ? '是' : '否'}</dd>
          </dl>
          <h3 style={{ marginTop: 12 }}>訂單</h3>
          {c.orders.map((o: any) => (
            <div key={o.id} className="small"><Link href={`/admin/orders/${o.id}/`}>#{o.id}</Link> {twDateTime(o.created_at)} <Badge s={o.status} label={ORDER_STATUSES[o.status]} /> {money(o.total)}</div>
          ))}
          {!c.orders.length && <p className="muted small">尚無訂單。</p>}
        </div>
      </div>
    </>
  )
}
