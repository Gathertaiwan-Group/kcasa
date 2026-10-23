import type { Metadata } from 'next'
import './admin.css'

export const metadata: Metadata = { title: { default: '網站管理 - Kcasa 工富家飾', template: '%s ‹ Kcasa 後台' }, robots: { index: false, follow: false } }

export default function AdminRoot({ children }: { children: React.ReactNode }) {
  return <div className="adm">{children}</div>
}
