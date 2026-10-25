/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * In-memory snapshot of the site's published content (site_kcasa schema), refreshed every TTL ms.
 * The whole catalogue is small (≈100 posts/pages, 73 products, 2.2k media rows) so one load per
 * instance is far cheaper than per-request queries. Carts / orders / auth are always queried live.
 */
import { fetchAll, svc } from './sb'
import { normPath } from './util'

export type Media = { id: number; url: string; width: number | null; height: number | null; alt_text: string; title: string; caption_html: string; mime_type: string; storage_path?: string | null; variants?: { w: number; h: number; path: string }[] }
export type Post = {
  id: number; post_type: string; slug: string; path: string | null; title: string; content_html: string; excerpt_html: string; status: string
  author_id: number | null; featured_media_id: number | null; parent_id: number | null; menu_order: number; template: string; builder: string | null
  comment_status: string; seo: any; meta: any; published_at: string | null; modified_at: string | null; sticky: boolean
}
export type Product = {
  id: number; slug: string; name: string; type: string; status: string; featured: boolean; catalog_visibility: string; sku: string
  description_html: string; short_description_html: string; regular_price: string | null; sale_price: string | null; price: string | null
  price_min: string | null; price_max: string | null; sale_starts_at: string | null; sale_ends_at: string | null; manage_stock: boolean
  stock_quantity: number | null; stock_status: string; backorders: string; sold_individually: boolean; min_purchase_qty: number; max_purchase_qty: number | null
  purchasable: boolean; weight: string | null; length: string | null; width: string | null; height: string | null; featured_media_id: number | null
  gallery_media_ids: number[]; average_rating: string; review_count: number; total_sales: number; menu_order: number; reviews_allowed: boolean
  path: string | null; seo: any; meta: any; published_at: string | null; modified_at: string | null
}
export type Variation = {
  id: number; product_id: number; sku: string; attributes: { name: string; value: string | null }[]; description_html: string; status: string
  regular_price: string | null; sale_price: string | null; price: string | null; manage_stock: boolean; stock_quantity: number | null; stock_status: string
  backorders: string; weight: string | null; length: string | null; width: string | null; height: string | null; image_id: number | null; menu_order: number; purchasable: boolean
}
export type AttrValue = { id: number; product_id: number; attribute_id: number | null; name: string; options: string[]; term_ids: number[]; position: number; visible: boolean; used_for_variations: boolean }
export type Attribute = { id: number; name: string; slug: string; taxonomy: string }
export type Term = { id: number; taxonomy: string; name: string; slug: string; description: string; parent_id: number | null; count: number; menu_order: number; image_id: number | null; meta: any }
export type Author = { id: number; slug: string; display_name: string; description: string; url: string; avatar_url: string | null }
export type MenuItem = { id: number; menu_id: number; parent_id: number | null; wp_id: number | null; title: string; url: string; object_type: string | null; object_id: number | null; target: string | null; css_classes: string; position: number }
export type Comment = { id: number; post_id: number; object_type: string; parent_id: number | null; author_name: string; author_url: string; content_html: string; rating: number | null; comment_type: string; status: string; verified_owner: boolean; created_at: string }
export type ShippingMethod = { id: number; zone_id: number; method_id: string; title: string; cost: string; enabled: boolean; method_order: number; settings: any }
export type QtyRule = { id: number; title: string; enabled: boolean; priority: number; applies_to: string; product_ids: number[]; category_ids: number[]; min_qty: number; max_qty: number | null; discount_type: string; amount: string; starts_at: string | null; ends_at: string | null }

export type Site = {
  at: number
  settings: Record<string, any>
  media: Map<number, Media>
  posts: Post[]
  postById: Map<number, Post>
  byPath: Map<string, Post>
  products: Product[]
  productById: Map<number, Product>
  productBySlug: Map<string, Product>
  variations: Map<number, Variation[]>
  variationById: Map<number, Variation>
  attrValues: Map<number, AttrValue[]>
  attributes: Attribute[]
  terms: Term[]
  termById: Map<number, Term>
  termBySlug: Map<string, Term> // `${taxonomy}:${normPath(slug)}`
  objTerms: Map<string, number[]> // `${object_type}:${id}` -> term ids (ordered)
  termObjs: Map<number, number[]> // term id -> object ids
  authors: Author[]
  authorById: Map<number, Author>
  authorBySlug: Map<string, Author>
  menus: Map<string, MenuItem[]> // by location
  comments: Comment[]
  shipping: ShippingMethod[]
  qtyRules: QtyRule[]
  forms: any[]
}

const TTL = Number(process.env.SITE_CACHE_TTL_MS || 30000)
/** how often an instance asks the DB whether content changed (settings.content_version, bumped by admin/MCP writes) */
const VERSION_CHECK_MS = Number(process.env.SITE_VERSION_CHECK_MS || 3000)

// Shared by every route bundle in this process (route handlers and server actions are bundled separately,
// so plain module variables would give each bundle its own cache).
type CacheState = { cache: Site | null; loading: Promise<Site> | null; generation: number; version: string; checkedAt: number }
const G = globalThis as unknown as { __kcasaSite?: CacheState }
const st: CacheState = (G.__kcasaSite ??= { cache: null, loading: null, generation: 0, version: '', checkedAt: 0 })

async function contentVersion(): Promise<string> {
  const { data } = await svc().from('settings').select('value').eq('key', 'content_version').maybeSingle()
  return data ? JSON.stringify(data.value) : ''
}

/** content_version this process last saw (router caches key off it) */
export function seenContentVersion(): string {
  return st.version
}

/** called after every admin / MCP write: tells all instances to reload */
export async function bumpContentVersion() {
  const v = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  await svc().from('settings').upsert({ key: 'content_version', value: v, is_public: false, source: 'system' }, { onConflict: 'key' })
  invalidateSite()
}

/** scheduled posts (status "future") whose time has come are published, like WP-cron's publish_future_post */
async function publishDue() {
  const sb = svc()
  const now = new Date().toISOString()
  const { data } = await sb.from('posts').update({ status: 'publish', modified_at: now }).eq('status', 'future').lte('published_at', now).select('id,post_type,title')
  if (data && data.length) {
    await sb.from('audit_log').insert(
      data.map((p: any) => ({ actor: 'system', via: 'system', action: 'content.publish_scheduled', entity_type: p.post_type, entity_id: String(p.id), before: { status: 'future' }, after: { status: 'publish', title: p.title } })),
    )
    // other instances reload too (this instance is loading right now)
    await sb.from('settings').upsert({ key: 'content_version', value: `${Date.now()}-sched`, is_public: false, source: 'system' }, { onConflict: 'key' })
  }
}

async function load(): Promise<Site> {
  const sb = svc()
  await publishDue().catch((e) => console.error('[publishDue]', e))
  const [settingsRows, media, posts, products, variations, attrValues, attributes, terms, rels, authors, menus, menuItems, comments, shipping, qtyRules, forms] = await Promise.all([
    fetchAll<any>('settings', 'key,value', 'key'),
    fetchAll<Media>('media', 'id,url,width,height,alt_text,title,caption_html,mime_type,storage_path,variants'),
    fetchAll<Post>('posts', 'id,post_type,slug,path,title,content_html,excerpt_html,status,author_id,featured_media_id,parent_id,menu_order,template,builder,comment_status,seo,meta,published_at,modified_at,sticky'),
    fetchAll<Product>('products', '*'),
    fetchAll<Variation>('product_variations', '*'),
    fetchAll<AttrValue>('product_attribute_values', '*'),
    fetchAll<Attribute>('product_attributes', 'id,name,slug,taxonomy'),
    fetchAll<Term>('terms', 'id,taxonomy,name,slug,description,parent_id,count,menu_order,image_id,meta'),
    fetchAll<any>('term_relationships', 'object_type,object_id,term_id,term_order', 'term_id'),
    fetchAll<Author>('authors', 'id,slug,display_name,description,url,avatar_url'),
    fetchAll<any>('menus', 'id,slug,location'),
    fetchAll<MenuItem>('menu_items', '*'),
    sb.from('comments').select('id,post_id,object_type,parent_id,author_name,author_url,content_html,rating,comment_type,status,verified_owner,created_at').eq('status', 'approved').then((r) => (r.data || []) as Comment[]),
    fetchAll<ShippingMethod>('shipping_methods', '*'),
    fetchAll<QtyRule>('quantity_discount_rules', '*'),
    fetchAll<any>('forms', '*'),
  ])
  const settings: Record<string, any> = {}
  for (const r of settingsRows) settings[r.key] = r.value
  const s: Site = {
    at: Date.now(),
    settings,
    media: new Map(media.map((m) => [Number(m.id), m])),
    posts,
    postById: new Map(posts.map((p) => [Number(p.id), p])),
    byPath: new Map(),
    products,
    productById: new Map(products.map((p) => [Number(p.id), p])),
    productBySlug: new Map(products.map((p) => [normPath(p.slug), p])),
    variations: new Map(),
    variationById: new Map(variations.map((v) => [Number(v.id), v])),
    attrValues: new Map(),
    attributes,
    terms,
    termById: new Map(terms.map((t) => [Number(t.id), t])),
    termBySlug: new Map(terms.map((t) => [`${t.taxonomy}:${normPath(t.slug)}`, t])),
    objTerms: new Map(),
    termObjs: new Map(),
    authors,
    authorById: new Map(authors.map((a) => [Number(a.id), a])),
    authorBySlug: new Map(authors.map((a) => [normPath(a.slug), a])),
    menus: new Map(),
    comments,
    shipping: shipping.filter((m) => m.enabled).sort((a, b) => a.method_order - b.method_order),
    qtyRules: qtyRules.filter((r) => r.enabled),
    forms,
  }
  for (const p of posts) {
    if (p.path && (p.post_type === 'page' || p.post_type === 'post')) s.byPath.set(normPath(p.path), p)
  }
  for (const v of [...variations].sort((a, b) => a.menu_order - b.menu_order || a.id - b.id)) {
    const k = Number(v.product_id)
    if (!s.variations.has(k)) s.variations.set(k, [])
    s.variations.get(k)!.push(v)
  }
  for (const a of [...attrValues].sort((x, y) => x.position - y.position)) {
    const k = Number(a.product_id)
    if (!s.attrValues.has(k)) s.attrValues.set(k, [])
    s.attrValues.get(k)!.push(a)
  }
  for (const r of [...rels].sort((a, b) => a.term_order - b.term_order)) {
    const k = `${r.object_type}:${r.object_id}`
    if (!s.objTerms.has(k)) s.objTerms.set(k, [])
    s.objTerms.get(k)!.push(Number(r.term_id))
    const t = Number(r.term_id)
    if (!s.termObjs.has(t)) s.termObjs.set(t, [])
    s.termObjs.get(t)!.push(Number(r.object_id))
  }
  const loc = new Map<number, string>()
  for (const m of menus) loc.set(Number(m.id), m.location || m.slug)
  for (const it of [...menuItems].sort((a, b) => a.position - b.position)) {
    const l = loc.get(Number(it.menu_id))
    if (!l) continue
    if (!s.menus.has(l)) s.menus.set(l, [])
    s.menus.get(l)!.push(it)
  }
  return s
}

function startLoad(): Promise<Site> {
  if (st.loading) return st.loading
  const gen = st.generation
  const p: Promise<Site> = (async () => {
    const version = await contentVersion().catch(() => '')
    const site = await load()
    // a write happened while loading: don't keep this snapshot as the cache
    if (gen === st.generation) {
      st.cache = site
      st.version = version
      st.checkedAt = Date.now()
    }
    return site
  })().finally(() => {
    if (st.loading === p) st.loading = null
  })
  st.loading = p
  return p
}

export async function getSite(): Promise<Site> {
  const now = Date.now()
  if (st.cache && now - st.cache.at < TTL) {
    if (now - st.checkedAt < VERSION_CHECK_MS) return st.cache
    st.checkedAt = now
    const v = await contentVersion().catch(() => st.version)
    if (v === st.version) return st.cache
    invalidateSite()
    return startLoad()
  }
  const p = startLoad()
  // serve stale while refreshing, if we have it
  if (st.cache) return st.cache
  return p
}

/** drop this process's snapshot (and any in-flight load) so the next request reads fresh data */
export function invalidateSite() {
  st.generation++
  st.cache = null
  st.loading = null
}

// ---------------------------------------------------------------- accessors
export function img(site: Site, id: number | null | undefined): Media | null {
  if (!id) return null
  return site.media.get(Number(id)) || null
}

export function isPublished(p: { status: string }) {
  return p.status === 'publish'
}

export function termsOf(site: Site, objectType: 'post' | 'product', id: number, taxonomy?: string): Term[] {
  const ids = site.objTerms.get(`${objectType}:${id}`) || []
  return ids.map((t) => site.termById.get(t)).filter((t): t is Term => !!t && (!taxonomy || t.taxonomy === taxonomy))
}

export function termLink(t: Term): string {
  const base: Record<string, string> = { category: '/category/', post_tag: '/tag/', product_cat: '/product-category/', product_tag: '/product-tag/' }
  return (base[t.taxonomy] || '/') + t.slug + '/'
}

export function productLink(p: Product): string {
  return p.path || `/product/${p.slug}/`
}

export function postLink(p: Post): string {
  return p.path || `/${p.slug}/`
}

export function publishedPosts(site: Site): Post[] {
  return site.posts
    .filter((p) => p.post_type === 'post' && p.status === 'publish')
    .sort((a, b) => (b.published_at || '').localeCompare(a.published_at || '') || b.id - a.id)
}

export function visibleProducts(site: Site): Product[] {
  return site.products.filter((p) => p.status === 'publish' && p.catalog_visibility !== 'hidden')
}
