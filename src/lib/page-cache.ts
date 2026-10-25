/** Shared bits of the public-page CDN cache (route handler, proxy.ts, admin/MCP write hook). */

export const PAGE_CACHE_TAG = 'kcasa-pages'

/** query marker proxy.ts adds so per-visitor requests get their own (never stored) CDN cache key */
export const PRIVATE_PARAM = '__kc_private'

/** cookies that change what a storefront page shows (cart, flash notices, saved checkout form, login) */
export function hasPrivateCookies(names: string[]): boolean {
  return names.some((n) => n === 'kc_cart' || n === 'kc_notice' || n === 'kc_checkout_form' || n === 'woocommerce_items_in_cart' || n.startsWith('sb-'))
}

/**
 * After an admin / MCP write: purge the cached public pages (Vercel CDN tag + Next.js cache).
 * Never throws — a failed purge only means pages refresh on their 5-minute schedule.
 */
export async function purgePublicPages(): Promise<void> {
  try {
    const { revalidatePath, revalidateTag } = await import('next/cache')
    revalidateTag(PAGE_CACHE_TAG, 'max')
    revalidatePath('/', 'layout')
  } catch (e) {
    console.error('[purge] next', e)
  }
  try {
    const { invalidateByTag } = await import('@vercel/functions')
    await invalidateByTag(PAGE_CACHE_TAG)
  } catch (e) {
    console.error('[purge] vercel', e)
  }
}
