/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from 'next/link'
import { newContentAction } from '../../actions'
import { Badge, decode, Notice, Pager, sp1, STATUS_LABEL, type SP } from '@/components/admin/ui'
import { listContent, statusCounts } from '@/lib/admin/content'
import { twDateTime } from '@/lib/admin/core'
import { requireAdmin } from '@/lib/admin/session'

export const metadata = { title: '內容' }
const TYPE_LABEL: Record<string, string> = { post: '文章', page: '頁面', wp_block: '可重用區塊' }

export default async function ContentList({ searchParams }: { searchParams: SP }) {
  await requireAdmin('content')
  const q = await searchParams
  const type = ['post', 'page', 'wp_block'].includes(sp1(q.type)) ? sp1(q.type) : 'post'
  const status = sp1(q.status)
  const search = sp1(q.s)
  const offset = Number(sp1(q.offset) || 0)
  const limit = 30
  const [{ rows, total }, counts] = await Promise.all([listContent({ type, status, search, offset, limit }), statusCounts(type)])
  const all = Object.entries(counts).filter(([k]) => k !== 'trash').reduce((a, [, v]) => a + v, 0)
  return (
    <>
      <h1>
        {TYPE_LABEL[type]}
        <form action={newContentAction}>
          <input type="hidden" name="post_type" value={type} />
          <button type="submit">新增{TYPE_LABEL[type]}</button>
        </form>
      </h1>
      <Notice q={q} />
      <div className="tabs">
        <Link href={`/admin/content/?type=${type}`} className={!status ? 'on' : ''}>全部 ({all})</Link>
        {['publish', 'future', 'draft', 'pending', 'private', 'trash'].filter((s) => counts[s]).map((s) => (
          <Link key={s} href={`/admin/content/?type=${type}&status=${s}`} className={status === s ? 'on' : ''}>
            | {STATUS_LABEL[s]} ({counts[s]})
          </Link>
        ))}
      </div>
      <form className="toolbar" action="/admin/content/">
        <input type="hidden" name="type" value={type} />
        {status && <input type="hidden" name="status" value={status} />}
        <input type="search" name="s" defaultValue={search} placeholder="搜尋標題" />
        <button type="submit">搜尋</button>
      </form>
      <table className="list">
        <thead>
          <tr>
            <th>標題</th>
            <th>網址</th>
            <th>狀態</th>
            <th>日期</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r: any) => (
            <tr key={r.id}>
              <td>
                <Link href={`/admin/content/${r.id}/`}><strong>{r.title || '（無標題）'}</strong></Link>
                <div className="row-actions">
                  #{r.id} {r.builder ? `· ${r.builder}` : ''}
                  {r.status === 'publish' && r.path && (
                    <>
                      {' · '}
                      <a href={decode(r.path)} target="_blank" rel="noreferrer">檢視</a>
                    </>
                  )}
                </div>
              </td>
              <td className="small">{decode(r.path)}</td>
              <td><Badge s={r.status} /></td>
              <td className="small">
                {r.status === 'future' ? '排程於 ' : r.status === 'publish' ? '發布於 ' : '修改於 '}
                {twDateTime(r.status === 'publish' || r.status === 'future' ? r.published_at : r.modified_at)}
              </td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={4} className="muted">沒有符合的項目。{type === 'wp_block' ? '舊站的 3 個可重用區塊會在資料庫備份匯入後出現。' : ''}</td>
            </tr>
          )}
        </tbody>
      </table>
      <Pager base="/admin/content/" params={{ type, status, s: search }} total={total} offset={offset} limit={limit} />
    </>
  )
}
