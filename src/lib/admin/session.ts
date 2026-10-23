/** Admin session: Supabase Auth cookie session + membership in site_kcasa.admins. */
import { redirect } from 'next/navigation'
import { authClient, currentUser } from '../auth'
import { svc } from '../sb'
import type { Actor } from './core'

export type AdminRole = 'owner' | 'admin' | 'editor' | 'shop_manager'
export type Admin = Actor & { id: string; role: AdminRole }

/** which roles may use which area of /admin (WordPress-like: editors = content, shop managers = shop) */
const AREAS: Record<string, AdminRole[]> = {
  content: ['owner', 'admin', 'editor', 'shop_manager'],
  media: ['owner', 'admin', 'editor', 'shop_manager'],
  shop: ['owner', 'admin', 'shop_manager'],
  orders: ['owner', 'admin', 'shop_manager'],
  menus: ['owner', 'admin', 'editor'],
  forms: ['owner', 'admin', 'editor', 'shop_manager'],
  settings: ['owner', 'admin'],
  redirects: ['owner', 'admin', 'editor'],
  audit: ['owner', 'admin'],
}

export function can(role: AdminRole, area: keyof typeof AREAS | string) {
  return (AREAS[area] || ['owner', 'admin']).includes(role)
}

export async function getAdmin(): Promise<Admin | null> {
  const user = await currentUser()
  if (!user) return null
  const { data } = await svc().from('admins').select('user_id,email,role').eq('user_id', user.id).maybeSingle()
  if (!data) return null
  return { id: user.id, email: data.email || user.email, role: data.role as AdminRole, via: 'admin' }
}

/** for pages and server actions: redirect to the login page unless the visitor is a site admin */
export async function requireAdmin(area?: string): Promise<Admin> {
  const a = await getAdmin()
  if (!a) redirect('/admin/login/')
  if (area && !can(a.role, area)) redirect('/admin/?denied=' + encodeURIComponent(area))
  return a
}

/** for route handlers: null when not allowed */
export async function adminOrNull(area?: string): Promise<Admin | null> {
  const a = await getAdmin()
  if (!a || (area && !can(a.role, area))) return null
  return a
}

export async function signIn(email: string, password: string): Promise<string | null> {
  const sb = await authClient()
  const { data, error } = await sb.auth.signInWithPassword({ email, password })
  if (error || !data.user) return '帳號或密碼錯誤。'
  const { data: row } = await svc().from('admins').select('user_id').eq('user_id', data.user.id).maybeSingle()
  if (!row) {
    await sb.auth.signOut().catch(() => null)
    return '此帳號沒有後台權限。'
  }
  return null
}

export async function signOut() {
  const sb = await authClient()
  await sb.auth.signOut().catch(() => null)
}
