'use client'
/**
 * Media upload. Images go to /admin/api/media/upload (server converts to WebP ≤2000px q80); images
 * larger than the function body limit are first scaled down in the browser. Large GIF / video / PDF
 * files are uploaded straight to storage with a signed URL and then registered.
 */
import { useRef, useState } from 'react'

const BODY_LIMIT = 3.8 * 1024 * 1024
const RASTER = /^image\/(jpeg|png|webp|avif|bmp|tiff)$/

async function shrink(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * scale)
  c.height = Math.round(bmp.height * scale)
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  return await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), 'image/webp', 0.92))
}

type Done = { id: number; url: string; title: string; alt_text: string; mime_type: string; width: number | null; height: number | null }

export function Uploader({ onDone, compact = false }: { onDone?: (list: Done[]) => void; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const [log, setLog] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  async function one(file: File): Promise<Done> {
    if (!RASTER.test(file.type) && file.size > BODY_LIMIT) {
      const s = await fetch('/admin/api/media/sign/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: file.name, mime: file.type }) })
      const sj = await s.json()
      if (!s.ok) throw new Error(sj.error || 'sign failed')
      const put = await fetch(sj.signedUrl, { method: 'PUT', headers: { 'Content-Type': file.type, 'x-upsert': 'false' }, body: file })
      if (!put.ok) throw new Error('storage upload failed: ' + put.status)
      const r = await fetch('/admin/api/media/register/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: sj.path, mime: file.type, size: file.size, title: file.name.replace(/\.[^.]+$/, '') }) })
      const rj = await r.json()
      if (!r.ok) throw new Error(rj.error || 'register failed')
      return rj
    }
    let body: Blob = file
    let name = file.name
    if (RASTER.test(file.type) && file.size > BODY_LIMIT) {
      body = await shrink(file)
      name = file.name.replace(/\.[^.]+$/, '') + '.webp'
    }
    const fd = new FormData()
    fd.set('file', body, name)
    const r = await fetch('/admin/api/media/upload/', { method: 'POST', body: fd })
    const j = await r.json().catch(() => ({ error: 'HTTP ' + r.status }))
    if (!r.ok) throw new Error(j.error || 'upload failed')
    return j
  }

  async function onFiles(files: FileList | null) {
    if (!files || !files.length) return
    setBusy(true)
    const done: Done[] = []
    for (const f of Array.from(files)) {
      setLog((l) => [...l, `上傳中：${f.name}`])
      try {
        const m = await one(f)
        done.push(m)
        setLog((l) => [...l, `✓ ${f.name} → #${m.id}${(m as { duplicate?: boolean }).duplicate ? '（已存在，未重複上傳）' : ''}`])
      } catch (e) {
        setLog((l) => [...l, `✗ ${f.name}：${e instanceof Error ? e.message : e}`])
      }
    }
    setBusy(false)
    if (input.current) input.current.value = ''
    onDone?.(done)
  }

  return (
    <div style={compact ? { display: 'inline-block' } : undefined}>
      <input ref={input} type="file" multiple accept="image/*,video/mp4,video/webm,video/quicktime,application/pdf" hidden onChange={(e) => onFiles(e.target.files)} />
      <button type="button" className="primary" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? '上傳中…' : '上傳檔案'}
      </button>
      {!compact && log.length > 0 && (
        <pre className="json" style={{ marginTop: 8 }}>{log.join('\n')}</pre>
      )}
    </div>
  )
}
