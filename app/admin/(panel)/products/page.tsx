/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from 'next/link'
import { newProductAction } from '../../actions'
import { Badge, money, Notice, Pager, sp1, type SP } from '@/components/admin/ui'
import { listTerms } from '@/lib/admin/content'
import { listProducts } from '@/lib/admin/shop'
import { requireAdmin } from '@/lib/admin/session'
import { svc } from '@/lib/sb'

export const metadata = { title: '商品' }

export default async function Products({ searchParams }: { searchParams: SP }) {
  await requireAdmin('shop')
  const q = await searchParams
  const status = sp1(q.status)
  const search = sp1(q.s)
  const cat = Number(sp1(q.cat) || 0)
  const stock = sp1(q.stock)
  const offset = Number(sp1(q.offset) || 0)
  const limit = 30
  const [{ rows, total }, cats] = await Promise.all([listProducts({ status, search, category_id: cat || undefined, stock_status: stock || undefined, offset, limit }), listTerms('product_cat')])
  const mids = rows.map((r: any) => r.featured_media_id).filter(Boolean)
  const thumbs = new Map<number, string>()
  if (mids.length) for (const m of (await svc().from('media').select('id,url').in('id', mids)).data || []) thumbs.set(Number(m.id), m.url)
  return (
    <>
      <h1>
        商品
        <form action={newProductAction}>
          <button type="submit">新增商品</button>
        </form>
      </h1>
      <Notice q={q} />
      <div className="tabs">
        {[['', '全部'], ['publish', '已發布'], ['draft', '草稿'], ['pending', '待審閱'], ['private', '私密'], ['trash', '垃圾桶']].map(([s, l]) => (
          <Link key={s} href={`/admin/products/${s ? `?status=${s}` : ''}`} className={status === s ? 'on' : ''}>{l}</Link>
        ))}
      </div>
      <form className="toolbar" action="/admin/products/">
        {status && <input type="hidden" name="status" value={status} />}
        <input type="search" name="s" defaultValue={search} placeholder="搜尋名稱 / SKU" />
        <select name="cat" defaultValue={cat || ''}>
          <option value="">所有分類</option>
          {cats.map((c: any) => <option key={c.id} value={c.id}>{c.parent_id ? '— ' : ''}{c.name} ({c.count})</option>)}
        </select>
        <select name="stock" defaultValue={stock}>
          <option value="">所有庫存狀態</option>
          <option value="instock">有庫存</option>
          <option value="outofstock">缺貨</option>
          <option value="onbackorder">可預購</option>
        </select>
        <button type="submit">篩選</button>
      </form>
      <table className="list">
        <thead>
          <tr><th></th><th>名稱</th><th>SKU</th><th>庫存</th><th className="num">價格</th><th>狀態</th></tr>
        </thead>
        <tbody>
          {rows.map((r: any) => (
            <tr key={r.id}>
              <td style={{ width: 56 }}>{thumbs.get(Number(r.featured_media_id)) ? <img className="thumb" src={thumbs.get(Number(r.featured_media_id))} alt="" /> : <div className="thumb" />}</td>
              <td>
                <Link href={`/admin/products/${r.id}/`}><strong>{r.name}</strong></Link>
                <div className="row-actions">#{r.id} · {r.type === 'variable' ? '可變商品' : r.type === 'simple' ? '簡單商品' : r.type}{r.featured ? ' · ★精選' : ''}{r.status === 'publish' && <> · <a href={`/product/${decodeURIComponent(r.slug)}/`} target="_blank" rel="noreferrer">檢視</a></>}</div>
              </td>
              <td className="small">{r.sku || '—'}</td>
              <td><Badge s={r.stock_status} />{r.manage_stock && r.stock_quantity !== null ? ` (${r.stock_quantity})` : ''}</td>
              <td className="num">
                {r.type === 'variable' && r.price_min !== r.price_max ? `${money(r.price_min)} – ${money(r.price_max)}` : r.sale_price !== null && r.price === r.sale_price ? <><del className="muted">{money(r.regular_price)}</del> {money(r.price)}</> : money(r.price)}
              </td>
              <td><Badge s={r.status} /></td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={6} className="muted">沒有符合的商品。</td></tr>}
        </tbody>
      </table>
      <Pager base="/admin/products/" params={{ status, s: search, cat: cat ? String(cat) : '', stock }} total={total} offset={offset} limit={limit} />
    </>
  )
}
