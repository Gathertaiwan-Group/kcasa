/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from 'next/link'
import { Badge, money, Notice, type SP } from '@/components/admin/ui'
import { twDateTime } from '@/lib/admin/core'
import { ORDER_STATUSES } from '@/lib/admin/shop'
import { svc } from '@/lib/sb'

export const metadata = { title: '控制台' }

async function count(table: string, f?: (q: any) => any) {
  let q = svc().from(table).select('*', { count: 'exact', head: true })
  if (f) q = f(q)
  const r = await q
  return r.count || 0
}

export default async function Dashboard({ searchParams }: { searchParams: SP }) {
  const q = await searchParams
  const [posts, pages, products, orders, pendingOrders, subs, media, drafts] = await Promise.all([
    count('posts', (x) => x.eq('post_type', 'post').eq('status', 'publish')),
    count('posts', (x) => x.eq('post_type', 'page').eq('status', 'publish')),
    count('products', (x) => x.eq('status', 'publish')),
    count('orders'),
    count('orders', (x) => x.in('status', ['pending', 'processing', 'on-hold'])),
    count('form_submissions', (x) => x.eq('status', 'new')),
    count('media'),
    count('posts', (x) => x.in('status', ['draft', 'pending', 'future'])),
  ])
  const recentOrders = (await svc().from('orders').select('id,status,total,billing,created_at').order('created_at', { ascending: false }).limit(8)).data || []
  const recentAudit = (await svc().from('audit_log').select('id,actor,via,action,entity_type,entity_id,created_at').order('id', { ascending: false }).limit(10)).data || []
  const lowStock = (await svc().from('products').select('id,name,stock_quantity,stock_status').neq('status', 'trash').or('stock_status.eq.outofstock,and(manage_stock.eq.true,stock_quantity.lte.2)').limit(10)).data || []
  return (
    <>
      <h1>控制台</h1>
      <Notice q={q} />
      <div className="stats">
        <Link className="stat" href="/admin/content/?type=post"><b>{posts}</b>已發布文章</Link>
        <Link className="stat" href="/admin/content/?type=page"><b>{pages}</b>已發布頁面</Link>
        <Link className="stat" href="/admin/content/?type=post&status=draft"><b>{drafts}</b>草稿／排程</Link>
        <Link className="stat" href="/admin/products/"><b>{products}</b>上架商品</Link>
        <Link className="stat" href="/admin/orders/"><b>{orders}</b>訂單（待處理 {pendingOrders}）</Link>
        <Link className="stat" href="/admin/forms/"><b>{subs}</b>未讀表單</Link>
        <Link className="stat" href="/admin/media/"><b>{media}</b>媒體檔案</Link>
      </div>
      <div className="grid2">
        <div>
          <div className="card">
            <h2>最新訂單</h2>
            {recentOrders.length ? (
              <table className="list">
                <tbody>
                  {recentOrders.map((o: any) => (
                    <tr key={o.id}>
                      <td><Link href={`/admin/orders/${o.id}/`}>#{o.id}</Link> {o.billing?.last_name}{o.billing?.first_name}</td>
                      <td><Badge s={o.status} label={ORDER_STATUSES[o.status]} /></td>
                      <td className="num">{money(o.total)}</td>
                      <td className="muted small">{twDateTime(o.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted">尚無訂單。舊站的訂單、顧客與優惠券會在資料庫備份匯入後出現。</p>
            )}
          </div>
          <div className="card">
            <h2>最近操作</h2>
            <table className="list">
              <tbody>
                {recentAudit.map((a: any) => (
                  <tr key={a.id}>
                    <td className="small">{twDateTime(a.created_at)}</td>
                    <td className="small">{a.actor} <span className="badge">{a.via}</span></td>
                    <td className="small">{a.action} · {a.entity_type} {a.entity_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="small"><Link href="/admin/audit/">全部稽核紀錄 →</Link></p>
          </div>
        </div>
        <div>
          <div className="card">
            <h2>快速操作</h2>
            <p><Link className="btn" href="/admin/content/?type=post">撰寫文章</Link> <Link className="btn" href="/admin/products/">管理商品</Link></p>
            <p><Link className="btn" href="/admin/media/">上傳媒體</Link> <Link className="btn" href="/admin/settings/">網站設定</Link></p>
          </div>
          <div className="card">
            <h2>庫存提醒</h2>
            {lowStock.length ? (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {lowStock.map((p: any) => (
                  <li key={p.id}><Link href={`/admin/products/${p.id}/`}>{p.name}</Link> <Badge s={p.stock_status} /> {p.stock_quantity ?? ''}</li>
                ))}
              </ul>
            ) : (
              <p className="muted">沒有缺貨或低庫存商品。</p>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
