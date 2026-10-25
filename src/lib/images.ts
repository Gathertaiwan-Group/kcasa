/**
 * Responsive images for every storefront document (BRIEF phase 3 §1).
 *
 * All HTML (captured Astra chrome, Elementor/Gutenberg content from the DB, WooCommerce templates) is passed
 * through `responsiveImages()` once at the end: each <img> pointing at a bucket file gets a srcset built from
 * the WebP variants in media.variants (480/960/1440 + the stored original), sizes, width/height, decoding and
 * lazy loading (the header logo and the first image of #content stay eager as the above-the-fold image).
 * WordPress' own srcset lists are dropped: after the migration every entry in them pointed at the same original.
 */
import { BUCKET } from './sb'
import type { Site } from './site'

export type Variant = { w: number; h: number; path: string }
type Entry = { w: number | null; h: number | null; variants: Variant[] }

export function bucketBase(): string {
  return `${process.env.SUPABASE_URL || ''}/storage/v1/object/public/${BUCKET}/`
}

export function publicPath(path: string): string {
  return bucketBase() + path.split('/').map(encodeURIComponent).join('/')
}

const indexCache = new WeakMap<Site, Map<string, Entry>>()

/** storage key (decoded) → dimensions + variants, built once per loaded site snapshot */
function indexFor(site: Site): Map<string, Entry> {
  let idx = indexCache.get(site)
  if (idx) return idx
  idx = new Map()
  const base = bucketBase()
  for (const m of site.media.values()) {
    const key = m.storage_path || (m.url && m.url.startsWith(base) ? safeDecode(m.url.slice(base.length)) : '')
    if (!key || !String(m.mime_type || '').startsWith('image/')) continue
    const v = Array.isArray(m.variants) ? m.variants.filter((x) => x && x.w && x.path) : []
    if (!idx.has(key) || v.length) idx.set(key, { w: m.width, h: m.height, variants: v.sort((a, b) => a.w - b.w) })
  }
  indexCache.set(site, idx)
  return idx
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

const ATTR_RE = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g

function parseAttrs(s: string): [string, string | null][] {
  const out: [string, string | null][] = []
  for (const m of s.matchAll(ATTR_RE)) out.push([m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? null])
  return out
}

// values are kept as written (entities included); only bare "&" and quotes are escaped on output
const q = (v: string) => v.replace(/&(?![a-zA-Z]+;|#\d+;|#x[0-9a-fA-F]+;)/g, '&amp;').replace(/"/g, '&quot;')
const unq = (v: string) => v.replace(/&amp;/g, '&').replace(/&#0?38;/g, '&').replace(/&quot;/g, '"')

/** srcset + width/height for one bucket image (null if the src is not a bucket image with known dimensions) */
export function srcsetFor(site: Site, src: string): { srcset: string; w: number; h: number; pick: (slot: number) => string } | null {
  const base = bucketBase()
  if (!src.startsWith(base)) return null
  const key = safeDecode(src.slice(base.length).split(/[?#]/)[0])
  const e = indexFor(site).get(key)
  if (!e || !e.w || !e.h) return null
  const parts = e.variants.filter((v) => v.w < (e.w as number)).map((v) => `${publicPath(v.path)} ${v.w}w`)
  parts.push(`${src} ${e.w}w`)
  const vs = e.variants.filter((v) => v.w < (e.w as number))
  const pick = (slot: number) => {
    const v = vs.find((x) => x.w >= slot)
    return v ? publicPath(v.path) : src
  }
  return { srcset: parts.join(', '), w: e.w, h: e.h, pick }
}

/**
 * Rewrite every <img> in a document. `eagerUntil` = index in html before which images count as header chrome
 * (kept eager); the first bucket image after it is the above-the-fold main image (eager + fetchpriority=high).
 */
export function responsiveImages(site: Site, html: string, opts: { eagerBefore?: number; lcp?: boolean } = {}): string {
  const contentAt = opts.eagerBefore ?? -1
  let lcpDone = opts.lcp === false
  return html.replace(/<img\b([^>]*?)\s*\/?>/gi, (tag, rawAttrs: string, offset: number) => {
    const attrs = parseAttrs(rawAttrs)
    const get = (k: string) => attrs.find(([n]) => n === k)?.[1] ?? null
    const set = (k: string, v: string | null) => {
      const i = attrs.findIndex(([n]) => n === k)
      if (v === null) {
        if (i >= 0) attrs.splice(i, 1)
      } else if (i >= 0) attrs[i][1] = v
      else attrs.push([k, v])
    }
    const src = unq(get('src') || '')
    const info = src ? srcsetFor(site, src) : null
    if (!info) return tag // not one of ours (gravatar, legacy theme asset, placeholder, markup inside scripts)
    set('srcset', info.srcset)
    let w = Number(get('width')) || 0
    let h = Number(get('height')) || 0
    if (!w || !h) {
      w = info.w
      h = info.h
      set('width', String(w))
      set('height', String(h))
    }
    const header = contentAt >= 0 && offset < contentAt
    let eager = header
    if (!header && !lcpDone && contentAt >= 0) {
      lcpDone = true
      eager = true
      set('fetchpriority', 'high')
    }
    const { sizes, slot } = sizesFor(html, offset, get('class') || '', w)
    set('sizes', sizes)
    // src = the variant a desktop browser picks anyway: scripts that read img.src before the lazy image loaded
    // (imagesLoaded in Elementor galleries/posts, lightboxes) would otherwise download the full original
    const fallback = info.pick(slot)
    if (fallback !== src) set('src', fallback)
    if (eager) set('loading', null)
    else set('loading', 'lazy')
    set('decoding', 'async')
    return render(attrs)
  })
}

/**
 * The slot width a browser should pick a variant for. Not `sizes="auto"`: Elementor's post-thumbnail "fit" script
 * re-lays images out wider than their clipped box, and auto-sizing then re-downloads the full original.
 * Thumbnails / grid & gallery cells are small on desktop; on phones (≤767px) every image is full width.
 */
const SMALL_CTX = /elementor-post__thumbnail|gallery-icon|gallery-item|woocommerce-LoopProduct-link|ast-woocommerce-product-gallery__image|mini_cart_item|elementor-image-carousel|swiper-slide/
const SMALL_CLS = /\b(size-medium|size-thumbnail|attachment-medium|attachment-thumbnail|size-woocommerce_thumbnail|size-woocommerce_gallery_thumbnail|size-100x100|avatar)\b/
export function sizesFor(html: string, offset: number, cls: string, w: number): { sizes: string; slot: number } {
  const near = html.slice(Math.max(0, offset - 600), offset)
  const cols = Number(html.slice(Math.max(0, offset - 1500), offset).match(/gallery-columns-(\d)(?![\s\S]*gallery-columns-)/)?.[1] || 0)
  let slot = Math.min(w, 1440)
  if (cols > 1) slot = Math.min(slot, Math.ceil(1200 / cols))
  else if (SMALL_CLS.test(cls) || SMALL_CTX.test(near)) slot = Math.min(slot, 480)
  return { sizes: `(max-width: 767px) 100vw, ${slot}px`, slot }
}

function render(attrs: [string, string | null][]): string {
  return `<img ${attrs.map(([k, v]) => (v === null ? k : `${k}="${q(v)}"`)).join(' ')} />`
}

/** URL of the smallest stored version at least `minWidth` wide (for data-thumb style attributes) */
export function variantUrl(m: { url: string; width: number | null; variants?: Variant[] } | null, minWidth: number): string {
  if (!m) return ''
  const v = (m.variants || []).filter((x) => x.w >= minWidth && (!m.width || x.w < m.width)).sort((a, b) => a.w - b.w)[0]
  return v ? publicPath(v.path) : m.url
}
