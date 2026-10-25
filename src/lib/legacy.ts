/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The "legacy shell": theme/plugin CSS+JS and the Astra header/footer chrome captured from the old
 * kcasa.pro pages (scripts/frontend/extract_legacy.py → src/generated/legacy.json). Content inside
 * #content is rendered from Supabase; header menus, the cart icon and the mini-cart are filled in here.
 */
import legacyJson from '@/generated/legacy.json'
import { esc, normPath } from './util'
import type { MenuItem } from './site'

type Item = { t: 'html'; v: string } | { t: 'css' | 'style'; id: string; href: string; media: string } | { t: 'js'; id: string; src: string; attrs: Record<string, string>; raw_attrs: string } | { t: 'jsinline'; id: string; src: string; type: string }
type PageRec = { bodyClass: string; bodyAttrs: string; head: string; pre: string; suf: string; status: number }
const L = legacyJson as unknown as { pages: Record<string, PageRec>; heads: Record<string, Item[]>; shells: Record<string, Item[]>; tails: Record<string, Item[]> }

const PAGES = new Map<string, PageRec>()
for (const [p, v] of Object.entries(L.pages)) PAGES.set(normPath(p), v)

/** representative captured page for each template kind (used for content created after the migration) */
export const TEMPLATE_PATH: Record<string, string> = {
  front: '/',
  page: '/contact/',
  page_elementor: '/home-2/',
  page_wc: '/my-account/',
  cart: '/cart/',
  checkout: '/checkout/',
  account: '/my-account/',
  post: '/富貴中山/',
  product: '/product/a001moailamp/',
  product_variable: '/product/a002capsulelamp/',
  product_cat: '/product-category/bed/',
  product_tag: '/product-tag/kcasa/',
  shop: '/shop/',
  category: '/category/article/',
  tag: '/tag/住宅空間/',
  author: '/author/armand/',
  search: '/?s=燈',
  '404': '/this-page-does-not-exist-404/',
}

export function legacyRecord(path: string, kind: string): PageRec {
  return PAGES.get(normPath(path)) || PAGES.get(normPath(TEMPLATE_PATH[kind] || '/')) || PAGES.get('/')!
}

export function hasRecord(path: string) {
  return PAGES.has(normPath(path))
}

// replaced by full-page form posts (cart/checkout) handled server-side
const SKIP_SCRIPT_IDS = new Set(['wc-cart-js', 'astra-single-product-ajax-cart-js', 'wc-checkout-js'])
const TRACKING_RE = /googletagmanager\.com|googlesyndication\.com|google_gtagjs|doubleclick/
const tracking = () => process.env.DISABLE_TRACKING !== '1'

function renderItems(items: Item[], opts: { skipTracking?: boolean } = {}): string {
  let out = ''
  for (const it of items) {
    switch (it.t) {
      case 'html': {
        let v = it.v
        if (opts.skipTracking && !tracking()) v = v.replace(/<noscript>\s*<iframe src="https:\/\/www\.googletagmanager\.com[\s\S]*?<\/noscript>/g, '')
        out += v + '\n'
        break
      }
      case 'css':
      case 'style':
        out += `<link rel='stylesheet' id='${esc(it.id || '')}' href='${esc(it.href)}' media='${esc(it.media || 'all')}' />\n`
        break
      case 'js': {
        if (!tracking() && TRACKING_RE.test(it.src)) break
        if (SKIP_SCRIPT_IDS.has(it.id)) break
        const attrs = Object.entries(it.attrs || {})
          .filter(([k]) => k !== 'async')
          .map(([k, v]) => ` ${k}="${esc(v)}"`)
          .join('')
        out += `<script src="${esc(it.src)}"${it.id ? ` id="${esc(it.id)}"` : ''}${attrs}${it.raw_attrs || ''}></script>\n`
        break
      }
      case 'jsinline': {
        if (it.type === 'application/json') break // wp-emoji settings (emoji loader dropped)
        if (it.type === 'module' && it.src.includes('script.16fcf90f01')) break // wp-emoji loader
        if (!tracking() && (it.id === 'google_gtagjs-js-after' || /script\.e6ee13584d/.test(it.src))) break
        out += `<script src="${esc(it.src)}"${it.id ? ` id="${esc(it.id)}"` : ''}${it.type ? ` type="${esc(it.type)}"` : ''}></script>\n`
        break
      }
    }
  }
  return out
}

export function renderHead(rec: PageRec): string {
  return renderItems(L.heads[rec.head] || [])
}

export type Chrome = {
  menus: Record<'primary' | 'secondary' | 'mobile', MenuItem[]>
  currentPath: string
  cartCount: number
  cartTotalHtml: string
  miniCartHtml: string
}

function menuHtml(items: MenuItem[], current: string): string {
  const cur = normPath(current)
  return items
    .filter((i) => !i.parent_id)
    .map((i) => {
      const id = i.wp_id || i.id
      // WordPress nav_menu_item: optional custom classes first, then the generated ones (Walker_Nav_Menu order)
      const custom = (i.css_classes || '').trim()
      const ot = i.object_type || 'custom'
      const type = ot === 'custom' ? 'custom' : ['page', 'post', 'product'].includes(ot) ? 'post_type' : 'taxonomy'
      const base = /\bmenu-item-type-/.test(custom) ? custom : `${custom} menu-item menu-item-type-${type} menu-item-object-${ot}`.trim()
      const isCur = normPath(i.url) === cur
      const curCls = isCur ? (ot === 'page' && i.object_id ? `current-menu-item page_item page-item-${i.object_id} current_page_item ` : 'current-menu-item ') : ''
      const cls = `${base} ${curCls}menu-item-${id}`.replace(/\s+/g, ' ')
      return `<li id="menu-item-${id}" class="${esc(cls)}"><a href="${esc(i.url)}"${i.target ? ` target="${esc(i.target)}"` : ''} class="menu-link"${isCur ? ' aria-current="page"' : ''}><span class="ast-icon icon-arrow"></span><span class="menu-text">${esc(i.title)}</span></a></li>`
    })
    .join('')
}

function cartLink(c: Chrome): string {
  return `<a href="/cart/" class="cart-container ast-cart-desktop-position- ast-cart-mobile-position- ast-cart-tablet-position-" aria-label="View Shopping Cart, ${c.cartCount ? `${c.cartCount} items` : 'empty'}">

							<div class="ast-cart-menu-wrap">
								<span class="count">
								<span class="ast-count-text">
									${c.cartCount}								</span>
								</span>
							</div>
										</a>`
}

function fill(html: string, c: Chrome): string {
  return html
    .replace('[[KC:MENU:primary]]', menuHtml(c.menus.primary, c.currentPath))
    .replace('[[KC:MENU:secondary]]', menuHtml(c.menus.secondary, c.currentPath))
    .replace('[[KC:MENU:mobile]]', menuHtml(c.menus.mobile, c.currentPath))
    .replace('[[KC:CARTLINK]]', cartLink(c))
    .replace(/<div class="widget_shopping_cart_content">\s*(\[\[KC:MINICART\]\])?\s*<\/div>/g, `<div class="widget_shopping_cart_content">${c.miniCartHtml}</div>`)
    .split('[[KC:MINICART]]')
    .join(c.miniCartHtml)
}

export function renderPre(rec: PageRec, c: Chrome): string {
  return fill(renderItems(L.shells[rec.pre] || [], { skipTracking: true }), c)
}

export function renderSuf(rec: PageRec, c: Chrome): string {
  return fill(renderItems(L.tails[rec.suf] || []), c)
}

/** theme/plugin stylesheets + body class of the captured page (used by the admin WYSIWYG editor) */
export function editorStyles(path: string | null, kind: string): { hrefs: string[]; bodyClass: string } {
  const rec = legacyRecord(path || '', kind)
  const hrefs: string[] = []
  for (const it of L.heads[rec.head] || []) if ((it.t === 'css' || it.t === 'style') && it.href && (it.media || 'all') !== 'print') hrefs.push(it.href)
  return { hrefs, bodyClass: rec.bodyClass }
}
