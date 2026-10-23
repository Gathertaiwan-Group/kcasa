/* Small HTML / URL helpers shared by the storefront renderer. */

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c] as string)
}

export function stripTags(s: string): string {
  return String(s || '').replace(/<[^>]*>/g, '')
}

/** decode %xx (WordPress stores slugs percent-encoded), NFC-normalise, lowercase ASCII. */
export function normPath(p: string): string {
  let s = p
  try {
    s = decodeURIComponent(p)
  } catch {
    /* keep raw */
  }
  return s.normalize('NFC').toLowerCase()
}

/** Encode a decoded path the way WordPress prints permalinks (lower-case %xx, slashes kept). */
export function wpEncodePath(p: string): string {
  return p
    .split('/')
    .map((seg) => encodeURIComponent(seg).replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase()))
    .join('/')
}

const SYMBOL = '&#78;&#84;&#36;'

export function fmtNumber(n: number | string | null | undefined): string {
  const v = Number(n || 0)
  return Math.round(v).toLocaleString('en-US')
}

/** WooCommerce wc_price() markup (TWD, 0 decimals). */
export function money(n: number | string | null | undefined): string {
  return `<span class="woocommerce-Price-amount amount"><bdi><span class="woocommerce-Price-currencySymbol">${SYMBOL}</span>${fmtNumber(n)}</bdi></span>`
}

export function moneyText(n: number | string | null | undefined): string {
  return `NT$${fmtNumber(n)}`
}

export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** "2025-04-25" in Asia/Taipei */
export function ymd(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(new Date(iso).getTime() + 8 * 3600 * 1000)
  return d.toISOString().slice(0, 10)
}

/** ISO 8601 with +08:00 like WordPress/Rank Math prints */
export function isoTw(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(new Date(iso).getTime() + 8 * 3600 * 1000)
  return d.toISOString().replace(/\.\d{3}Z$/, '+08:00')
}

export function siteUrl(): string {
  return (process.env.SITE_URL || 'https://kcasa.pro').replace(/\/$/, '')
}

export function randomToken(bytes = 24): string {
  const a = new Uint8Array(bytes)
  crypto.getRandomValues(a)
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function first(v: string | string[] | null | undefined): string {
  if (Array.isArray(v)) return v[0] ?? ''
  return v ?? ''
}
