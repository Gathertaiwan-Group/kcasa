/* eslint-disable @typescript-eslint/no-explicit-any */
/** Posts / pages / reusable blocks (wp_block) and taxonomy terms. */
import { svc } from '../sb'
import { audit, diff, must, normSlug, nowIso, OpError, pick, touched, wpSlug, type Actor } from './core'

export const CONTENT_TYPES = ['post', 'page', 'wp_block'] as const
export type ContentType = (typeof CONTENT_TYPES)[number]
export const CONTENT_STATUSES = ['publish', 'draft', 'pending', 'private', 'future', 'trash'] as const
export const TAXONOMIES = ['category', 'post_tag', 'product_cat', 'product_tag'] as const

const POST_FIELDS = ['title', 'slug', 'content_html', 'excerpt_html', 'status', 'author_id', 'featured_media_id', 'parent_id', 'menu_order', 'template', 'comment_status', 'sticky', 'seo', 'published_at', 'builder', 'meta', 'path'] as const

export const LIST_COLS = 'id,post_type,title,slug,path,status,published_at,modified_at,author_id,builder'

export async function listContent(o: { type?: string; status?: string; search?: string; limit?: number; offset?: number }) {
  let q = svc().from('posts').select(LIST_COLS, { count: 'exact' })
  q = q.in('post_type', o.type ? [o.type] : ['post', 'page', 'wp_block'])
  if (o.status && o.status !== 'all') q = q.eq('status', o.status)
  else q = q.neq('status', 'trash')
  if (o.search) q = q.or(`title.ilike.%${o.search.replace(/[%,()]/g, ' ')}%,slug.ilike.%${encodeURIComponent(o.search).toLowerCase().replace(/[%,()]/g, '_')}%`)
  const limit = Math.min(Math.max(o.limit || 50, 1), 500)
  const offset = Math.max(o.offset || 0, 0)
  const r = await q.order('modified_at', { ascending: false, nullsFirst: false }).order('id', { ascending: false }).range(offset, offset + limit - 1)
  return { rows: must(r, 'posts') as any[], total: r.count || 0 }
}

export async function statusCounts(type: string) {
  const r = await svc().from('posts').select('status').eq('post_type', type)
  const out: Record<string, number> = {}
  for (const x of must(r, 'posts') as any[]) out[x.status] = (out[x.status] || 0) + 1
  return out
}

export async function getContent(id: number) {
  const r = await svc().from('posts').select('*').eq('id', id).maybeSingle()
  const row = must(r, 'posts') as any
  if (!row) throw new OpError(`content ${id} not found`, 404)
  const rel = await svc().from('term_relationships').select('term_id').eq('object_type', 'post').eq('object_id', id)
  row.term_ids = (must(rel, 'term_relationships') as any[]).map((x) => Number(x.term_id))
  return row
}

async function uniqueSlug(table: 'posts' | 'products' | 'terms', slug: string, scope: Record<string, string>, excludeId?: number): Promise<string> {
  let candidate = slug
  for (let i = 2; i < 200; i++) {
    let q = svc().from(table).select('id').eq('slug', candidate)
    for (const [k, v] of Object.entries(scope)) q = q.eq(k, v)
    if (excludeId) q = q.neq('id', excludeId)
    const { data } = await q.limit(1)
    if (!data || !data.length) return candidate
    candidate = `${slug}-${i}`
  }
  throw new OpError('could not find a free slug')
}

async function pathFor(type: string, slug: string, parentId: number | null | undefined): Promise<string | null> {
  if (type === 'wp_block') return null
  if (type === 'page' && parentId) {
    const { data } = await svc().from('posts').select('path,slug').eq('id', parentId).maybeSingle()
    if (data) return `${(data.path || `/${data.slug}/`).replace(/\/$/, '')}/${slug}/`
  }
  return `/${slug}/`
}

async function defaultAuthor(): Promise<number | null> {
  const { data } = await svc().from('authors').select('id').order('id').limit(1)
  return data && data[0] ? Number(data[0].id) : null
}

/** normalise status/published_at like wp_insert_post does */
function scheduleFix(patch: Record<string, any>, current?: any) {
  const status = patch.status ?? current?.status
  const pub = patch.published_at !== undefined ? patch.published_at : current?.published_at
  if (status === 'future') {
    if (!pub) throw new OpError('排程發布需要設定發布時間 (published_at)')
    if (new Date(pub).getTime() <= Date.now()) patch.status = 'publish'
  }
  if ((patch.status ?? status) === 'publish' && !pub) patch.published_at = nowIso()
}

export type ContentInput = {
  post_type?: ContentType
  title?: string
  slug?: string
  content_html?: string
  excerpt_html?: string
  status?: string
  published_at?: string | null
  featured_media_id?: number | null
  parent_id?: number | null
  menu_order?: number
  template?: string
  comment_status?: string
  sticky?: boolean
  seo?: Record<string, any>
  meta?: Record<string, any>
  author_id?: number | null
  builder?: string | null
  category_ids?: number[]
  tag_ids?: number[]
  tag_names?: string[]
  /** replace the whole seo object instead of merging (admin form) */
  replace_seo?: boolean
}

export async function createContent(actor: Actor, input: ContentInput) {
  const type = (input.post_type || 'post') as ContentType
  if (!CONTENT_TYPES.includes(type)) throw new OpError(`unsupported post_type ${type}`)
  const title = input.title ?? ''
  const status = input.status || 'draft'
  if (!CONTENT_STATUSES.includes(status as any)) throw new OpError(`bad status ${status}`)
  const slug = await uniqueSlug('posts', normSlug(input.slug || '') || wpSlug(title || 'untitled'), { post_type: type })
  const row: Record<string, any> = {
    post_type: type,
    title,
    slug,
    content_html: input.content_html ?? '',
    excerpt_html: input.excerpt_html ?? '',
    status,
    published_at: input.published_at ?? null,
    featured_media_id: input.featured_media_id ?? null,
    parent_id: input.parent_id ?? null,
    menu_order: input.menu_order ?? 0,
    template: input.template ?? '',
    comment_status: input.comment_status ?? (type === 'post' ? 'open' : 'closed'),
    sticky: input.sticky ?? false,
    seo: input.seo ?? {},
    meta: input.meta ?? {},
    author_id: input.author_id ?? (await defaultAuthor()),
    builder: input.builder ?? 'gutenberg',
    modified_at: nowIso(),
  }
  row.path = await pathFor(type, slug, row.parent_id)
  scheduleFix(row)
  const r = await svc().from('posts').insert(row).select('*').single()
  const created = must(r, 'posts insert') as any
  await setContentTerms(created.id, input, actor)
  await audit(actor, 'content.create', type, created.id, null, { ...row, id: created.id })
  await touched()
  return created
}

async function setContentTerms(id: number, input: ContentInput, actor: Actor) {
  if (input.category_ids) await setObjectTerms('post', id, 'category', input.category_ids)
  let tags = input.tag_ids
  if (input.tag_names) tags = [...(tags || []), ...(await termIdsByName('post_tag', input.tag_names, actor))]
  if (tags) await setObjectTerms('post', id, 'post_tag', tags)
}

export async function updateContent(actor: Actor, id: number, input: ContentInput) {
  const before = await getContent(id)
  const patch: Record<string, any> = pick(input as any, POST_FIELDS)
  if (patch.status && !CONTENT_STATUSES.includes(patch.status)) throw new OpError(`bad status ${patch.status}`)
  if (patch.slug !== undefined) patch.slug = await uniqueSlug('posts', normSlug(patch.slug) || before.slug, { post_type: before.post_type }, id)
  if (patch.seo && !input.replace_seo) patch.seo = { ...(before.seo || {}), ...patch.seo }
  if (patch.meta) patch.meta = { ...(before.meta || {}), ...patch.meta }
  if (patch.slug !== undefined || patch.parent_id !== undefined) {
    const newPath = await pathFor(before.post_type, patch.slug ?? before.slug, patch.parent_id !== undefined ? patch.parent_id : before.parent_id)
    if (newPath !== before.path) {
      patch.path = newPath
      // keep the old published URL working (SEO): 301 old → new
      if (before.status === 'publish' && before.path && newPath) await upsertRedirectRaw(before.path, newPath, 'auto')
    }
  }
  scheduleFix(patch, before)
  patch.modified_at = nowIso()
  const r = await svc().from('posts').update(patch).eq('id', id).select('*').single()
  const after = must(r, 'posts update') as any
  await setContentTerms(id, input, actor)
  const d = diff(before, patch)
  if (input.category_ids || input.tag_ids || input.tag_names) d.after.term_ids = (await getContent(id)).term_ids
  await audit(actor, 'content.update', before.post_type, id, d.before, d.after)
  await touched()
  return after
}

/** trash (default, recoverable) or permanently delete */
export async function deleteContent(actor: Actor, id: number, force = false) {
  const before = await getContent(id)
  if (!force) {
    const r = await svc().from('posts').update({ status: 'trash', meta: { ...(before.meta || {}), _wp_trash_meta_status: before.status }, modified_at: nowIso() }).eq('id', id).select('id,status').single()
    must(r, 'posts trash')
    await audit(actor, 'content.trash', before.post_type, id, { status: before.status }, { status: 'trash' })
    await touched()
    return { id, trashed: true }
  }
  await svc().from('term_relationships').delete().eq('object_type', 'post').eq('object_id', id)
  must(await svc().from('posts').delete().eq('id', id), 'posts delete')
  await recountTerms(before.term_ids)
  await audit(actor, 'content.delete', before.post_type, id, before, null)
  await touched()
  return { id, deleted: true }
}

export async function restoreContent(actor: Actor, id: number) {
  const before = await getContent(id)
  const status = before.meta?._wp_trash_meta_status && before.meta._wp_trash_meta_status !== 'trash' ? before.meta._wp_trash_meta_status : 'draft'
  const meta = { ...(before.meta || {}) }
  delete meta._wp_trash_meta_status
  must(await svc().from('posts').update({ status, meta, modified_at: nowIso() }).eq('id', id), 'posts restore')
  await audit(actor, 'content.restore', before.post_type, id, { status: 'trash' }, { status })
  await touched()
  return { id, status }
}

// ---------------------------------------------------------------- terms
export async function listTerms(taxonomy?: string) {
  let q = svc().from('terms').select('id,taxonomy,name,slug,description,parent_id,count,menu_order,image_id')
  if (taxonomy) q = q.eq('taxonomy', taxonomy)
  return must(await q.order('taxonomy').order('menu_order').order('name'), 'terms') as any[]
}

export async function getTerm(id: number) {
  const t = must(await svc().from('terms').select('*').eq('id', id).maybeSingle(), 'terms') as any
  if (!t) throw new OpError(`term ${id} not found`, 404)
  return t
}

export async function createTerm(actor: Actor, input: { taxonomy: string; name: string; slug?: string; description?: string; parent_id?: number | null; menu_order?: number; image_id?: number | null }) {
  if (!input.taxonomy || !input.name) throw new OpError('taxonomy and name are required')
  const slug = await uniqueSlug('terms', normSlug(input.slug || '') || wpSlug(input.name), { taxonomy: input.taxonomy })
  const row = { taxonomy: input.taxonomy, name: input.name, slug, description: input.description || '', parent_id: input.parent_id || null, menu_order: input.menu_order || 0, image_id: input.image_id || null }
  const t = must(await svc().from('terms').insert(row).select('*').single(), 'terms insert') as any
  await audit(actor, 'term.create', input.taxonomy, t.id, null, t)
  await touched()
  return t
}

export async function updateTerm(actor: Actor, id: number, input: { name?: string; slug?: string; description?: string; parent_id?: number | null; menu_order?: number; image_id?: number | null; meta?: any }) {
  const before = await getTerm(id)
  const patch: Record<string, any> = pick(input as any, ['name', 'slug', 'description', 'parent_id', 'menu_order', 'image_id', 'meta'])
  if (patch.parent_id === id) throw new OpError('a term cannot be its own parent')
  if (patch.slug !== undefined) {
    patch.slug = await uniqueSlug('terms', normSlug(patch.slug) || before.slug, { taxonomy: before.taxonomy }, id)
    if (patch.slug !== before.slug) {
      const base: Record<string, string> = { category: '/category/', post_tag: '/tag/', product_cat: '/product-category/', product_tag: '/product-tag/' }
      if (base[before.taxonomy]) await upsertRedirectRaw(base[before.taxonomy] + before.slug + '/', base[before.taxonomy] + patch.slug + '/', 'auto')
    }
  }
  const t = must(await svc().from('terms').update(patch).eq('id', id).select('*').single(), 'terms update')
  const d = diff(before, patch)
  await audit(actor, 'term.update', before.taxonomy, id, d.before, d.after)
  await touched()
  return t
}

export async function deleteTerm(actor: Actor, id: number) {
  const before = await getTerm(id)
  must(await svc().from('terms').delete().eq('id', id), 'terms delete')
  await audit(actor, 'term.delete', before.taxonomy, id, before, null)
  await touched()
  return { id, deleted: true }
}

export async function termIdsByName(taxonomy: string, names: string[], actor?: Actor): Promise<number[]> {
  const out: number[] = []
  for (const raw of names) {
    const name = raw.trim()
    if (!name) continue
    const { data } = await svc().from('terms').select('id').eq('taxonomy', taxonomy).eq('name', name).limit(1)
    if (data && data[0]) out.push(Number(data[0].id))
    else out.push((await createTerm(actor || { email: 'system', via: 'system' }, { taxonomy, name })).id)
  }
  return out
}

/** replace an object's terms in one taxonomy */
export async function setObjectTerms(objectType: 'post' | 'product', objectId: number, taxonomy: string, termIds: number[]) {
  const all = must(await svc().from('term_relationships').select('term_id').eq('object_type', objectType).eq('object_id', objectId), 'rels') as any[]
  const ids = all.map((x) => Number(x.term_id))
  const inTax = ids.length ? (must(await svc().from('terms').select('id').in('id', ids).eq('taxonomy', taxonomy), 'terms') as any[]).map((x) => Number(x.id)) : []
  const want = [...new Set(termIds.map(Number))]
  const del = inTax.filter((x) => !want.includes(x))
  const add = want.filter((x) => !inTax.includes(x))
  if (add.length) {
    const ok = (must(await svc().from('terms').select('id').in('id', add).eq('taxonomy', taxonomy), 'terms') as any[]).map((x) => Number(x.id))
    const bad = add.filter((x) => !ok.includes(x))
    if (bad.length) throw new OpError(`term ids not in ${taxonomy}: ${bad.join(',')}`)
  }
  if (del.length) must(await svc().from('term_relationships').delete().eq('object_type', objectType).eq('object_id', objectId).in('term_id', del), 'rels delete')
  if (add.length) must(await svc().from('term_relationships').insert(add.map((t, i) => ({ object_type: objectType, object_id: objectId, term_id: t, term_order: i }))), 'rels insert')
  await recountTerms([...del, ...add])
}

/** term.count = number of published objects (like _update_post_term_count) */
export async function recountTerms(ids: number[]) {
  for (const id of [...new Set(ids)]) {
    const t = (await svc().from('terms').select('taxonomy').eq('id', id).maybeSingle()).data as any
    if (!t) continue
    const table = t.taxonomy.startsWith('product') ? 'products' : 'posts'
    const objType = table === 'products' ? 'product' : 'post'
    const rels = must(await svc().from('term_relationships').select('object_id').eq('term_id', id).eq('object_type', objType), 'rels') as any[]
    let count = 0
    const oids = rels.map((x) => Number(x.object_id))
    for (let i = 0; i < oids.length; i += 200) {
      const r = await svc().from(table).select('id', { count: 'exact', head: true }).in('id', oids.slice(i, i + 200)).eq('status', 'publish')
      count += r.count || 0
    }
    await svc().from('terms').update({ count }).eq('id', id)
  }
}

// ---------------------------------------------------------------- redirects (shared helper)
export async function upsertRedirectRaw(source: string, target: string, kind = 'manual', code = 301) {
  if (source === target) return
  await svc().from('redirects').upsert({ source_path: source, target, status_code: code, kind, enabled: true }, { onConflict: 'source_path' })
  // a redirect pointing at the old source now chains → point it to the final target
  await svc().from('redirects').update({ target }).eq('target', source)
}
