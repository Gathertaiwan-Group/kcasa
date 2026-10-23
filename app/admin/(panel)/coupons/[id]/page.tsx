/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from 'next/link'
import { deleteCouponAction, saveCouponAction } from '../../../actions'
import { ConfirmButton } from '@/components/admin/Bits'
import { Notice, type SP } from '@/components/admin/ui'
import { listTerms } from '@/lib/admin/content'
import { isoToTwLocal } from '@/lib/admin/core'
import { getCoupon } from '@/lib/admin/shop'
import { requireAdmin } from '@/lib/admin/session'

export const metadata = { title: '優惠券' }

export default async function CouponEdit({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  await requireAdmin('shop')
  const { id } = await params
  const q = await searchParams
  const isNew = id === 'new'
  const c: any = isNew ? { discount_type: 'fixed_cart', amount: 0, status: 'publish', product_ids: [], excluded_product_ids: [], product_category_ids: [], excluded_category_ids: [], email_restrictions: [] } : await getCoupon(Number(id))
  const cats = await listTerms('product_cat')
  return (
    <>
      <h1>{isNew ? '新增優惠券' : `優惠券「${c.code}」`} <Link className="btn" href="/admin/coupons/">返回列表</Link></h1>
      <Notice q={q} />
      <form className="card" action={saveCouponAction}>
        {!isNew && <input type="hidden" name="id" value={c.id} />}
        <div className="grid-cols">
          <div><label>優惠碼</label><input type="text" name="code" defaultValue={c.code} required className="w100" /></div>
          <div><label>折扣類型</label>
            <select name="discount_type" defaultValue={c.discount_type} className="w100">
              <option value="fixed_cart">購物車固定折扣</option><option value="percent">百分比折扣</option><option value="fixed_product">商品固定折扣</option>
            </select>
          </div>
          <div><label>折扣金額／百分比</label><input type="number" step="any" name="amount" defaultValue={c.amount} className="w100" /></div>
          <div><label>到期時間</label><input type="datetime-local" name="expires_at" defaultValue={isoToTwLocal(c.expires_at)} className="w100" /></div>
          <div><label>狀態</label><select name="status" defaultValue={c.status} className="w100"><option value="publish">啟用</option><option value="draft">停用（草稿）</option></select></div>
        </div>
        <label>說明</label>
        <textarea name="description" defaultValue={c.description} />
        <label className="inline"><input type="checkbox" name="free_shipping" defaultChecked={c.free_shipping} /> 允許免運</label>
        <h2 style={{ marginTop: 16 }}>使用限制</h2>
        <div className="grid-cols">
          <div><label>最低消費</label><input type="number" name="minimum_amount" defaultValue={c.minimum_amount ?? ''} className="w100" /></div>
          <div><label>最高消費</label><input type="number" name="maximum_amount" defaultValue={c.maximum_amount ?? ''} className="w100" /></div>
          <div><label>指定商品 ID（逗號）</label><input type="text" name="product_ids" defaultValue={c.product_ids.join(',')} className="w100" /></div>
          <div><label>排除商品 ID</label><input type="text" name="excluded_product_ids" defaultValue={c.excluded_product_ids.join(',')} className="w100" /></div>
          <div><label>指定分類</label>
            <select name="product_category_ids" multiple defaultValue={c.product_category_ids.map(String)} className="w100" style={{ height: 90 }}>
              {cats.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div><label>排除分類</label>
            <select name="excluded_category_ids" multiple defaultValue={c.excluded_category_ids.map(String)} className="w100" style={{ height: 90 }}>
              {cats.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div><label>限定 Email（逗號）</label><input type="text" name="email_restrictions" defaultValue={c.email_restrictions.join(', ')} className="w100" /></div>
        </div>
        <label className="inline"><input type="checkbox" name="individual_use" defaultChecked={c.individual_use} /> 不可與其他優惠券併用</label>
        <label className="inline"><input type="checkbox" name="exclude_sale_items" defaultChecked={c.exclude_sale_items} /> 排除特價商品</label>
        <h2 style={{ marginTop: 16 }}>使用次數</h2>
        <div className="grid-cols">
          <div><label>總使用上限</label><input type="number" name="usage_limit" defaultValue={c.usage_limit ?? ''} className="w100" /></div>
          <div><label>每位顧客上限</label><input type="number" name="usage_limit_per_user" defaultValue={c.usage_limit_per_user ?? ''} className="w100" /></div>
          <div><label>最多套用件數</label><input type="number" name="limit_usage_to_x_items" defaultValue={c.limit_usage_to_x_items ?? ''} className="w100" /></div>
        </div>
        {!isNew && <p className="small muted">已使用 {c.usage_count} 次</p>}
        <p className="toolbar">
          <button type="submit" className="primary">{isNew ? '建立優惠券' : '儲存'}</button>
          {!isNew && <ConfirmButton formAction={deleteCouponAction} message="刪除此優惠券？">刪除</ConfirmButton>}
        </p>
      </form>
    </>
  )
}
