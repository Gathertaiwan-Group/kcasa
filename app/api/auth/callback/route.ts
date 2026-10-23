/** Supabase Auth email links (sign-up confirmation, password recovery) land here. */
import type { NextRequest } from 'next/server'
import { authClient } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const next = url.searchParams.get('next') || '/my-account/'
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/my-account/'
  if (code) {
    const sb = await authClient()
    await sb.auth.exchangeCodeForSession(code).catch(() => null)
  }
  return new Response(null, { status: 303, headers: { Location: safeNext } })
}
