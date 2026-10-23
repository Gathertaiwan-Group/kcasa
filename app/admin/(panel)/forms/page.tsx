/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from 'next/link'
import { submissionStatusAction } from '../../actions'
import { Badge, Notice, Pager, sp1, type SP } from '@/components/admin/ui'
import { twDateTime } from '@/lib/admin/core'
import { requireAdmin } from '@/lib/admin/session'
import { listForms, listSubmissions } from '@/lib/admin/site-ops'

export const metadata = { title: '表單提交' }

export default async function Forms({ searchParams }: { searchParams: SP }) {
  await requireAdmin('forms')
  const q = await searchParams
  const forms = await listForms()
  const formId = Number(sp1(q.form) || forms[0]?.id || 0)
  const status = sp1(q.status)
  const offset = Number(sp1(q.offset) || 0)
  const limit = 30
  const { rows, total } = await listSubmissions({ form_id: formId || undefined, status, offset, limit })
  const form = forms.find((f: any) => Number(f.id) === formId)
  const keys: string[] = []
  for (const r of rows) for (const k of Object.keys(r.data || {})) if (!keys.includes(k)) keys.push(k)
  const back = `/admin/forms/?${new URLSearchParams({ form: String(formId), status, offset: String(offset) }).toString()}`
  return (
    <>
      <h1>
        表單提交
        <a className="btn" href={`/admin/forms/export/?form=${formId}${status ? `&status=${status}` : ''}`}>匯出 CSV</a>
      </h1>
      <Notice q={q} />
      <div className="tabs">
        {forms.map((f: any) => <Link key={f.id} href={`/admin/forms/?form=${f.id}`} className={Number(f.id) === formId ? 'on' : ''}>{f.title}（{f.submission_count}）</Link>)}
      </div>
      <div className="tabs">
        {[['', '全部'], ['new', '未讀'], ['read', '已讀'], ['spam', '垃圾訊息'], ['trash', '垃圾桶']].map(([s, l]) => (
          <Link key={s} href={`/admin/forms/?form=${formId}${s ? `&status=${s}` : ''}`} className={status === s ? 'on' : ''}>{l}</Link>
        ))}
      </div>
      {form && <p className="small muted">表單所在頁面：{form.page_path ? <a href={form.page_path} target="_blank" rel="noreferrer">{form.page_path}</a> : '—'}</p>}
      <table className="list">
        <thead><tr><th>時間</th>{keys.map((k) => <th key={k}>{k}</th>)}<th>狀態</th><th></th></tr></thead>
        <tbody>
          {rows.map((r: any) => (
            <tr key={r.id}>
              <td className="small">{twDateTime(r.created_at)}<div className="row-actions">#{r.id} {r.page_url}</div></td>
              {keys.map((k) => <td key={k} style={{ whiteSpace: 'pre-wrap', maxWidth: 360 }}>{typeof r.data?.[k] === 'object' ? JSON.stringify(r.data[k]) : String(r.data?.[k] ?? '')}</td>)}
              <td><Badge s={r.status} /></td>
              <td>
                <form action={submissionStatusAction} className="toolbar" style={{ margin: 0 }}>
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="_back" value={back} />
                  {r.status !== 'read' && <button type="submit" className="link" name="status" value="read">標為已讀</button>}
                  {r.status !== 'new' && <button type="submit" className="link" name="status" value="new">標為未讀</button>}
                  {r.status !== 'spam' && <button type="submit" className="link" name="status" value="spam">垃圾訊息</button>}
                  {r.status !== 'trash' && <button type="submit" className="link danger" name="status" value="trash">刪除</button>}
                </form>
              </td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={keys.length + 3} className="muted">尚無提交。舊站 WPForms 的歷史提交會在資料庫備份匯入後出現。</td></tr>}
        </tbody>
      </table>
      <Pager base="/admin/forms/" params={{ form: String(formId), status }} total={total} offset={offset} limit={limit} />
    </>
  )
}
