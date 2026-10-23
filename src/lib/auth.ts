/* eslint-disable @typescript-eslint/no-explicit-any */
/** Customer accounts (WooCommerce "My account") on Supabase Auth, cookie session via @supabase/ssr. */
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { svc } from './sb'

export async function authClient() {
  const store = await cookies()
  return createServerClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options)
        } catch {
          /* read-only context */
        }
      },
    },
  })
}

export type SessionUser = { id: string; email: string }

export async function currentUser(): Promise<SessionUser | null> {
  const store = await cookies()
  if (!store.getAll().some((c) => c.name.startsWith('sb-'))) return null
  try {
    const sb = await authClient()
    const { data } = await sb.auth.getUser()
    if (!data.user) return null
    return { id: data.user.id, email: data.user.email || '' }
  } catch {
    return null
  }
}

/** site_kcasa.customers row for an auth user (created on first use). */
export async function customerFor(user: SessionUser, extra: Record<string, any> = {}): Promise<any> {
  const db = svc()
  const { data } = await db.from('customers').select('*').eq('auth_user_id', user.id).maybeSingle()
  if (data) return data
  // an imported WooCommerce customer with the same email gets linked to the new login
  const { data: byEmail } = await db.from('customers').select('*').ilike('email', user.email).is('auth_user_id', null).limit(1).maybeSingle()
  if (byEmail) {
    const { data: upd } = await db.from('customers').update({ auth_user_id: user.id }).eq('id', byEmail.id).select('*').single()
    return upd
  }
  const { data: created, error } = await db
    .from('customers')
    .insert({ auth_user_id: user.id, email: user.email, username: user.email.split('@')[0], display_name: user.email.split('@')[0], registered_at: new Date().toISOString(), ...extra })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return created
}
