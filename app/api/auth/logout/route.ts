import { authClient } from '@/lib/auth'

export const dynamic = 'force-dynamic'

async function logout() {
  const sb = await authClient()
  await sb.auth.signOut().catch(() => null)
  return new Response(null, { status: 303, headers: { Location: '/my-account/' } })
}
export const GET = logout
export const POST = logout
