import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const SCHEMA = 'site_kcasa'
export const BUCKET = 'site-kcasa'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>
let _svc: Client | null = null

/** Server-only client with the service role (bypasses RLS). Never import from client code. */
export function svc(): Client {
  if (_svc) return _svc
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing')
  _svc = createClient(url, key, {
    db: { schema: SCHEMA },
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-client-info': 'kcasa-site' } },
  }) as Client
  return _svc as Client
}

/** Fetch every row of a table/select in pages of 1000. */
export async function fetchAll<T = Record<string, unknown>>(table: string, select: string, order = 'id'): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; from < 200000; from += 1000) {
    const { data, error } = await svc().from(table).select(select).order(order, { ascending: true }).range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...((data || []) as T[]))
    if (!data || data.length < 1000) break
  }
  return out
}
