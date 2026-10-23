'use client'
/** Small client helpers for /admin: confirm-before-submit, preview, media page uploader with refresh. */
import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import { Uploader } from './Uploader'

export function ConfirmButton({ children, message = '確定要執行嗎？', className = 'danger', name, value, formAction }: { children: ReactNode; message?: string; className?: string; name?: string; value?: string; formAction?: (fd: FormData) => void | Promise<void> }) {
  return (
    <button
      type="submit"
      className={className}
      name={name}
      value={value}
      formAction={formAction}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault()
      }}
    >
      {children}
    </button>
  )
}

/** saves the form's current (unsaved) values as a preview snapshot and opens it in a new tab */
export function PreviewButton({ formId, kind, id }: { formId: string; kind: 'post' | 'product'; id: number }) {
  return (
    <button
      type="button"
      onClick={async () => {
        const w = window.open('about:blank', '_blank')
        const form = document.getElementById(formId) as HTMLFormElement | null
        if (!form) return
        const fd = new FormData(form)
        fd.set('_kind', kind)
        fd.set('_id', String(id))
        const r = await fetch('/admin/preview/', { method: 'POST', body: fd })
        const j = await r.json().catch(() => ({}))
        if (j.url && w) w.location.href = j.url
        else {
          w?.close()
          alert(j.error || '預覽失敗')
        }
      }}
    >
      預覽
    </button>
  )
}

export function MediaUploadPanel() {
  const router = useRouter()
  return <Uploader onDone={() => router.refresh()} />
}
