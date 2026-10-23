/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from 'next/link'
import { deleteRuleAction, saveRuleAction } from '../../actions'
import { ConfirmButton } from '@/components/admin/Bits'
import { Badge, money, Notice, type SP } from '@/components/admin/ui'
import { listTerms } from '@/lib/admin/content'
import { isoToTwLocal, twDateTime } from '@/lib/admin/core'
import { listCoupons, listRules } from '@/lib/admin/shop'
import { requireAdmin } from '@/lib/admin/session'

export const metadata = { title: '優惠券與折扣' }
const TYPE: Record<string, string> = { percent: '百分比折扣', fixed_cart: '購物車固定折扣', fixed_product: '商品固定折扣' }

function RuleForm({ r, cats }: { r?: any; cats: any[] }) {
  return (
    <form action={saveRuleAction} className="grid-cols" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', alignItems: 'end', borderTop: '1px solid #f0f0f1', paddingTop: 8, marginTop: 8 }}>
      {r && <input type="hidden" name="id" value={r.id} />}
      <div><label>名稱</label><input type="text" name="title" defaultValue={r?.title} required className="w100" /></div>
      <div><label>套用於</label>
        <select name="applies_to" defaultValue={r?.applies_to || 'all'} className="w100">
          <option value="all">全部商品</option><option value="products">指定商品</option><option value="categories">指定分類</option>
        </select>
      </div>
      <div><label>商品 ID（逗號）</label><input type="text" name="product_ids" defaultValue={(r?.product_ids || []).join(',')} className="w100" /></div>
      <div><label>分類</label>
        <select name="category_ids" multiple defaultValue={(r?.category_ids || []).map(String)} className="w100" style={{ height: 60 }}>
          {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div><label>最少數量</label><input type="number" name="min_qty" min="1" defaultValue={r?.min_qty ?? 2} required className="w100" /></div>
      <div><label>最多數量</label><input type="number" name="max_qty" defaultValue={r?.max_qty ?? ''} className="w100" /></div>
      <div><label>折扣方式</label>
        <select name="discount_type" defaultValue={r?.discount_type || 'percent'} className="w100">
          <option value="percent">百分比（%）</option><option value="fixed_per_item">每件折抵（NT$）</option><option value="fixed_price">每件固定價（NT$）</option>
        </select>
      </div>
      <div><label>數值</label><input type="number" step="any" name="amount" defaultValue={r?.amount ?? ''} required className="w100" /></div>
      <div><label>開始</label><input type="datetime-local" name="starts_at" defaultValue={isoToTwLocal(r?.starts_at)} className="w100" /></div>
      <div><label>結束</label><input type="datetime-local" name="ends_at" defaultValue={isoToTwLocal(r?.ends_at)} className="w100" /></div>
      <div><label>優先順序</label><input type="number" name="priority" defaultValue={r?.priority ?? 10} className="w100" /></div>
      <div>
        <label className="inline"><input type="checkbox" name="enabled" defaultChecked={r ? r.enabled : true} /> 啟用</label>
        <button type="submit" className={r ? '' : 'primary'}>{r ? '儲存' : '新增規則'}</button>{' '}
        {r && <ConfirmButton className="link danger" formAction={deleteRuleAction} message="刪除此規則？">刪除</ConfirmButton>}
      </div>
    </form>
  )
}

export default async function Coupons({ searchParams }: { searchParams: SP }) {
  await requireAdmin('shop')
  const q = await searchParams
  const [coupons, rules, cats] = await Promise.all([listCoupons(), listRules(), listTerms('product_cat')])
  return (
    <>
      <h1>優惠券 <Link className="btn" href="/admin/coupons/new/">新增優惠券</Link></h1>
      <Notice q={q} />
      <table className="list">
        <thead><tr><th>代碼</th><th>類型</th><th className="num">金額</th><th>說明</th><th>使用次數／上限</th><th>到期</th><th>狀態</th></tr></thead>
        <tbody>
          {coupons.map((c: any) => (
            <tr key={c.id}>
              <td><Link href={`/admin/coupons/${c.id}/`}><strong>{c.code}</strong></Link></td>
              <td>{TYPE[c.discount_type] || c.discount_type}</td>
              <td className="num">{c.discount_type === 'percent' ? `${Number(c.amount)}%` : money(c.amount)}</td>
              <td className="small">{c.description}</td>
              <td>{c.usage_count} / {c.usage_limit ?? '∞'}</td>
              <td className="small">{twDateTime(c.expires_at)}</td>
              <td><Badge s={c.status} /></td>
            </tr>
          ))}
          {!coupons.length && <tr><td colSpan={7} className="muted">尚無優惠券。舊站優惠券會在資料庫備份匯入後出現。</td></tr>}
        </tbody>
      </table>
      <div className="card" id="rules" style={{ marginTop: 24 }}>
        <h2>數量折扣規則</h2>
        <p className="small muted">購物車中同一商品（或分類）達到指定數量時自動折扣，於購物車與結帳計算。</p>
        {rules.map((r: any) => <RuleForm key={r.id} r={r} cats={cats} />)}
        <h3 style={{ marginTop: 16 }}>新增規則</h3>
        <RuleForm cats={cats} />
      </div>
    </>
  )
}
