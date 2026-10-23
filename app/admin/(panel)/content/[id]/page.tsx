/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from 'next/link'
import { deleteContentAction, restoreContentAction, saveContentAction, trashContentAction } from '../../../actions'
import { ConfirmButton, PreviewButton } from '@/components/admin/Bits'
import { MediaField } from '@/components/admin/MediaPicker'
import { RichEditor } from '@/components/admin/RichEditor'
import { Badge, decode, Notice, type SP } from '@/components/admin/ui'
import { getContent, listTerms } from '@/lib/admin/content'
import { isoToTwLocal, twDateTime } from '@/lib/admin/core'
import { requireAdmin } from '@/lib/admin/session'
import { editorStyles } from '@/lib/legacy'
import { svc } from '@/lib/sb'

export const metadata = { title: '編輯' }

export default async function EditContent({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  await requireAdmin('content')
  const { id } = await params
  const q = await searchParams
  const p = await getContent(Number(id))
  const isPost = p.post_type === 'post'
  const isPage = p.post_type === 'page'
  const [cats, tags, featured, parents] = await Promise.all([
    isPost ? listTerms('category') : Promise.resolve([]),
    isPost ? listTerms('post_tag') : Promise.resolve([]),
    p.featured_media_id ? svc().from('media').select('url').eq('id', p.featured_media_id).maybeSingle().then((r) => r.data) : Promise.resolve(null),
    isPage ? svc().from('posts').select('id,title').eq('post_type', 'page').neq('id', p.id).neq('status', 'trash').order('title').then((r) => r.data || []) : Promise.resolve([]),
  ])
  const tagNames = tags.filter((t: any) => p.term_ids.includes(Number(t.id))).map((t: any) => t.name).join(', ')
  const css = editorStyles(p.status === 'publish' ? p.path : null, isPost ? 'post' : p.builder === 'elementor' ? 'page_elementor' : 'page')
  const seo = p.seo || {}
  const seoTitle = seo.title || (Array.isArray(seo.meta) ? seo.meta.find((m: any) => m.n === 'og:title')?.c : '') || ''
  const seoDesc = seo.description ?? ((Array.isArray(seo.meta) ? seo.meta.find((m: any) => m.n === 'description')?.c : '') || '')
  const label = isPost ? '文章' : isPage ? '頁面' : '可重用區塊'
  return (
    <>
      <h1>
        編輯{label} <Badge s={p.status} />
        <Link className="btn" href={`/admin/content/?type=${p.post_type}`}>返回列表</Link>
      </h1>
      <Notice q={q} />
      {p.builder === 'elementor' && <div className="notice warn">此頁面原本以 Elementor 建立：版面區塊以 HTML 保存。視覺模式可直接修改文字與圖片；調整版面結構請切換到「HTML」。</div>}
      <form id="content-form" action={saveContentAction} key={String(p.modified_at)}>
        <input type="hidden" name="id" value={p.id} />
        {/* Enter in a text field = "儲存" (keeps the status), never "儲存草稿" */}
        <button type="submit" name="intent" value="save" tabIndex={-1} aria-hidden="true" style={{ position: 'absolute', left: -9999, width: 1, height: 1 }} />
        <div className="grid2">
          <div>
            <input className="title" name="title" defaultValue={p.title} placeholder="輸入標題" aria-label="標題" />
            {p.post_type !== 'wp_block' && (
              <p className="small muted" style={{ margin: '6px 0 12px' }}>
                固定網址：{p.status === 'publish' ? <a href={decode(p.path)} target="_blank" rel="noreferrer">{decode(p.path)}</a> : decode(p.path)}　代稱（slug）：
                <input type="text" name="slug" defaultValue={decode(p.slug)} style={{ width: 260 }} aria-label="slug" />
              </p>
            )}
            <RichEditor name="content_html" initialHtml={p.content_html || ''} cssHrefs={css.hrefs} bodyClass={css.bodyClass} />
            {isPost && (
              <details className="box" style={{ marginTop: 16 }}>
                <summary>摘要</summary>
                <div>
                  <textarea name="excerpt_html" defaultValue={p.excerpt_html} />
                </div>
              </details>
            )}
            <details className="box" open={!!(seo.title || seo.description)}>
              <summary>SEO（Rank Math）</summary>
              <div>
                <label>SEO 標題</label>
                <input type="text" name="seo_title" className="w100" defaultValue={seo.title || ''} placeholder={seoTitle} />
                <label>Meta 描述</label>
                <textarea name="seo_description" defaultValue={seo.description || ''} placeholder={seoDesc} />
                <label>Robots</label>
                <input type="text" name="seo_robots" className="w100" defaultValue={seo.robots || ''} placeholder="例：noindex, follow（留空沿用原設定）" />
              </div>
            </details>
          </div>
          <div>
            <div className="card">
              <h3>發布</h3>
              <div className="toolbar">
                <button type="submit" name="intent" value="draft">儲存草稿</button>
                <PreviewButton formId="content-form" kind="post" id={p.id} />
              </div>
              <label>狀態</label>
              <select name="status" defaultValue={p.status === 'trash' ? 'draft' : p.status} className="w100">
                <option value="draft">草稿</option>
                <option value="pending">待審閱</option>
                <option value="private">私密</option>
                <option value="future">已排程</option>
                <option value="publish">已發布</option>
              </select>
              <label>發布時間（台北時間）</label>
              <input type="datetime-local" name="published_at" defaultValue={isoToTwLocal(p.published_at)} className="w100" />
              <p className="small muted">設定未來時間再按「發布」即為排程。{p.status === 'future' && `目前排程：${twDateTime(p.published_at)}`}</p>
              <div className="toolbar">
                <button type="submit" name="intent" value="save">儲存</button>
                <button type="submit" name="intent" value="publish" className="primary">{p.status === 'publish' ? '更新' : '發布'}</button>
              </div>
              <p className="small muted">最後修改：{twDateTime(p.modified_at)} · #{p.id}</p>
              <input type="hidden" name="post_type" value={p.post_type} />
              <div className="toolbar">
                {p.status === 'trash' ? (
                  <>
                    <button type="submit" formAction={restoreContentAction}>從垃圾桶還原</button>
                    <ConfirmButton formAction={deleteContentAction} message="永久刪除後無法復原，確定？">永久刪除</ConfirmButton>
                  </>
                ) : (
                  <ConfirmButton formAction={trashContentAction} message="移至垃圾桶？">移至垃圾桶</ConfirmButton>
                )}
              </div>
            </div>
            {isPost && (
              <div className="card">
                <h3>分類</h3>
                <input type="hidden" name="terms_present" value="1" />
                <div className="checks">
                  {cats.map((c: any) => (
                    <label key={c.id}>
                      <input type="checkbox" name="category_ids" value={c.id} defaultChecked={p.term_ids.includes(Number(c.id))} /> {c.parent_id ? '— ' : ''}{c.name}
                    </label>
                  ))}
                </div>
                <h3 style={{ marginTop: 12 }}>標籤</h3>
                <input type="text" name="tag_names" defaultValue={tagNames} className="w100" placeholder="以逗號分隔" />
              </div>
            )}
            {isPage && (
              <div className="card">
                <h3>頁面屬性</h3>
                <label>上層頁面</label>
                <select name="parent_id" defaultValue={p.parent_id ?? ''} className="w100">
                  <option value="">（無）</option>
                  {parents.map((x: any) => <option key={x.id} value={x.id}>{x.title}</option>)}
                </select>
                <label>排序</label>
                <input type="number" name="menu_order" defaultValue={p.menu_order} />
                <label>範本</label>
                <input type="text" name="template" defaultValue={p.template} className="w100" placeholder="預設範本" />
              </div>
            )}
            {p.post_type !== 'wp_block' && (
              <div className="card">
                <h3>精選圖片</h3>
                <MediaField name="featured_media_id" initialId={p.featured_media_id} initialUrl={featured?.url} label="設定精選圖片" />
              </div>
            )}
            {isPost && (
              <div className="card">
                <h3>討論</h3>
                <input type="hidden" name="comment_status_present" value="1" />
                <input type="hidden" name="sticky_present" value="1" />
                <label className="inline"><input type="checkbox" name="comment_status" defaultChecked={p.comment_status === 'open'} /> 允許留言</label>
                <label className="inline"><input type="checkbox" name="sticky" defaultChecked={p.sticky} /> 置頂文章</label>
              </div>
            )}
            <p className="small"><Link href={`/admin/audit/?entity_id=${p.id}`}>此項目的稽核紀錄 →</Link></p>
          </div>
        </div>
      </form>
    </>
  )
}
