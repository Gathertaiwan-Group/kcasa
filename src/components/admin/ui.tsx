/** Server-side presentational helpers for /admin pages. */
import Link from 'next/link'

export type SP = Promise<Record<string, string | string[] | undefined>>

export function sp1(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] || '' : v || ''
}

export const STATUS_LABEL: Record<string, string> = {
  publish: '已發布',
  draft: '草稿',
  pending: '待審閱',
  private: '私密',
  future: '已排程',
  trash: '垃圾桶',
  inherit: '附件',
  instock: '有庫存',
  outofstock: '缺貨',
  onbackorder: '可預購',
  new: '未讀',
  read: '已讀',
  spam: '垃圾訊息',
}

export function Badge({ s, label }: { s: string; label?: string }) {
  return <span className={`badge ${s}`}>{label || STATUS_LABEL[s] || s}</span>
}

export function Notice({ q }: { q: Record<string, string | string[] | undefined> }) {
  const msg = sp1(q.msg)
  const err = sp1(q.err)
  const denied = sp1(q.denied)
  return (
    <>
      {msg && <div className="notice">{msg}</div>}
      {err && <div className="notice err">{err}</div>}
      {denied && <div className="notice warn">你的角色沒有「{denied}」的權限。</div>}
    </>
  )
}

export function Pager({ base, params, total, offset, limit }: { base: string; params: Record<string, string>; total: number; offset: number; limit: number }) {
  if (total <= limit) return <div className="pager muted">共 {total} 筆</div>
  const mk = (o: number) => {
    const p = new URLSearchParams({ ...params, offset: String(o) })
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k)
    return `${base}?${p.toString()}`
  }
  const page = Math.floor(offset / limit) + 1
  const pages = Math.ceil(total / limit)
  return (
    <div className="pager">
      <span className="muted">共 {total} 筆</span>
      {offset > 0 ? <Link href={mk(0)}>« 第一頁</Link> : <span className="muted">« 第一頁</span>}
      {offset > 0 ? <Link href={mk(Math.max(0, offset - limit))}>‹ 上一頁</Link> : <span className="muted">‹ 上一頁</span>}
      <span>
        {page} / {pages}
      </span>
      {offset + limit < total ? <Link href={mk(offset + limit)}>下一頁 ›</Link> : <span className="muted">下一頁 ›</span>}
      {offset + limit < total ? <Link href={mk((pages - 1) * limit)}>最後一頁 »</Link> : <span className="muted">最後一頁 »</span>}
    </div>
  )
}

export function money(n: unknown) {
  if (n === null || n === undefined || n === '') return '—'
  return 'NT$' + Number(n).toLocaleString('zh-TW', { maximumFractionDigits: 2 })
}

export function decode(s: string | null | undefined) {
  if (!s) return ''
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}
