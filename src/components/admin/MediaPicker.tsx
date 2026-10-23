'use client'
import { useCallback, useEffect, useState } from 'react'
import { Uploader } from './Uploader'

export type PickedMedia = { id: number; url: string; title: string; alt_text: string; mime_type: string; width: number | null; height: number | null }

export function MediaPicker({ onPick, onClose, mime }: { onPick: (m: PickedMedia) => void; onClose: () => void; mime?: string }) {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<PickedMedia[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)

  const load = useCallback(
    async (search: string, off: number) => {
      setLoading(true)
      const p = new URLSearchParams({ search, offset: String(off), limit: '60' })
      if (mime) p.set('mime', mime)
      const r = await fetch('/admin/api/media/?' + p.toString(), { cache: 'no-store' })
      const j = await r.json().catch(() => ({ rows: [], total: 0 }))
      setRows(off ? (prev) => [...prev, ...(j.rows || [])] : j.rows || [])
      setTotal(j.total || 0)
      setLoading(false)
    },
    [mime],
  )

  useEffect(() => {
    const t = setTimeout(() => {
      setOffset(0)
      void load(q, 0)
    }, 250)
    return () => clearTimeout(t)
  }, [q, load])

  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <div className="picker" role="dialog" aria-label="媒體庫">
        <div className="ph">
          <strong>媒體庫</strong>
          <input type="search" placeholder="搜尋檔名 / 標題 / 替代文字" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
          <Uploader compact onDone={(list) => { if (list[0]) onPick(list[0] as PickedMedia); else void load(q, 0) }} />
          <button type="button" onClick={onClose}>關閉</button>
        </div>
        <div className="pb">
          <div className="media-grid">
            {rows.map((m) => (
              <div key={m.id} className="m" onClick={() => onPick(m)} title={m.title}>
                {m.mime_type.startsWith('image/') ? <img src={m.url} alt={m.alt_text} loading="lazy" /> : <div className="f">{m.mime_type}</div>}
                <div className="c">#{m.id} {m.title}</div>
              </div>
            ))}
          </div>
          <div className="pager">
            <span className="muted">{rows.length} / {total}</span>
            {rows.length < total && (
              <button type="button" disabled={loading} onClick={() => { const o = offset + 60; setOffset(o); void load(q, o) }}>
                載入更多
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

/** featured image style field: hidden id input + thumbnail + pick/remove */
export function MediaField({ name, initialId, initialUrl, label = '選擇圖片' }: { name: string; initialId: number | null; initialUrl?: string | null; label?: string }) {
  const [id, setId] = useState<number | null>(initialId)
  const [url, setUrl] = useState<string | null>(initialUrl || null)
  const [open, setOpen] = useState(false)
  return (
    <div>
      <input type="hidden" name={name} value={id ?? ''} />
      {url ? <img src={url} alt="" style={{ width: '100%', maxHeight: 200, objectFit: 'contain', background: '#f0f0f1', border: '1px solid #dcdcde', borderRadius: 4 }} /> : <div className="muted small">未設定</div>}
      <div className="toolbar" style={{ marginTop: 6 }}>
        <button type="button" onClick={() => setOpen(true)}>{label}</button>
        {id && <button type="button" className="danger" onClick={() => { setId(null); setUrl(null) }}>移除</button>}
        {id && <span className="muted small">#{id}</span>}
      </div>
      {open && <MediaPicker mime="image" onClose={() => setOpen(false)} onPick={(m) => { setId(m.id); setUrl(m.url); setOpen(false) }} />}
    </div>
  )
}

/** product gallery: ordered list of media ids */
export function GalleryField({ name, initial }: { name: string; initial: { id: number; url: string }[] }) {
  const [items, setItems] = useState(initial)
  const [open, setOpen] = useState(false)
  return (
    <div>
      <input type="hidden" name={name} value={items.map((i) => i.id).join(',')} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {items.map((m, i) => (
          <div key={m.id + '-' + i} style={{ position: 'relative' }}>
            <img src={m.url} alt="" className="thumb" style={{ width: 64, height: 64 }} />
            <button type="button" className="link danger" style={{ position: 'absolute', top: -6, right: -4, background: '#fff', borderRadius: 8, padding: '0 4px' }} onClick={() => setItems(items.filter((_, j) => j !== i))} aria-label="移除">×</button>
          </div>
        ))}
      </div>
      <button type="button" style={{ marginTop: 6 }} onClick={() => setOpen(true)}>加入圖片</button>
      {open && <MediaPicker mime="image" onClose={() => setOpen(false)} onPick={(m) => { setItems([...items, { id: m.id, url: m.url }]); setOpen(false) }} />}
    </div>
  )
}
