/**
 * Analytics / ads tags (GTM, GA4, Google Ads, AdSense, custom tracking HTML) are only emitted on the client's real
 * production host, so test traffic and test orders on *.vercel.app never reach the client's GA4 / Google Ads.
 * TRACKING_HOSTS (comma separated) overrides the default host list; DISABLE_TRACKING=1 turns tracking off everywhere.
 */
import { AsyncLocalStorage } from 'node:async_hooks'

const DEFAULT_HOSTS = 'kcasa.pro,www.kcasa.pro'
const store = new AsyncLocalStorage<boolean>()

export function trackingHost(host: string): boolean {
  if (process.env.DISABLE_TRACKING === '1') return false
  const allowed = (process.env.TRACKING_HOSTS || DEFAULT_HOSTS).split(',').map((h) => h.trim().toLowerCase()).filter(Boolean)
  return allowed.includes(host.toLowerCase().replace(/:\d+$/, ''))
}

/** run a page render with tracking on/off for the request host */
export function withTracking<T>(host: string, fn: () => T): T {
  return store.run(trackingHost(host), fn)
}

/** whether the page being rendered may contain tracking tags (off outside a request scope) */
export function trackingEnabled(): boolean {
  return process.env.DISABLE_TRACKING !== '1' && store.getStore() === true
}
