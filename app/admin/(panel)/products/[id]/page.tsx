/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from 'next/link'
import { addVariationAction, deleteAttributeAction, deleteProductAction, deleteVariationAction, restoreProductAction, saveAttributeAction, saveProductAction, saveVariationsAction, trashProductAction } from '../../../actions'
import { ConfirmButton, PreviewButton } from '@/components/admin/Bits'
import { GalleryField, MediaField } from '@/components/admin/MediaPicker'
import { RichEditor } from '@/components/admin/RichEditor'
import { Badge, decode, money, Notice, type SP } from '@/components/admin/ui'
import { listTerms } from '@/lib/admin/content'
import { isoToTwLocal, twDateTime } from '@/lib/admin/core'
import { getProduct } from '@/lib/admin/shop'
import { requireAdmin } from '@/lib/admin/session'
import { idParam, orNotFound } from '@/lib/admin/notfound'
import { editorStyles } from '@/lib/legacy'
import { svc } from '@/lib/sb'

export const metadata = { title: '編輯商品' }

export default async function EditProduct({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  await requireAdmin('shop')
  const { id } = await params
  const q = await searchParams
  const p = await orNotFound(getProduct(idParam(id)))
  const [cats, tags] = await Promise.all([listTerms('product_cat'), listTerms('product_tag')])
  const mids = [p.featured_media_id, ...(p.gallery_media_ids || []), ...p.variations.map((v: any) => v.image_id)].filter(Boolean)
  const urls = new Map<number, string>()
  if (mids.length) for (const m of (await svc().from('media').select('id,url').in('id', mids)).data || []) urls.set(Number(m.id), m.url)
  const tagNames = tags.filter((t: any) => p.term_ids.includes(Number(t.id))).map((t: any) => t.name).join(', ')
  const css = editorStyles(p.status === 'publish' ? p.path : null, p.type === 'variable' ? 'product_variable' : 'product')
  const seo = p.seo || {}
  const varAttrs = p.attributes.filter((a: any) => a.used_for_variations)
  return (
    <>
      <h1>
        編輯商品 <Badge s={p.status} />
        <Link className="btn" href="/admin/products/">返回列表</Link>
      </h1>
      <Notice q={q} />
      <form id="product-form" action={saveProductAction} key={String(p.modified_at)}>
        <input type="hidden" name="id" value={p.id} />
        <button type="submit" name="intent" value="save" tabIndex={-1} aria-hidden="true" style={{ position: 'absolute', left: -9999, width: 1, height: 1 }} />
        <div className="grid2">
          <div>
            <input className="title" name="name" defaultValue={p.name} placeholder="商品名稱" aria-label="商品名稱" required />
            <p className="small muted" style={{ margin: '6px 0 12px' }}>
              固定網址：{p.status === 'publish' ? <a href={decode(p.path || `/product/${p.slug}/`)} target="_blank" rel="noreferrer">{decode(p.path || `/product/${p.slug}/`)}</a> : decode(p.path)}　代稱：
              <input type="text" name="slug" defaultValue={decode(p.slug)} style={{ width: 240 }} aria-label="slug" />
            </p>
            <h3>商品描述</h3>
            <RichEditor name="description_html" initialHtml={p.description_html || ''} cssHrefs={css.hrefs} bodyClass={css.bodyClass} minHeight={320} />
            <div className="card" style={{ marginTop: 16 }}>
              <h2>商品資料</h2>
              <div className="grid-cols">
                <div>
                  <label>商品類型</label>
                  <select name="type" defaultValue={p.type}>
                    <option value="simple">簡單商品</option>
                    <option value="variable">可變商品</option>
                    <option value="grouped">組合商品</option>
                    <option value="external">外部商品</option>
                  </select>
                </div>
                <div>
                  <label>SKU</label>
                  <input type="text" name="sku" defaultValue={p.sku} />
                </div>
                <div>
                  <label>原價（NT$）</label>
                  <input type="number" step="1" min="0" name="regular_price" defaultValue={p.regular_price ?? ''} disabled={p.type === 'variable'} />
                  {p.type === 'variable' && <p className="small muted">可變商品價格請在下方變體設定（目前 {money(p.price_min)} – {money(p.price_max)}）</p>}
                </div>
                <div>
                  <label>特價（NT$）</label>
                  <input type="number" step="1" min="0" name="sale_price" defaultValue={p.sale_price ?? ''} disabled={p.type === 'variable'} />
                </div>
                <div>
                  <label>特價開始</label>
                  <input type="datetime-local" name="sale_starts_at" defaultValue={isoToTwLocal(p.sale_starts_at)} />
                </div>
                <div>
                  <label>特價結束</label>
                  <input type="datetime-local" name="sale_ends_at" defaultValue={isoToTwLocal(p.sale_ends_at)} />
                </div>
                <div>
                  <label>稅務狀態</label>
                  <select name="tax_status" defaultValue={p.tax_status}>
                    <option value="taxable">應稅</option>
                    <option value="shipping">僅運費</option>
                    <option value="none">免稅</option>
                  </select>
                </div>
              </div>
              <h3 style={{ marginTop: 16 }}>庫存</h3>
              <div className="grid-cols">
                <div>
                  <label className="inline"><input type="checkbox" name="manage_stock" defaultChecked={p.manage_stock} /> 管理庫存數量</label>
                  <label>庫存數量</label>
                  <input type="number" step="1" name="stock_quantity" defaultValue={p.stock_quantity ?? ''} />
                </div>
                <div>
                  <label>庫存狀態</label>
                  <select name="stock_status" defaultValue={p.stock_status}>
                    <option value="instock">有庫存</option>
                    <option value="outofstock">缺貨</option>
                    <option value="onbackorder">可預購</option>
                  </select>
                  <label>允許預購</label>
                  <select name="backorders" defaultValue={p.backorders}>
                    <option value="no">不允許</option>
                    <option value="notify">允許，但通知顧客</option>
                    <option value="yes">允許</option>
                  </select>
                </div>
                <div>
                  <label>低庫存門檻</label>
                  <input type="number" name="low_stock_amount" defaultValue={p.low_stock_amount ?? ''} />
                  <label className="inline"><input type="checkbox" name="sold_individually" defaultChecked={p.sold_individually} /> 每筆訂單限購一件</label>
                </div>
              </div>
              <h3 style={{ marginTop: 16 }}>運送</h3>
              <div className="grid-cols">
                <div><label>重量（kg）</label><input type="number" step="any" name="weight" defaultValue={p.weight ?? ''} /></div>
                <div><label>長（cm）</label><input type="number" step="any" name="length" defaultValue={p.length ?? ''} /></div>
                <div><label>寬（cm）</label><input type="number" step="any" name="width" defaultValue={p.width ?? ''} /></div>
                <div><label>高（cm）</label><input type="number" step="any" name="height" defaultValue={p.height ?? ''} /></div>
                <div><label>運送類別</label><input type="text" name="shipping_class" defaultValue={p.shipping_class} /></div>
              </div>
              <h3 style={{ marginTop: 16 }}>關聯商品</h3>
              <div className="grid-cols">
                <div><label>追加銷售（商品 ID，逗號分隔）</label><input type="text" name="upsell_ids" defaultValue={(p.upsell_ids || []).join(',')} /></div>
                <div><label>交叉銷售（商品 ID）</label><input type="text" name="cross_sell_ids" defaultValue={(p.cross_sell_ids || []).join(',')} /></div>
                <div><label>排序</label><input type="number" name="menu_order" defaultValue={p.menu_order} /></div>
              </div>
              <label className="inline" style={{ marginTop: 12 }}><input type="checkbox" name="reviews_allowed" defaultChecked={p.reviews_allowed} /> 允許評價</label>
            </div>
            <h3>商品簡短描述</h3>
            <RichEditor name="short_description_html" initialHtml={p.short_description_html || ''} cssHrefs={css.hrefs} bodyClass={css.bodyClass} minHeight={200} />
            <details className="box" style={{ marginTop: 16 }} open={!!(seo.title || seo.description)}>
              <summary>SEO（Rank Math）</summary>
              <div>
                <label>SEO 標題</label>
                <input type="text" name="seo_title" className="w100" defaultValue={seo.title || ''} />
                <label>Meta 描述</label>
                <textarea name="seo_description" defaultValue={seo.description || ''} />
                <label>Robots</label>
                <input type="text" name="seo_robots" className="w100" defaultValue={seo.robots || ''} />
              </div>
            </details>
          </div>
          <div>
            <div className="card">
              <h3>發布</h3>
              <div className="toolbar">
                <button type="submit" name="intent" value="draft">儲存草稿</button>
                <PreviewButton formId="product-form" kind="product" id={p.id} />
              </div>
              <label>狀態</label>
              <select name="status" defaultValue={p.status === 'trash' ? 'draft' : p.status} className="w100">
                <option value="draft">草稿</option>
                <option value="pending">待審閱</option>
                <option value="private">私密</option>
                <option value="publish">已發布</option>
              </select>
              <label>型錄可見度</label>
              <select name="catalog_visibility" defaultValue={p.catalog_visibility} className="w100">
                <option value="visible">商店與搜尋結果</option>
                <option value="catalog">僅商店</option>
                <option value="search">僅搜尋結果</option>
                <option value="hidden">隱藏</option>
              </select>
              <label className="inline"><input type="checkbox" name="featured" defaultChecked={p.featured} /> 精選商品</label>
              <div className="toolbar" style={{ marginTop: 8 }}>
                <button type="submit" name="intent" value="save">儲存</button>
                <button type="submit" name="intent" value="publish" className="primary">{p.status === 'publish' ? '更新' : '發布'}</button>
              </div>
              <p className="small muted">最後修改：{twDateTime(p.modified_at)} · #{p.id}</p>
              <div className="toolbar">
                {p.status === 'trash' ? (
                  <>
                    <button type="submit" formAction={restoreProductAction}>從垃圾桶還原</button>
                    <ConfirmButton formAction={deleteProductAction} message="永久刪除商品與所有變體？">永久刪除</ConfirmButton>
                  </>
                ) : (
                  <ConfirmButton formAction={trashProductAction} message="移至垃圾桶？">移至垃圾桶</ConfirmButton>
                )}
              </div>
            </div>
            <div className="card">
              <h3>商品分類</h3>
              <div className="checks">
                {cats.map((c: any) => (
                  <label key={c.id}>
                    <input type="checkbox" name="category_ids" value={c.id} defaultChecked={p.term_ids.includes(Number(c.id))} /> {c.parent_id ? '— ' : ''}{c.name}
                  </label>
                ))}
              </div>
              <h3 style={{ marginTop: 12 }}>商品標籤</h3>
              <input type="text" name="tag_names" defaultValue={tagNames} className="w100" placeholder="以逗號分隔" />
            </div>
            <div className="card">
              <h3>商品圖片</h3>
              <MediaField name="featured_media_id" initialId={p.featured_media_id} initialUrl={urls.get(Number(p.featured_media_id))} label="設定商品圖片" />
            </div>
            <div className="card">
              <h3>商品圖庫</h3>
              <GalleryField name="gallery_media_ids" initial={(p.gallery_media_ids || []).map((i: number) => ({ id: i, url: urls.get(Number(i)) || '' }))} />
            </div>
          </div>
        </div>
      </form>

      <div className="card" id="attributes">
        <h2>屬性</h2>
        <table className="list">
          <thead><tr><th>名稱</th><th>選項（以 | 或逗號分隔）</th><th>顯示</th><th>用於變體</th><th>排序</th><th></th></tr></thead>
          <tbody>
            {p.attributes.map((a: any) => (
              <tr key={a.id}>
                <td colSpan={6} style={{ padding: 0 }}>
                  <form action={saveAttributeAction} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 60px 80px 70px 150px', gap: 8, padding: 8, alignItems: 'center' }}>
                    <input type="hidden" name="product_id" value={p.id} />
                    <input type="hidden" name="attr_id" value={a.id} />
                    <input type="text" name="attr_name" defaultValue={a.name} />
                    <input type="text" name="attr_options" defaultValue={(a.options || []).join(' | ')} />
                    <input type="checkbox" name="attr_visible" defaultChecked={a.visible} aria-label="顯示" />
                    <input type="checkbox" name="attr_variation" defaultChecked={a.used_for_variations} aria-label="用於變體" />
                    <input type="number" name="attr_position" defaultValue={a.position} />
                    <span>
                      <button type="submit">儲存</button> <ConfirmButton formAction={deleteAttributeAction} className="link danger">刪除</ConfirmButton>
                    </span>
                  </form>
                </td>
              </tr>
            ))}
            <tr>
              <td colSpan={6} style={{ padding: 0 }}>
                <form action={saveAttributeAction} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 60px 80px 70px 150px', gap: 8, padding: 8, alignItems: 'center' }}>
                  <input type="hidden" name="product_id" value={p.id} />
                  <input type="text" name="attr_name" placeholder="新屬性名稱（例：規格）" />
                  <input type="text" name="attr_options" placeholder="選項 1 | 選項 2" />
                  <input type="checkbox" name="attr_visible" defaultChecked aria-label="顯示" />
                  <input type="checkbox" name="attr_variation" defaultChecked={p.type === 'variable'} aria-label="用於變體" />
                  <input type="number" name="attr_position" defaultValue={p.attributes.length} />
                  <button type="submit">新增屬性</button>
                </form>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {p.type === 'variable' && (
        <div className="card" id="variations">
          <h2>變體（{p.variations.length}）</h2>
          <form action={saveVariationsAction}>
            <input type="hidden" name="product_id" value={p.id} />
            <table className="list">
              <thead>
                <tr><th>#</th>{varAttrs.map((a: any) => <th key={a.id}>{a.name}</th>)}<th>SKU</th><th>原價</th><th>特價</th><th>管理庫存</th><th>數量</th><th>庫存狀態</th><th>啟用</th><th>圖片 ID</th><th></th></tr>
              </thead>
              <tbody>
                {p.variations.map((v: any) => {
                  const pre = `v${v.id}_`
                  return (
                    <tr key={v.id}>
                      <td className="small">{v.id}<input type="hidden" name="variation_ids" value={v.id} /></td>
                      {varAttrs.map((a: any) => {
                        const cur = (v.attributes || []).find((x: any) => x.name === a.name || x.name === `pa_${a.name}` || decodeURIComponent(String(x.name)).replace(/^pa_/, '') === a.name)
                        return (
                          <td key={a.id}>
                            <select name={`${pre}attr[${a.name}]`} defaultValue={cur?.value ?? ''}>
                              <option value="">任何{a.name}</option>
                              {(a.options || []).map((o: string) => <option key={o} value={o}>{o}</option>)}
                              {cur?.value && !(a.options || []).includes(cur.value) && <option value={cur.value}>{decodeURIComponent(cur.value)}</option>}
                            </select>
                          </td>
                        )
                      })}
                      <td><input type="text" name={`${pre}sku`} defaultValue={v.sku} /></td>
                      <td><input type="number" step="1" name={`${pre}regular_price`} defaultValue={v.regular_price ?? ''} /></td>
                      <td><input type="number" step="1" name={`${pre}sale_price`} defaultValue={v.sale_price ?? ''} /></td>
                      <td><input type="checkbox" name={`${pre}manage_stock`} defaultChecked={v.manage_stock} aria-label="管理庫存" /></td>
                      <td><input type="number" step="1" name={`${pre}stock_quantity`} defaultValue={v.stock_quantity ?? ''} /></td>
                      <td>
                        <select name={`${pre}stock_status`} defaultValue={v.stock_status}>
                          <option value="instock">有庫存</option>
                          <option value="outofstock">缺貨</option>
                          <option value="onbackorder">可預購</option>
                        </select>
                      </td>
                      <td><input type="checkbox" name={`${pre}enabled`} defaultChecked={v.status === 'publish'} aria-label="啟用" /></td>
                      <td><input type="number" name={`${pre}image_id`} defaultValue={v.image_id ?? ''} style={{ width: 80 }} />{v.image_id && urls.get(Number(v.image_id)) && <img className="thumb" src={urls.get(Number(v.image_id))} alt="" />}<input type="hidden" name={`${pre}menu_order`} value={v.menu_order} /></td>
                      <td>
                        <ConfirmButton className="link danger" formAction={deleteVariationAction} name="variation_id" value={String(v.id)} message="刪除此變體？">刪除</ConfirmButton>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p><button type="submit" className="primary">儲存所有變體</button></p>
          </form>
          <form action={addVariationAction} className="toolbar">
            <input type="hidden" name="product_id" value={p.id} />
            <input type="hidden" name="new_enabled" value="on" />
            <strong>新增變體：</strong>
            {varAttrs.map((a: any) => (
              <select key={a.id} name={`new_attr[${a.name}]`} defaultValue="">
                <option value="">任何{a.name}</option>
                {(a.options || []).map((o: string) => <option key={o} value={o}>{o}</option>)}
              </select>
            ))}
            <input type="text" name="new_sku" placeholder="SKU" style={{ width: 120 }} />
            <input type="number" name="new_regular_price" placeholder="原價" style={{ width: 100 }} />
            <input type="number" name="new_sale_price" placeholder="特價" style={{ width: 100 }} />
            <button type="submit">新增</button>
          </form>
          {!varAttrs.length && <p className="small muted">先在上方「屬性」新增一個勾選「用於變體」的屬性，才能設定變體的屬性值。</p>}
        </div>
      )}
      <p className="small"><Link href={`/admin/audit/?entity_id=${p.id}`}>此商品的稽核紀錄 →</Link></p>
    </>
  )
}
