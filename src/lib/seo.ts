/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Rank Math style <head> SEO block. Each object's `seo` jsonb carries what the old page printed
 * (title, meta[] list, canonical, jsonld[]) — captured by scripts/frontend/apply_seo.py — plus
 * admin-editable overrides (title, description, robots, og_title, og_image, canonical).
 */
import { esc, siteUrl } from './util'

export type Seo = {
  title: string
  description?: string
  robots?: string
  canonical?: string | null
  ogType?: string
  ogTitle?: string
  ogImage?: string
  meta?: { k: string; n: string; c: string }[]
  jsonld?: string[]
  next?: string | null
  prev?: string | null
}

export function abs(u: string | null | undefined): string {
  if (!u) return ''
  if (/^https?:\/\//.test(u)) return u
  return siteUrl() + (u.startsWith('/') ? u : '/' + u)
}

/** Build a Seo from an object's stored seo jsonb (+ fallbacks). */
export function fromStored(stored: any, fb: { title: string; canonical?: string | null; description?: string; ogType?: string; image?: string | null }): Seo {
  const s = stored || {}
  return {
    title: s.title || fb.title,
    description: s.description ?? fb.description,
    robots: s.robots,
    canonical: s.canonical === undefined ? fb.canonical : s.canonical,
    ogType: s.og_type || fb.ogType,
    ogTitle: s.og_title,
    ogImage: s.og_image || fb.image || undefined,
    meta: Array.isArray(s.meta) ? s.meta : undefined,
    jsonld: Array.isArray(s.jsonld) ? s.jsonld : undefined,
  }
}

function absolutizeJsonLd(j: string): string {
  const base = siteUrl()
  // relative "@id"/"url"/"item" values written by the extractor → absolute on this deployment
  return j.replace(/("(?:@id|url|item|contentUrl|mainEntityOfPage|sameAs)":")\/(?!\/)/g, `$1${base}/`).replace(/<\/script/gi, '<\\/script')
}

export function renderSeo(seo: Seo): string {
  const out: string[] = []
  out.push('<!-- Search Engine Optimization by Rank Math - https://rankmath.com/ -->')
  out.push(`<title>${esc(seo.title)}</title>`)
  const canonical = seo.canonical ? abs(seo.canonical) : ''
  const meta = seo.meta && seo.meta.length ? seo.meta.map((m) => ({ ...m })) : synthMeta(seo)
  const has = (n: string) => meta.some((m) => m.n === n)
  // admin overrides win over the captured values
  for (const m of meta) {
    if (seo.description !== undefined && ['description', 'og:description', 'twitter:description'].includes(m.n)) m.c = seo.description
    if (seo.robots && m.n === 'robots') m.c = seo.robots
    if (seo.ogTitle && ['og:title', 'twitter:title'].includes(m.n)) m.c = seo.ogTitle
    if (m.n === 'og:url') m.c = canonical || abs(m.c)
  }
  if (seo.description && !has('description')) meta.unshift({ k: 'name', n: 'description', c: seo.description })
  for (const m of meta) {
    if (!m.c && m.n !== 'description') continue
    out.push(`<meta ${m.k === 'property' ? 'property' : 'name'}="${esc(m.n)}" content="${attrLight(m.c)}"/>`)
    if (m.n === 'robots' && canonical) out.push(`<link rel="canonical" href="${esc(canonical)}" />`)
  }
  if (canonical && !has('robots')) out.push(`<link rel="canonical" href="${esc(canonical)}" />`)
  if (seo.prev) out.push(`<link rel="prev" href="${esc(abs(seo.prev))}" />`)
  if (seo.next) out.push(`<link rel="next" href="${esc(abs(seo.next))}" />`)
  for (const j of seo.jsonld || []) out.push(`<script type="application/ld+json" class="rank-math-schema">${absolutizeJsonLd(j)}</script>`)
  out.push('<!-- /Rank Math WordPress SEO plugin -->')
  return out.join('\n')
}

/** captured values are already HTML-attribute encoded; only neutralise quotes/tags */
function attrLight(v: string): string {
  return String(v).replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function synthMeta(seo: Seo): { k: string; n: string; c: string }[] {
  const m: { k: string; n: string; c: string }[] = []
  if (seo.description) m.push({ k: 'name', n: 'description', c: seo.description })
  m.push({ k: 'name', n: 'robots', c: seo.robots || 'follow, index, max-snippet:-1, max-video-preview:-1, max-image-preview:large' })
  m.push({ k: 'property', n: 'og:locale', c: 'zh_TW' })
  m.push({ k: 'property', n: 'og:type', c: seo.ogType || 'article' })
  m.push({ k: 'property', n: 'og:title', c: seo.ogTitle || seo.title })
  if (seo.description) m.push({ k: 'property', n: 'og:description', c: seo.description })
  m.push({ k: 'property', n: 'og:url', c: seo.canonical || '' })
  m.push({ k: 'property', n: 'og:site_name', c: 'Kcasa 工富家飾' })
  if (seo.ogImage) {
    m.push({ k: 'property', n: 'og:image', c: seo.ogImage })
    m.push({ k: 'property', n: 'og:image:secure_url', c: seo.ogImage })
  }
  m.push({ k: 'name', n: 'twitter:card', c: 'summary_large_image' })
  m.push({ k: 'name', n: 'twitter:title', c: seo.ogTitle || seo.title })
  if (seo.description) m.push({ k: 'name', n: 'twitter:description', c: seo.description })
  if (seo.ogImage) m.push({ k: 'name', n: 'twitter:image', c: seo.ogImage })
  return m
}
