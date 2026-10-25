/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from 'next/link'
import { deleteMediaAction, saveMediaAction } from '../../actions'
import { ConfirmButton, MediaUploadPanel } from '@/components/admin/Bits'
import { Notice, Pager, sp1, type SP } from '@/components/admin/ui'
import { twDateTime } from '@/lib/admin/core'
import { requireAdmin } from '@/lib/admin/session'
import { getMedia, listMedia } from '@/lib/admin/site-ops'

export const metadata = { title: '媒體庫' }

export default async function Media({ searchParams }: { searchParams: SP }) {
  await requireAdmin('media')
  const q = await searchParams
  const search = sp1(q.s)
  const mime = sp1(q.mime)
  const offset = Number(sp1(q.offset) || 0)
  const limit = 60
  const editId = Number(sp1(q.edit) || 0)
  const [{ rows, total }, edit] = await Promise.all([listMedia({ search, mime, offset, limit }), editId ? getMedia(editId).catch(() => null) : Promise.resolve(null)])
  const back = `/admin/media/?${new URLSearchParams({ s: search, mime, offset: String(offset), edit: String(editId) }).toString()}`
  return (
    <>
      <h1>媒體庫</h1>
      <Notice q={q} />
      <div className="card">
        <MediaUploadPanel />
        <p className="small muted" style={{ marginBottom: 0 }}>圖片會自動轉成 WebP（最長邊 2000px、品質 80）；GIF、影片、PDF 以原檔儲存。相同檔案不會重複上傳。</p>
      </div>
      <form className="toolbar" action="/admin/media/">
        <input type="search" name="s" defaultValue={search} placeholder="搜尋檔名 / 標題 / 替代文字" />
        <select name="mime" defaultValue={mime}>
          <option value="">所有類型</option>
          <option value="image">圖片</option>
          <option value="video">影片</option>
          <option value="application/pdf">PDF</option>
        </select>
        <button type="submit">篩選</button>
      </form>
      {edit && (
        <div className="card grid2" style={{ gridTemplateColumns: '300px 1fr' }}>
          <div>{!edit.url ? <p className="muted">（私有附件：只匯入資料，檔案未上傳到公開空間）</p> : edit.mime_type.startsWith('image/') ? <img src={edit.url} alt={edit.alt_text} style={{ width: '100%' }} /> : <a href={edit.url} target="_blank" rel="noreferrer">{edit.url}</a>}</div>
          <form action={saveMediaAction}>
            <input type="hidden" name="id" value={edit.id} />
            <input type="hidden" name="_back" value={back} />
            <dl className="kv">
              <dt>ID</dt><dd>#{edit.id}</dd>
              <dt>檔案網址</dt><dd><input type="text" readOnly value={edit.url || ''} className="w100" /></dd>
              <dt>類型</dt><dd>{edit.mime_type}{edit.orig_mime_type && edit.orig_mime_type !== edit.mime_type ? `（原 ${edit.orig_mime_type}）` : ''}</dd>
              <dt>尺寸</dt><dd>{edit.width ? `${edit.width} × ${edit.height}` : '—'} · {edit.filesize ? `${Math.round(edit.filesize / 1024)} KB` : ''}</dd>
              <dt>上傳時間</dt><dd>{twDateTime(edit.published_at || edit.created_at)}</dd>
              {edit.is_private && (<><dt>私有</dt><dd>是（舊站私有附件或未發佈商品的圖片；僅匯入資料，未上傳檔案）</dd></>)}
            </dl>
            <label>標題</label>
            <input type="text" name="title" defaultValue={edit.title} className="w100" />
            <label>替代文字（alt）</label>
            <input type="text" name="alt_text" defaultValue={edit.alt_text} className="w100" />
            <label>說明文字</label>
            <textarea name="caption_html" defaultValue={edit.caption_html} />
            <p className="toolbar">
              <button type="submit" className="primary">儲存</button>
              <ConfirmButton formAction={deleteMediaAction} message="永久刪除此檔案？已使用此檔案的頁面會出現破圖。">永久刪除</ConfirmButton>
              <Link href={back.replace(/&?edit=\d+/, '')}>關閉</Link>
            </p>
          </form>
        </div>
      )}
      <div className="media-grid">
        {rows.map((m: any) => (
          <Link key={m.id} className="m" href={`/admin/media/?${new URLSearchParams({ s: search, mime, offset: String(offset), edit: String(m.id) }).toString()}`} title={m.title}>
            {m.url && m.mime_type.startsWith('image/') ? <img src={m.url} alt={m.alt_text} loading="lazy" /> : <div className="f">{m.is_private ? '私有 · ' : ''}{m.mime_type}</div>}
            <div className="c">#{m.id} {m.title}</div>
          </Link>
        ))}
      </div>
      <Pager base="/admin/media/" params={{ s: search, mime }} total={total} offset={offset} limit={limit} />
    </>
  )
}
