import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getAdmin } from '@/lib/admin/session'
import { LoginForm } from './LoginForm'

export const dynamic = 'force-dynamic'
export const metadata = { title: '登入' }

export default async function LoginPage() {
  if (await getAdmin()) redirect('/admin/')
  return (
    <div className="login">
      <h1 style={{ justifyContent: 'center' }}>Kcasa 工富家飾 · 後台</h1>
      <div className="card">
        <LoginForm />
      </div>
      <p className="muted small" style={{ textAlign: 'center' }}>
        <Link href="/">← 回到網站</Link>
      </p>
    </div>
  )
}
