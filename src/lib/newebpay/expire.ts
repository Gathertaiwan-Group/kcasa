/**
 * Expiry of unpaid 藍新 orders before a stock check. Kept out of ./index (which router.ts imports) so the
 * site cache / page-cache imports do not join the router ↔ newebpay ↔ admin/core import cycle.
 */
import { purgePublicPages } from '../page-cache'
import { invalidateSite } from '../site'
import { cancelUnpaidNewebpayOrders } from './index'

/** run the expiry before a stock check (add to cart / checkout); refresh cached stock when anything was released */
export async function releaseExpiredHolds(): Promise<number> {
  const n = await cancelUnpaidNewebpayOrders().catch(() => 0)
  if (n > 0) {
    invalidateSite()
    await purgePublicPages().catch(() => undefined)
  }
  return n
}
