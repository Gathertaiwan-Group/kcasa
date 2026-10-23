/* eslint-disable @typescript-eslint/no-explicit-any */
import { Notice, Pager, sp1, type SP } from '@/components/admin/ui'
import { twDateTime } from '@/lib/admin/core'
import { requireAdmin } from '@/lib/admin/session'
import { listAudit } from '@/lib/admin/site-ops'

export const metadata = { title: '稽核紀錄' }

export default async function Audit({ searchParams }: { searchParams: SP }) {
  await requireAdmin('audit')
  const q = await searchParams
  const f = { actor: sp1(q.actor), entity_type: sp1(q.entity_type), entity_id: sp1(q.entity_id), via: sp1(q.via) }
  const offset = Number(sp1(q.offset) || 0)
  const limit = 50
  const { rows, total } = await listAudit({ ...f, offset, limit })
  return (
    <>
      <h1>稽核紀錄</h1>
      <Notice q={q} />
      <form className="toolbar" action="/admin/audit/">
        <input type="search" name="actor" defaultValue={f.actor} placeholder="操作者" />
        <input type="text" name="entity_type" defaultValue={f.entity_type} placeholder="對象類型（post、product…）" />
        <input type="text" name="entity_id" defaultValue={f.entity_id} placeholder="對象 ID" />
        <select name="via" defaultValue={f.via}>
          <option value="">所有來源</option><option value="admin">後台</option><option value="mcp">MCP</option><option value="system">系統</option><option value="import">匯入</option>
        </select>
        <button type="submit">篩選</button>
      </form>
      <table className="list">
        <thead><tr><th>時間</th><th>操作者</th><th>動作</th><th>對象</th><th>變更</th></tr></thead>
        <tbody>
          {rows.map((a: any) => (
            <tr key={a.id}>
              <td className="small" style={{ whiteSpace: 'nowrap' }}>{twDateTime(a.created_at)}</td>
              <td className="small">{a.actor} <span className="badge">{a.via}</span></td>
              <td className="small">{a.action}</td>
              <td className="small">{a.entity_type} {a.entity_id}</td>
              <td style={{ maxWidth: 520 }}>
                {(a.before || a.after) && (
                  <details>
                    <summary className="small">檢視</summary>
                    {a.before && <><div className="small muted">之前</div><pre className="json">{JSON.stringify(a.before, null, 2)}</pre></>}
                    {a.after && <><div className="small muted">之後</div><pre className="json">{JSON.stringify(a.after, null, 2)}</pre></>}
                  </details>
                )}
              </td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={5} className="muted">沒有紀錄。</td></tr>}
        </tbody>
      </table>
      <Pager base="/admin/audit/" params={f} total={total} offset={offset} limit={limit} />
    </>
  )
}
