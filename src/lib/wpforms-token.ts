/**
 * WPForms anti-spam token (replaces WordPress' `wpforms_get_token` AJAX action). The front-end script fetches a
 * token on first focus of the form and posts it back as `wpforms[token]`; tokens are an HMAC of the form id and the
 * UTC day, valid for the current and the two previous days (WPForms' token_cache_lifetime is one day).
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

const DAY = 86_400_000
const VALID_DAYS = 3

function secret(): string {
  const s = process.env.WPFORMS_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!s) throw new Error('no token secret configured')
  return s
}

function tokenFor(formId: number, day: number): string {
  return createHmac('sha256', secret()).update(`wpforms-token:${formId}:${day}`).digest('hex').slice(0, 32)
}

export function wpformsToken(formId: number, now = Date.now()): { token: string; time: number } {
  return { token: tokenFor(formId, Math.floor(now / DAY)), time: Math.floor(now / 1000) }
}

export function verifyWpformsToken(formId: number, token: string | undefined, now = Date.now()): boolean {
  if (!token || !/^[0-9a-f]{32}$/.test(token) || !Number.isFinite(formId)) return false
  const today = Math.floor(now / DAY)
  const got = Buffer.from(token)
  for (let d = 0; d < VALID_DAYS; d++) {
    if (timingSafeEqual(Buffer.from(tokenFor(formId, today - d)), got)) return true
  }
  return false
}

/** stamp a fresh token on every rendered WPForms <form> (the captured HTML carries the old site's static token) */
export function stampWpformsTokens(html: string): string {
  if (!html.includes('wpforms-form')) return html
  return html.replace(/(<form\b[^>]*\bdata-formid="(\d+)"[^>]*>)/g, (tag: string, _t: string, id: string) => {
    const { token, time } = wpformsToken(Number(id))
    let out = tag.replace(/\sdata-token="[^"]*"/, '').replace(/\sdata-token-time="[^"]*"/, '')
    out = out.replace(/>$/, ` data-token="${token}" data-token-time="${time}">`)
    return out
  })
}
