/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Seo } from '../seo'
import { esc } from '../util'
import type { Media, Site } from '../site'

export type Notice = { type: 'success' | 'error' | 'info'; html: string }

export type View = {
  status: number
  kind: string // template kind (see legacy TEMPLATE_PATH)
  legacyPath: string // captured page whose head/chrome to use
  bodyClass?: string // override (else captured)
  main: string // <div id="content"...> … (unclosed; the captured footer closes it)
  seo: Seo
  headExtra?: string
  footExtra?: string
  noindex?: boolean
  objectId?: number
  cache?: 'public' | 'private'
}

export type Ctx = {
  site: Site
  path: string // decoded request path, with trailing slash
  rawPath: string
  query: URLSearchParams
  notices: Notice[]
}

export function noticesHtml(ns: Notice[]): string {
  let out = '<div class="woocommerce-notices-wrapper">'
  for (const n of ns) {
    if (n.type === 'error') out += `<ul class="woocommerce-error" role="alert">\n\t\t\t<li>\n\t\t\t${n.html}\t\t</li>\n\t</ul>\n`
    else if (n.type === 'success') out += `\n\t<div class="woocommerce-message" role="alert">\n\t\t${n.html}\t</div>\n`
    else out += `\n\t<div class="woocommerce-info" role="status">\n\t\t${n.html}\t</div>\n`
  }
  return out + '</div>'
}

export function imgTag(m: Media | null, opts: { cls?: string; alt?: string; style?: string; attrs?: string; size?: [number, number] } = {}): string {
  if (!m) return ''
  const w = opts.size ? opts.size[0] : m.width || ''
  const h = opts.size ? opts.size[1] : m.height || ''
  return `<img width="${w}" height="${h}" src="${esc(m.url)}" class="${esc(opts.cls || '')}" alt="${esc(opts.alt ?? m.alt_text ?? '')}" decoding="async"${opts.style ? ` style="${esc(opts.style)}"` : ''}${opts.attrs ? ' ' + opts.attrs : ''} />`
}

/** WordPress paginate_links() (prev/next text configurable) */
export function paginateLinks(cur: number, total: number, link: (n: number) => string, o: { prev?: string; next?: string; mid?: number; end?: number; li?: boolean } = {}): string {
  const mid = o.mid ?? 2
  const end = o.end ?? 1
  const parts: string[] = []
  if (cur > 1 && o.prev) parts.push(`<a class="prev page-numbers" href="${esc(link(cur - 1))}">${o.prev}</a>`)
  let dots = false
  for (let n = 1; n <= total; n++) {
    if (n === cur) {
      parts.push(`<span aria-label="頁面 ${n}" aria-current="page" class="page-numbers current">${n}</span>`)
      dots = true
    } else if (n <= end || (cur && n >= cur - mid && n <= cur + mid) || n > total - end) {
      parts.push(`<a aria-label="頁面 ${n}" class="page-numbers" href="${esc(link(n))}">${n}</a>`)
      dots = true
    } else if (dots) {
      parts.push(`<span class="page-numbers dots">&hellip;</span>`)
      dots = false
    }
  }
  if (cur < total && o.next) parts.push(`<a class="next page-numbers" href="${esc(link(cur + 1))}">${o.next}</a>`)
  if (o.li) return `<ul class='page-numbers'>\n\t<li>${parts.join('</li>\n\t<li>')}</li>\n</ul>\n`
  return parts.join('\n')
}

/** /foo/ + page n → /foo/page/n/ (query kept) */
export function pagedUrl(base: string, n: number, query = ''): string {
  const b = base.endsWith('/') ? base : base + '/'
  return (n <= 1 ? b : `${b}page/${n}/`) + (query ? `?${query}` : '')
}

export const CONTENT_OPEN = `<div id="content" class="site-content">
		<div class="ast-container">
		`
export const CONTENT_CLOSE = `
	</div> <!-- ast-container -->
	`

export function searchForm(): string {
  return `<form role="search" method="get" class="search-form" action="/">
	<label for="search-field">
		<span class="screen-reader-text">搜尋關鍵字:</span>
		<input type="search" id="search-field" class="search-field"   placeholder="Search..." value="" name="s" tabindex="-1">
			</label>
			<input type="submit" class="search-submit" value="搜尋">
	</form>`
}
