/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from 'next/link'
import { deleteTermAction, saveTermAction } from '../../actions'
import { ConfirmButton } from '@/components/admin/Bits'
import { decode, Notice, sp1, type SP } from '@/components/admin/ui'
import { listTerms } from '@/lib/admin/content'
import { requireAdmin } from '@/lib/admin/session'

export const metadata = { title: '分類與標籤' }
const TAX: Record<string, { label: string; base: string; area: string }> = {
  category: { label: '文章分類', base: '/category/', area: 'content' },
  post_tag: { label: '文章標籤', base: '/tag/', area: 'content' },
  product_cat: { label: '商品分類', base: '/product-category/', area: 'shop' },
  product_tag: { label: '商品標籤', base: '/product-tag/', area: 'shop' },
}

export default async function Terms({ searchParams }: { searchParams: SP }) {
  const q = await searchParams
  const taxonomy = TAX[sp1(q.taxonomy)] ? sp1(q.taxonomy) : 'category'
  const t = TAX[taxonomy]
  await requireAdmin(t.area)
  const terms = await listTerms(taxonomy)
  const hier = taxonomy === 'category' || taxonomy === 'product_cat'
  const editId = Number(sp1(q.edit) || 0)
  const editing = terms.find((x: any) => Number(x.id) === editId)
  const group = t.area === 'shop' ? ['product_cat', 'product_tag'] : ['category', 'post_tag']
  return (
    <>
      <h1>{t.label}</h1>
      <Notice q={q} />
      <div className="tabs">
        {group.map((k) => <Link key={k} href={`/admin/terms/?taxonomy=${k}`} className={k === taxonomy ? 'on' : ''}>{TAX[k].label}</Link>)}
      </div>
      <div className="grid2" style={{ gridTemplateColumns: '320px 1fr' }}>
        <div className="card">
          <h2>{editing ? `編輯「${editing.name}」` : `新增${t.label}`}</h2>
          <form action={saveTermAction} key={editing?.id || 'new'}>
            <input type="hidden" name="taxonomy" value={taxonomy} />
            {editing && <input type="hidden" name="id" value={editing.id} />}
            <label>名稱</label>
            <input type="text" name="name" required className="w100" defaultValue={editing?.name} />
            <label>代稱（slug）</label>
            <input type="text" name="slug" className="w100" defaultValue={editing ? decode(editing.slug) : ''} placeholder="留空自動產生" />
            {hier && (
              <>
                <label>上層分類</label>
                <select name="parent_id" className="w100" defaultValue={editing?.parent_id ?? ''}>
                  <option value="">（無）</option>
                  {terms.filter((x: any) => x.id !== editing?.id).map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </>
            )}
            <label>描述</label>
            <textarea name="description" defaultValue={editing?.description} />
            <label>排序</label>
            <input type="number" name="menu_order" defaultValue={editing?.menu_order ?? 0} />
            <p className="toolbar">
              <button type="submit" className="primary">{editing ? '更新' : '新增'}</button>
              {editing && <Link href={`/admin/terms/?taxonomy=${taxonomy}`}>取消</Link>}
            </p>
          </form>
        </div>
        <table className="list">
          <thead><tr><th>名稱</th><th>代稱</th><th className="num">數量</th><th></th></tr></thead>
          <tbody>
            {terms.map((x: any) => (
              <tr key={x.id}>
                <td>
                  {x.parent_id ? '— ' : ''}<Link href={`/admin/terms/?taxonomy=${taxonomy}&edit=${x.id}`}><strong>{x.name}</strong></Link>
                  <div className="row-actions">#{x.id} · <a href={t.base + decode(x.slug) + '/'} target="_blank" rel="noreferrer">檢視</a></div>
                </td>
                <td className="small">{decode(x.slug)}</td>
                <td className="num">{x.count}</td>
                <td>
                  <form action={deleteTermAction}>
                    <input type="hidden" name="id" value={x.id} />
                    <input type="hidden" name="taxonomy" value={taxonomy} />
                    <ConfirmButton className="link danger" message={`刪除「${x.name}」？項目不會被刪除，只會移除此分類。`}>刪除</ConfirmButton>
                  </form>
                </td>
              </tr>
            ))}
            {!terms.length && <tr><td colSpan={4} className="muted">尚無資料。</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
