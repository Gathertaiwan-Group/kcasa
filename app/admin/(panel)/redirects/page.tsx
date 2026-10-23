/* eslint-disable @typescript-eslint/no-explicit-any */
import { deleteRedirectAction, saveRedirectAction } from '../../actions'
import { ConfirmButton } from '@/components/admin/Bits'
import { decode, Notice, Pager, sp1, type SP } from '@/components/admin/ui'
import { requireAdmin } from '@/lib/admin/session'
import { listRedirects } from '@/lib/admin/site-ops'

export const metadata = { title: '轉址' }

export default async function Redirects({ searchParams }: { searchParams: SP }) {
  await requireAdmin('redirects')
  const q = await searchParams
  const search = sp1(q.s)
  const kind = sp1(q.kind)
  const offset = Number(sp1(q.offset) || 0)
  const limit = 50
  const { rows, total } = await listRedirects({ search, kind, offset, limit })
  const back = `/admin/redirects/?${new URLSearchParams({ s: search, kind, offset: String(offset) }).toString()}`
  return (
    <>
      <h1>轉址管理</h1>
      <Notice q={q} />
      <form className="card toolbar" action={saveRedirectAction}>
        <input type="hidden" name="_back" value={back} />
        <input type="hidden" name="enabled" value="on" />
        <strong>新增：</strong>
        <input type="text" name="source_path" placeholder="舊網址路徑，例如 /old-page/" required style={{ minWidth: 240 }} />
        →
        <input type="text" name="target" placeholder="/new-page/ 或 https://…" required style={{ minWidth: 240 }} />
        <select name="status_code" defaultValue="301">
          <option value="301">301 永久</option><option value="302">302 暫時</option><option value="307">307</option><option value="308">308</option><option value="410">410 已移除</option>
        </select>
        <button type="submit" className="primary">新增轉址</button>
      </form>
      <form className="toolbar" action="/admin/redirects/">
        <input type="search" name="s" defaultValue={search} placeholder="搜尋來源或目標" />
        <select name="kind" defaultValue={kind}>
          <option value="">所有類型</option><option value="manual">手動</option><option value="auto">網址變更自動建立</option><option value="attachment">舊附件頁</option><option value="legacy">舊站</option>
        </select>
        <button type="submit">搜尋</button>
      </form>
      <table className="list">
        <thead><tr><th>來源</th><th>目標</th><th>代碼</th><th>啟用</th><th>類型</th><th></th></tr></thead>
        <tbody>
          {rows.map((r: any) => (
            <tr key={r.id}>
              <td colSpan={6} style={{ padding: 0 }}>
                <form action={saveRedirectAction} style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 90px 50px 90px 120px', gap: 8, padding: '6px 10px', alignItems: 'center' }}>
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="_back" value={back} />
                  <input type="text" name="source_path" defaultValue={decode(r.source_path)} />
                  <input type="text" name="target" defaultValue={decode(r.target)} />
                  <select name="status_code" defaultValue={String(r.status_code)}>
                    {['301', '302', '307', '308', '410'].map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <input type="checkbox" name="enabled" defaultChecked={r.enabled} aria-label="啟用" />
                  <span className="small muted">{r.kind}</span>
                  <span>
                    <button type="submit" className="link">儲存</button>{' · '}
                    <ConfirmButton className="link danger" formAction={deleteRedirectAction} message="刪除此轉址？">刪除</ConfirmButton>
                  </span>
                </form>
              </td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={6} className="muted">沒有符合的轉址。</td></tr>}
        </tbody>
      </table>
      <Pager base="/admin/redirects/" params={{ s: search, kind }} total={total} offset={offset} limit={limit} />
    </>
  )
}
