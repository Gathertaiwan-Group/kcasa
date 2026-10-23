/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Shared plumbing for the admin panel (/admin) and the MCP endpoint (/api/mcp):
 * who is acting, the audit trail, cache invalidation and small helpers.
 * Every write in src/lib/admin/* goes through svc() (service role) and ends with audit().
 */
import { svc } from '../sb'
import { bumpContentVersion } from '../site'
import { invalidateRouterCaches } from '../router'

export type Actor = { email: string; id?: string | null; via: 'admin' | 'mcp' | 'system'; role?: string }

export class OpError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

export function must<T>(r: { data: T | null; error: { message: string } | null }, what = 'query'): T {
  if (r.error) throw new OpError(`${what}: ${r.error.message}`, 500)
  return r.data as T
}

/** write one row to site_kcasa.audit_log (never throws — a failed audit write is logged) */
export async function audit(actor: Actor, action: string, entityType: string, entityId: string | number | null, before: any, after: any) {
  const { error } = await svc()
    .from('audit_log')
    .insert({
      actor: actor.email,
      actor_id: actor.id || null,
      via: actor.via,
      action,
      entity_type: entityType,
      entity_id: entityId === null || entityId === undefined ? null : String(entityId),
      before: slim(before),
      after: slim(after),
    })
  if (error) console.error('[audit]', error.message)
}

/** keep audit rows small: long html fields are truncated */
function slim(v: any): any {
  if (v === null || v === undefined) return null
  if (typeof v !== 'object') return v
  if (Array.isArray(v)) return v.slice(0, 200).map(slim)
  const out: Record<string, any> = {}
  for (const [k, x] of Object.entries(v)) {
    if (typeof x === 'string' && x.length > 4000) out[k] = x.slice(0, 4000) + `…[${x.length} chars]`
    else out[k] = x && typeof x === 'object' ? slim(x) : x
  }
  return out
}

/** changed keys only (for audit "before/after") */
export function diff(before: Record<string, any> | null, after: Record<string, any>): { before: any; after: any } {
  if (!before) return { before: null, after }
  const b: Record<string, any> = {}
  const a: Record<string, any> = {}
  for (const k of Object.keys(after)) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
      b[k] = before[k]
      a[k] = after[k]
    }
  }
  return { before: b, after: a }
}

/** after a write: reload content on every instance (settings.content_version) and drop router caches */
export async function touched() {
  invalidateRouterCaches()
  await bumpContentVersion().catch((e) => console.error('[touched]', e))
}

export function pick<T extends Record<string, any>>(obj: T, keys: readonly string[]): Partial<T> {
  const out: Record<string, any> = {}
  for (const k of keys) if (obj && Object.prototype.hasOwnProperty.call(obj, k) && obj[k] !== undefined) out[k] = obj[k]
  return out as Partial<T>
}

/** WordPress-style slug: lower case, spaces → "-", then percent-encoded like sanitize_title() stores it */
export function wpSlug(s: string): string {
  const base = String(s || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/[^\p{L}\p{N}\-]+/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return encodeURIComponent(base).toLowerCase() || 'untitled'
}

/** accept either an already-encoded slug or a human one */
export function normSlug(s: string): string {
  const v = String(s || '').trim()
  if (!v) return ''
  if (/%[0-9a-f]{2}/i.test(v)) return v.toLowerCase().replace(/^\/+|\/+$/g, '')
  return wpSlug(v)
}

export function nowIso() {
  return new Date().toISOString()
}

/** "2026-10-23T14:05" (Asia/Taipei wall clock) → ISO */
export function twLocalToIso(v: string | null | undefined): string | null {
  if (!v) return null
  if (/[zZ]|[+-]\d\d:\d\d$/.test(v)) return new Date(v).toISOString()
  const d = new Date(`${v.length === 16 ? v + ':00' : v}+08:00`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** ISO → "2026-10-23T14:05" in Asia/Taipei (for <input type=datetime-local>) */
export function isoToTwLocal(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(new Date(iso).getTime() + 8 * 3600 * 1000)
  return d.toISOString().slice(0, 16)
}

export function twDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return isoToTwLocal(iso).replace('T', ' ')
}

export function numOrNull(v: any): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function idList(v: any): number[] {
  if (Array.isArray(v)) return v.map(Number).filter((n) => Number.isFinite(n) && n > 0)
  return String(v || '')
    .split(/[\s,]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0)
}

export function decodeSlug(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}
