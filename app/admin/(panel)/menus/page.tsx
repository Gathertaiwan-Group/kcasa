/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from 'next/link'
import { addMenuItemAction, deleteMenuItemAction, saveMenuItemsAction } from '../../actions'
import { ConfirmButton } from '@/components/admin/Bits'
import { decode, Notice, sp1, type SP } from '@/components/admin/ui'
import { requireAdmin } from '@/lib/admin/session'
import { listMenus } from '@/lib/admin/site-ops'

export const metadata = { title: '選單' }
const LOC: Record<string, string> = { primary: '主選單（桌機）', secondary_menu: '次選單', mobile_menu: '手機選單', footer_menu: '頁尾選單（舊站未顯示）', wp_bottom_menu: '手機底部選單' }

export default async function Menus({ searchParams }: { searchParams: SP }) {
  await requireAdmin('menus')
  const q = await searchParams
  const menus = await listMenus()
  const cur = menus.find((m: any) => String(m.id) === sp1(q.menu)) || menus.find((m: any) => m.location === 'primary') || menus[0]
  const tops = cur ? cur.items.filter((i: any) => !i.parent_id) : []
  return (
    <>
      <h1>選單</h1>
      <Notice q={q} />
      <div className="tabs">
        {menus.map((m: any) => (
          <Link key={m.id} href={`/admin/menus/?menu=${m.id}`} className={m.id === cur?.id ? 'on' : ''}>
            {LOC[m.location] || m.name}（{m.items.length}）
          </Link>
        ))}
      </div>
      {cur && (
        <>
          <form className="card" action={saveMenuItemsAction}>
            <input type="hidden" name="menu_id" value={cur.id} />
            <h2>{LOC[cur.location] || cur.name} <span className="muted small">位置：{cur.location || '—'} · 來源：{cur.source || '—'}</span></h2>
            <table className="list">
              <thead><tr><th>排序</th><th>標題</th><th>網址</th><th>上層項目</th><th>開啟方式</th><th></th></tr></thead>
              <tbody>
                {cur.items.map((i: any) => (
                  <tr key={i.id}>
                    <td style={{ width: 70 }}><input type="hidden" name="item_ids" value={i.id} /><input type="number" name={`i${i.id}_position`} defaultValue={i.position} /></td>
                    <td>{i.parent_id ? '— ' : ''}<input type="text" name={`i${i.id}_title`} defaultValue={i.title} /></td>
                    <td><input type="text" name={`i${i.id}_url`} defaultValue={decode(i.url)} /></td>
                    <td>
                      <select name={`i${i.id}_parent_id`} defaultValue={i.parent_id ?? ''}>
                        <option value="">（最上層）</option>
                        {tops.filter((t: any) => t.id !== i.id).map((t: any) => <option key={t.id} value={t.id}>{t.title}</option>)}
                      </select>
                    </td>
                    <td>
                      <select name={`i${i.id}_target`} defaultValue={i.target || ''}>
                        <option value="">同一視窗</option>
                        <option value="_blank">新視窗</option>
                      </select>
                    </td>
                    <td><ConfirmButton className="link danger" formAction={deleteMenuItemAction} name="id" value={String(i.id)} message={`刪除「${i.title}」？`}>刪除</ConfirmButton></td>
                  </tr>
                ))}
                {!cur.items.length && <tr><td colSpan={6} className="muted">此選單沒有項目。</td></tr>}
              </tbody>
            </table>
            <p><button type="submit" className="primary">儲存選單</button></p>
          </form>
          <form className="card toolbar" action={addMenuItemAction}>
            <input type="hidden" name="menu_id" value={cur.id} />
            <strong>新增項目：</strong>
            <input type="text" name="title" placeholder="標題" required />
            <input type="text" name="url" placeholder="/shop/ 或 https://…" required />
            <select name="parent_id" defaultValue="">
              <option value="">（最上層）</option>
              {tops.map((t: any) => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
            <input type="number" name="position" placeholder="排序" style={{ width: 80 }} defaultValue={cur.items.length} />
            <select name="target" defaultValue=""><option value="">同一視窗</option><option value="_blank">新視窗</option></select>
            <button type="submit">新增</button>
          </form>
          <p className="small muted">選單儲存後約 30 秒內反映到前台。原 WordPress 的選單設定（nav_menu_item）會在資料庫備份匯入後補上 wp_id。</p>
        </>
      )}
    </>
  )
}
