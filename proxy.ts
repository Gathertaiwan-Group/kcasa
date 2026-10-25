/**
 * Runs before the Vercel CDN cache. Storefront requests that carry a per-visitor cookie (cart, flash notice,
 * saved checkout form, customer login) are rewritten with a marker query parameter, so they never receive the
 * shared cached copy of a public page; the route handler strips the marker and answers them uncached.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { PRIVATE_PARAM, hasPrivateCookies } from '@/lib/page-cache'

export function proxy(req: NextRequest) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return NextResponse.next()
  if (!hasPrivateCookies(req.cookies.getAll().map((c) => c.name))) return NextResponse.next()
  const url = req.nextUrl.clone()
  url.searchParams.set(PRIVATE_PARAM, '1')
  return NextResponse.rewrite(url)
}

export const config = {
  // storefront pages only: not the admin, APIs, Next assets or static files (paths with an extension)
  matcher: ['/((?!admin|api/|_next/|legacy/|kc/|favicon\\.ico)(?:[^.]*))'],
}
