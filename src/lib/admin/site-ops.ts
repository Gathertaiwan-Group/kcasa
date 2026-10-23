/* eslint-disable @typescript-eslint/no-explicit-any */
/** Media library, menus, form submissions, settings, redirects, audit log. */
import { createHash } from 'node:crypto'
import { BUCKET, svc } from '../sb'
import { upsertRedirectRaw } from './content'
import { audit, diff, must, OpError, pick, touched, type Actor } from './core'

// ---------------------------------------------------------------- media
export const MEDIA_MAX_EDGE = 2000
const CONVERT = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/tiff', 'image/bmp'])
const ALLOWED = new Set([...CONVERT, 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime', 'application/pdf'])

export function publicUrl(path: string) {
  return `${process.env.SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`
}

export async function listMedia(o: { search?: string; mime?: string; limit?: number; offset?: number }) {
  let q = svc().from('media').select('id,title,alt_text,mime_type,url,width,height,filesize,storage_path,is_private,created_at,published_at', { count: 'exact' })
  if (o.search) {
    const s = o.search.replace(/[%,()]/g, ' ')
    q = q.or(`title.ilike.%${s}%,alt_text.ilike.%${s}%,storage_path.ilike.%${s}%`)
  }
  if (o.mime) q = q.like('mime_type', `${o.mime}%`)
  const limit = Math.min(Math.max(o.limit || 60, 1), 500)
  const offset = Math.max(o.offset || 0, 0)
  const r = await q.order('id', { ascending: false }).range(offset, offset + limit - 1)
  return { rows: must(r, 'media') as any[], total: r.count || 0 }
}

export async function getMedia(id: number) {
  const m = must(await svc().from('media').select('*').eq('id', id).maybeSingle(), 'media') as any
  if (!m) throw new OpError(`media ${id} not found`, 404)
  return m
}

function baseName(filename: string) {
  const b = filename.replace(/\\/g, '/').split('/').pop() || 'file'
  const stem = b.replace(/\.[^.]+$/, '')
  const clean = stem
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
  return clean || 'file'
}

function extFor(mime: string, filename: string) {
  const map: Record<string, string> = { 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'application/pdf': 'pdf' }
  return map[mime] || (filename.split('.').pop() || 'bin').toLowerCase()
}

async function freePath(dir: string, stem: string, ext: string) {
  for (let i = 0; i < 100; i++) {
    const p = `${dir}/${stem}${i ? '-' + i : ''}.${ext}`
    const { data } = await svc().from('media').select('id').eq('storage_path', p).limit(1)
    if (!data || !data.length) return p
  }
  throw new OpError('no free file name')
}

/**
 * Upload one file into the media library. Raster images become WebP (longest edge ≤ 2000, q80);
 * GIF / video / PDF are stored as is. Identical files (sha1) are not stored twice.
 */
export async function uploadMedia(actor: Actor, file: { buffer: Buffer; filename: string; mime: string }, extra: { title?: string; alt_text?: string; caption_html?: string; parent_id?: number | null } = {}) {
  const mime = (file.mime || '').toLowerCase()
  if (!ALLOWED.has(mime)) throw new OpError(`不支援的檔案類型：${mime || '未知'}（允許 JPG/PNG/WebP/AVIF/GIF/MP4/WebM/PDF）`)
  if (file.buffer.length > 50 * 1024 * 1024) throw new OpError('檔案超過 50MB')
  const sha1 = createHash('sha1').update(file.buffer).digest('hex')
  const dup = (await svc().from('media').select('*').eq('sha1', sha1).limit(1)).data
  if (dup && dup[0]) return { ...dup[0], duplicate: true }

  let body: Buffer = file.buffer
  let outMime = mime
  let width: number | null = null
  let height: number | null = null
  let origW: number | null = null
  let origH: number | null = null
  if (CONVERT.has(mime)) {
    const sharp = (await import('sharp')).default
    const img = sharp(file.buffer, { failOn: 'none' }).rotate()
    const meta = await img.metadata()
    origW = meta.width || null
    origH = meta.height || null
    const out = await img.resize({ width: MEDIA_MAX_EDGE, height: MEDIA_MAX_EDGE, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer({ resolveWithObject: true })
    body = out.data
    width = out.info.width
    height = out.info.height
    outMime = 'image/webp'
  } else if (mime === 'image/gif') {
    const sharp = (await import('sharp')).default
    const meta = await sharp(file.buffer, { failOn: 'none' }).metadata().catch(() => null)
    width = origW = meta?.width || null
    height = origH = meta?.pageHeight || meta?.height || null
  }
  const now = new Date()
  const dir = `uploads/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  const stem = baseName(file.filename)
  const path = await freePath(dir, stem, outMime === 'image/webp' ? 'webp' : extFor(mime, file.filename))
  const up = await svc().storage.from(BUCKET).upload(path, body, { contentType: outMime, upsert: false, cacheControl: '31536000' })
  if (up.error) throw new OpError(`storage upload: ${up.error.message}`, 500)
  const url = publicUrl(path)
  const row = {
    slug: stem.toLowerCase(),
    title: extra.title ?? stem,
    alt_text: extra.alt_text ?? '',
    caption_html: extra.caption_html ?? '',
    media_type: outMime.startsWith('image/') ? 'image' : 'file',
    mime_type: outMime,
    orig_mime_type: mime,
    storage_path: path,
    url,
    old_url: url,
    width,
    height,
    filesize: body.length,
    orig_width: origW,
    orig_height: origH,
    orig_filesize: file.buffer.length,
    sha1,
    parent_id: extra.parent_id ?? null,
    published_at: now.toISOString(),
    modified_at: now.toISOString(),
  }
  const ins = await svc().from('media').insert(row).select('*').single()
  if (ins.error) {
    await svc().storage.from(BUCKET).remove([path])
    throw new OpError(`media insert: ${ins.error.message}`, 500)
  }
  await audit(actor, 'media.upload', 'media', ins.data.id, null, { storage_path: path, mime_type: outMime, filesize: body.length, orig_filesize: file.buffer.length })
  await touched()
  return ins.data
}

/** register a file the browser uploaded straight to storage (large video / PDF) */
export async function registerUploadedFile(actor: Actor, path: string, mime: string, size: number, title?: string) {
  if (!/^uploads\/\d{4}\/\d{2}\/[^/]+$/.test(path)) throw new OpError('bad path')
  const dir = path.slice(0, path.lastIndexOf('/'))
  const name = path.slice(path.lastIndexOf('/') + 1)
  const { data: found } = await svc().storage.from(BUCKET).list(dir, { search: name, limit: 10 })
  const obj = (found || []).find((f: any) => f.name === name) as any
  if (!obj) throw new OpError('檔案尚未上傳到儲存空間')
  if (obj.metadata?.size) size = Number(obj.metadata.size)
  const row = { slug: path.split('/').pop()!.replace(/\.[^.]+$/, '').toLowerCase(), title: title || path.split('/').pop()!, media_type: 'file', mime_type: mime, orig_mime_type: mime, storage_path: path, url: publicUrl(path), old_url: publicUrl(path), filesize: size, orig_filesize: size, published_at: new Date().toISOString(), modified_at: new Date().toISOString() }
  const m = must(await svc().from('media').insert(row).select('*').single(), 'media insert') as any
  await audit(actor, 'media.upload', 'media', m.id, null, { storage_path: path, mime_type: mime, filesize: size, direct: true })
  await touched()
  return m
}

export async function signedUploadFor(filename: string, mime: string) {
  if (!ALLOWED.has(mime) || CONVERT.has(mime)) throw new OpError('direct upload is only for GIF / video / PDF')
  const now = new Date()
  const dir = `uploads/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  const path = await freePath(dir, baseName(filename), extFor(mime, filename))
  const r = await svc().storage.from(BUCKET).createSignedUploadUrl(path)
  if (r.error) throw new OpError(r.error.message, 500)
  return { path, signedUrl: r.data.signedUrl, token: r.data.token }
}

export async function updateMedia(actor: Actor, id: number, input: { title?: string; alt_text?: string; caption_html?: string; description_html?: string; is_private?: boolean }) {
  const before = await getMedia(id)
  const patch: Record<string, any> = pick(input as any, ['title', 'alt_text', 'caption_html', 'description_html', 'is_private'])
  patch.modified_at = new Date().toISOString()
  const m = must(await svc().from('media').update(patch).eq('id', id).select('*').single(), 'media update')
  const d = diff(before, patch)
  await audit(actor, 'media.update', 'media', id, d.before, d.after)
  await touched()
  return m
}

export async function deleteMedia(actor: Actor, id: number) {
  const before = await getMedia(id)
  must(await svc().from('media').delete().eq('id', id), 'media delete')
  if (before.storage_path) {
    const { data } = await svc().from('media').select('id').eq('storage_path', before.storage_path).limit(1)
    if (!data || !data.length) await svc().storage.from(BUCKET).remove([before.storage_path])
  }
  await audit(actor, 'media.delete', 'media', id, { storage_path: before.storage_path, title: before.title, url: before.url }, null)
  await touched()
  return { id, deleted: true }
}

// ---------------------------------------------------------------- menus
export async function listMenus() {
  const menus = must(await svc().from('menus').select('*').order('id'), 'menus') as any[]
  const items = must(await svc().from('menu_items').select('*').order('position'), 'menu_items') as any[]
  return menus.map((m) => ({ ...m, items: items.filter((i) => Number(i.menu_id) === Number(m.id)) }))
}

const MENU_ITEM_FIELDS = ['title', 'url', 'parent_id', 'position', 'target', 'css_classes', 'object_type', 'object_id'] as const

export async function saveMenuItem(actor: Actor, id: number | null, input: Record<string, any>) {
  const patch: Record<string, any> = pick(input, [...MENU_ITEM_FIELDS, 'menu_id'])
  if ('parent_id' in patch) patch.parent_id = patch.parent_id ? Number(patch.parent_id) : null
  if ('position' in patch) patch.position = Math.trunc(Number(patch.position) || 0)
  if ('target' in patch) patch.target = patch.target || null
  if (id) {
    if (patch.parent_id === id) throw new OpError('an item cannot be its own parent')
    const before = (await svc().from('menu_items').select('*').eq('id', id).maybeSingle()).data
    const r = must(await svc().from('menu_items').update(patch).eq('id', id).select('*').single(), 'menu item update')
    const d = diff(before, patch)
    await audit(actor, 'menu_item.update', 'menu_item', id, d.before, d.after)
    await touched()
    return r
  }
  if (!patch.menu_id || !patch.title || !patch.url) throw new OpError('menu_id, title and url are required')
  patch.object_type = patch.object_type || 'custom'
  const r = must(await svc().from('menu_items').insert(patch).select('*').single(), 'menu item insert') as any
  await audit(actor, 'menu_item.create', 'menu_item', r.id, null, patch)
  await touched()
  return r
}

export async function deleteMenuItem(actor: Actor, id: number) {
  const before = (await svc().from('menu_items').select('*').eq('id', id).maybeSingle()).data
  must(await svc().from('menu_items').delete().eq('id', id), 'menu item delete')
  await audit(actor, 'menu_item.delete', 'menu_item', id, before, null)
  await touched()
  return { id, deleted: true }
}

// ---------------------------------------------------------------- forms
export async function listForms() {
  const forms = must(await svc().from('forms').select('id,title,slug,page_path,fields,status'), 'forms') as any[]
  for (const f of forms) {
    const r = await svc().from('form_submissions').select('id', { count: 'exact', head: true }).eq('form_id', f.id).neq('status', 'trash')
    f.submission_count = r.count || 0
  }
  return forms
}

export async function listSubmissions(o: { form_id?: number; status?: string; limit?: number; offset?: number }) {
  let q = svc().from('form_submissions').select('*', { count: 'exact' })
  if (o.form_id) q = q.eq('form_id', o.form_id)
  if (o.status && o.status !== 'all') q = q.eq('status', o.status)
  else q = q.neq('status', 'trash')
  const limit = Math.min(Math.max(o.limit || 50, 1), 5000)
  const offset = Math.max(o.offset || 0, 0)
  const r = await q.order('created_at', { ascending: false }).range(offset, offset + limit - 1)
  return { rows: must(r, 'form_submissions') as any[], total: r.count || 0 }
}

export async function setSubmissionStatus(actor: Actor, id: number, status: string) {
  if (!['new', 'read', 'spam', 'trash'].includes(status)) throw new OpError('bad status')
  const before = (await svc().from('form_submissions').select('status').eq('id', id).maybeSingle()).data
  must(await svc().from('form_submissions').update({ status }).eq('id', id), 'submission update')
  await audit(actor, 'form_submission.status', 'form_submission', id, before, { status })
  return { id, status }
}

export function submissionsCsv(rows: any[]): string {
  const keys: string[] = []
  for (const r of rows) for (const k of Object.keys(r.data || {})) if (!keys.includes(k)) keys.push(k)
  const cell = (v: any) => {
    let s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s // CSV/formula injection guard
    return `"${s.replace(/"/g, '""')}"`
  }
  const head = ['id', 'form_id', 'status', 'created_at', ...keys, 'page_url', 'ip'].map(cell).join(',')
  const body = rows.map((r) => [r.id, r.form_id, r.status, r.created_at, ...keys.map((k) => r.data?.[k]), r.page_url, r.ip].map(cell).join(',')).join('\r\n')
  return '﻿' + head + '\r\n' + body + '\r\n'
}

// ---------------------------------------------------------------- settings
export async function getSettings(keys?: string[], includePrivate = true) {
  let q = svc().from('settings').select('key,value,is_public,source,updated_at')
  if (keys && keys.length) q = q.in('key', keys)
  if (!includePrivate) q = q.eq('is_public', true)
  return must(await q.order('key'), 'settings') as any[]
}

export async function setSetting(actor: Actor, key: string, value: any, isPublic?: boolean) {
  if (!/^[a-z0-9_]{1,64}$/.test(key)) throw new OpError('setting key must match [a-z0-9_]{1,64}')
  const before = (await svc().from('settings').select('*').eq('key', key).maybeSingle()).data as any
  const row: Record<string, any> = { key, value, source: 'admin' }
  if (isPublic !== undefined) row.is_public = isPublic
  else if (!before) row.is_public = true
  must(await svc().from('settings').upsert(row, { onConflict: 'key' }), 'settings upsert')
  await audit(actor, 'setting.update', 'setting', key, before ? { value: before.value } : null, { value })
  await touched()
  return { key, value }
}

// ---------------------------------------------------------------- redirects
export async function listRedirects(o: { search?: string; kind?: string; limit?: number; offset?: number }) {
  let q = svc().from('redirects').select('*', { count: 'exact' })
  if (o.search) {
    const s = o.search.replace(/[%,()]/g, ' ')
    const enc = encodeURI(s).replace(/[%,()]/g, '_')
    q = q.or(`source_path.ilike.%${s}%,target.ilike.%${s}%,source_path.ilike.%${enc}%`)
  }
  if (o.kind) q = q.eq('kind', o.kind)
  const limit = Math.min(Math.max(o.limit || 50, 1), 500)
  const offset = Math.max(o.offset || 0, 0)
  const r = await q.order('id', { ascending: false }).range(offset, offset + limit - 1)
  return { rows: must(r, 'redirects') as any[], total: r.count || 0 }
}

export async function saveRedirect(actor: Actor, id: number | null, input: { source_path?: string; target?: string; status_code?: number; enabled?: boolean; kind?: string }) {
  const patch: Record<string, any> = pick(input as any, ['source_path', 'target', 'status_code', 'enabled', 'kind'])
  if (patch.source_path !== undefined) {
    let s = String(patch.source_path).trim()
    try {
      if (/^https?:\/\//.test(s)) s = new URL(s).pathname + new URL(s).search
    } catch {
      /* keep */
    }
    if (!s.startsWith('/')) s = '/' + s
    patch.source_path = s
  }
  if (patch.status_code !== undefined) patch.status_code = Number(patch.status_code)
  if (id) {
    const before = (await svc().from('redirects').select('*').eq('id', id).maybeSingle()).data
    const r = must(await svc().from('redirects').update(patch).eq('id', id).select('*').single(), 'redirect update')
    const d = diff(before, patch)
    await audit(actor, 'redirect.update', 'redirect', id, d.before, d.after)
    await touched()
    return r
  }
  if (!patch.source_path || !patch.target) throw new OpError('source_path and target are required')
  const r = must(await svc().from('redirects').insert({ kind: 'manual', ...patch }).select('*').single(), 'redirect insert') as any
  await audit(actor, 'redirect.create', 'redirect', r.id, null, patch)
  await touched()
  return r
}

export async function deleteRedirect(actor: Actor, id: number) {
  const before = (await svc().from('redirects').select('*').eq('id', id).maybeSingle()).data
  must(await svc().from('redirects').delete().eq('id', id), 'redirect delete')
  await audit(actor, 'redirect.delete', 'redirect', id, before, null)
  await touched()
  return { id, deleted: true }
}

export { upsertRedirectRaw }

// ---------------------------------------------------------------- audit log
export async function listAudit(o: { actor?: string; entity_type?: string; entity_id?: string; via?: string; limit?: number; offset?: number }) {
  let q = svc().from('audit_log').select('*', { count: 'exact' })
  if (o.actor) q = q.ilike('actor', `%${o.actor.replace(/[%,()]/g, ' ')}%`)
  if (o.entity_type) q = q.eq('entity_type', o.entity_type)
  if (o.entity_id) q = q.eq('entity_id', o.entity_id)
  if (o.via) q = q.eq('via', o.via)
  const limit = Math.min(Math.max(o.limit || 50, 1), 500)
  const offset = Math.max(o.offset || 0, 0)
  const r = await q.order('id', { ascending: false }).range(offset, offset + limit - 1)
  return { rows: must(r, 'audit_log') as any[], total: r.count || 0 }
}
