/* eslint-disable @typescript-eslint/no-explicit-any */
/** Pages, blog posts, blog archives (category / tag / author / search) and the 404 page — Astra markup. */
import { fromStored, type Seo } from '../seo'
import { img, postLink, productLink, publishedPosts, termLink, termsOf, type Author, type Post, type Product, type Site, type Term } from '../site'
import { esc, stripTags } from '../util'
import { rerenderProductLoops } from './shop'
import { CONTENT_CLOSE, CONTENT_OPEN, imgTag, noticesHtml, paginateLinks, pagedUrl, searchForm, type Ctx, type View } from './common'

export const PER_PAGE = 10
const SITE_NAME = 'Kcasa 工富家飾'

function pageTitleHidden(p: Post): boolean {
  const v = p.meta?.ast_title
  if (v === 'hidden') return true
  if (v === 'shown') return false
  return p.post_type === 'page' && !!p.builder && p.builder !== 'gutenberg'
}

export function pageMain(p: Post, ctx: Ctx, inner?: string): string {
  const hidden = pageTitleHidden(p)
  const header = hidden
    ? `<header class="entry-header ast-no-thumbnail ast-no-title ast-header-without-markup">
							</header> <!-- .entry-header -->`
    : `<header class="entry-header ast-no-thumbnail">
				<h1 class="entry-title" itemprop="headline">${esc(p.title)}</h1>			</header> <!-- .entry-header -->`
  return `${CONTENT_OPEN}
	<div id="primary" class="content-area primary">
					<main id="main" class="site-main">
				<article
class="post-${p.id} page type-page status-publish${p.featured_media_id ? ' has-post-thumbnail' : ''} ast-article-single" id="post-${p.id}" itemtype="https://schema.org/CreativeWork" itemscope="itemscope">
				${header}
<div class="entry-content clear"
	itemprop="text">
	${inner ?? (ctx.notices.length ? noticesHtml(ctx.notices) : '') + p.content_html}
</div><!-- .entry-content .clear -->
</article><!-- #post-## -->
			</main><!-- #main -->
	</div><!-- #primary -->
${CONTENT_CLOSE}`
}

export function seoFor(p: Post, fallbackDesc?: string): Seo {
  return fromStored(p.seo, { title: `${p.title} - ${SITE_NAME}`, canonical: postLink(p), description: fallbackDesc, ogType: 'article' })
}

/** fix URLs the REST export left in rendered blocks/shortcodes (form actions, add-to-cart links) */
export function fixContent(html: string, path: string): string {
  return html
    .replace(/\/wp-json\/wp\/v2\/(?:pages|posts)\?per_page=100&#038;page=\d+&#038;context=view(&#038;)?/g, (_m, amp) => (amp ? path + '?' : path))
    .replace(/(<input type="hidden" name="page_url" value=")[^"]*"/g, `$1${path}"`)
}

const WPFORMS_CONFIRM = 'Thanks for contacting us! We will be in touch with you shortly.'

export function pageView(p: Post, ctx: Ctx): View {
  const path = p.path || ctx.path
  let content = rerenderProductLoops(ctx.site, fixContent(p.content_html, path))
  const wf = ctx.notices.find((n) => n.html.startsWith('wpforms:'))
  if (wf) {
    ctx.notices = ctx.notices.filter((n) => n !== wf)
    const id = wf.html.slice(8)
    content = content.replace(new RegExp(`<div class="wpforms-container[^"]*" id="wpforms-${id}">[\\s\\S]*?</form></div>`), `<div class="wpforms-confirmation-container-full wpforms-container-full" id="wpforms-confirm-${id}"><p>${WPFORMS_CONFIRM}</p></div>`)
  }
  const page = { ...p, content_html: content }
  return { status: 200, kind: p.builder === 'elementor' ? 'page_elementor' : 'page', legacyPath: path, main: pageMain(page, ctx), seo: seoFor(p) }
}

function authorLink(a: Author) {
  return `/author/${a.slug}/`
}

export function postView(p: Post, ctx: Ctx): View {
  const site = ctx.site
  const a = p.author_id ? site.authorById.get(p.author_id) : null
  const cats = termsOf(site, 'post', p.id, 'category')
  const classes = (Array.isArray(p.meta?.class_list) ? p.meta.class_list.join(' ') : `post-${p.id} post type-post status-publish format-standard${p.featured_media_id ? ' has-post-thumbnail' : ''} hentry ${cats.map((c) => 'category-' + c.slug).join(' ')}`) + ' ast-article-single'
  const metaParts: string[] = []
  if (p.comment_status === 'open')
    metaParts.push(`			<span class="comments-link">
				<a href="${esc(postLink(p))}#respond">發佈留言</a>			</span>
			`)
  if (cats.length) metaParts.push(`<span class="ast-terms-link">${cats.map((c) => `<a href="${esc(termLink(c))}" class="">${esc(c.name)}</a>`).join(', ')}</span>`)
  if (a)
    metaParts.push(`作者: <span class="posted-by vcard author" itemtype="https://schema.org/Person" itemscope="itemscope" itemprop="author">			<a title="檢視「${esc(a.display_name)}」的全部文章"
				href="${esc(authorLink(a))}" rel="author"
				class="url fn n" itemprop="url"				>
				<span
				class="author-name" itemprop="name"				>
				${esc(a.display_name)}			</span>
			</a>
		</span>
		`)
  const hidden = p.meta?.ast_title === 'hidden'
  const header = `<header class="entry-header ${hidden ? 'ast-no-title' : ''}">
			${hidden ? '' : `<h1 class="entry-title" itemprop="headline">${esc(p.title)}</h1>`}<div class="entry-meta">${metaParts.join(' / ')}</div>
		</header><!-- .entry-header -->`
  const main = `${CONTENT_OPEN}
	<div id="primary" class="content-area primary">
					<main id="main" class="site-main">
<article
class="${esc(classes.trim())}" id="post-${p.id}" itemtype="https://schema.org/CreativeWork" itemscope="itemscope">
<div class="ast-post-format- single-layout-1 ast-no-date-box">
		${header}
	<div class="entry-content clear"
	itemprop="text"	>
${p.content_html}
			</div><!-- .entry-content .clear -->
</div>
</article><!-- #post-## -->
			</main><!-- #main -->
	</div><!-- #primary -->
${CONTENT_CLOSE}`
  return { status: 200, kind: 'post', legacyPath: p.path || ctx.path, main, seo: seoFor(p, stripTags(p.excerpt_html).replace(/\s*\[&hellip;\]\s*$/, '').trim() || undefined) }
}

// ---------------------------------------------------------------- archive cards (Astra blog layout 4)
type Card = { id: number; link: string; title: string; excerpt: string; classes: string; image: ReturnType<typeof img> }

function largeSize(m: NonNullable<ReturnType<typeof img>>): [number, number] {
  const w = m.width || 1024
  const h = m.height || 1024
  const r = Math.min(1, 1024 / w, 1024 / h)
  return [Math.round(w * r), Math.round(h * r)]
}

function cardHtml(c: Card, i: number): string {
  const thumb = c.image
    ? `<div class="ast-blog-featured-section post-thumb ast-blog-single-element"><div class="post-thumb-img-content post-thumb"><a href="${esc(c.link)}" >${imgTag(c.image, { cls: 'attachment-large size-large wp-post-image', alt: '', size: largeSize(c.image), attrs: `itemprop="image"${i === 0 ? ' fetchpriority="high"' : ''}` })}</a></div></div>`
    : ''
  return `<article
class="${esc(c.classes)} ast-col-sm-12 ast-article-post ast-col-md-3 ast-archive-post" id="post-${c.id}" itemtype="https://schema.org/CreativeWork" itemscope="itemscope">
		<div class="ast-post-format- blog-layout-4 ast-article-inner ast-no-date-box">
	<div class="post-content ast-col-md-12" >
		${thumb}<h2 class="entry-title ast-blog-single-element" itemprop="headline"><a href="${esc(c.link)}" rel="bookmark">${esc(c.title)}</a></h2>			<div class="ast-excerpt-container ast-blog-single-element">
				${c.excerpt}
			</div>
		<p class="ast-blog-single-element ast-read-more-container read-more"> <a class="" href="${esc(c.link)}"> <span class="screen-reader-text">${esc(c.title)}</span> Read More »</a></p>		<div class="entry-content clear"
		itemprop="text"		>
					</div><!-- .entry-content .clear -->
	</div><!-- .post-content -->
</div> <!-- .blog-layout-4 -->
	</article><!-- #post-## -->
`
}

export function postCard(site: Site, p: Post): Card {
  const cls = Array.isArray(p.meta?.class_list) ? p.meta.class_list.join(' ') : `post-${p.id} ${p.post_type} type-${p.post_type} status-publish`
  return { id: p.id, link: postLink(p), title: p.title, excerpt: p.excerpt_html.trim(), classes: cls, image: img(site, p.featured_media_id) }
}

export function productCard(site: Site, p: Product): Card {
  const cls = Array.isArray(p.meta?.class_list) ? p.meta.class_list.join(' ') : `post-${p.id} product type-product status-publish`
  return { id: p.id, link: productLink(p), title: p.name, excerpt: '', classes: cls, image: img(site, p.featured_media_id) }
}

function archiveMain(opts: { description?: string; cards: Card[]; page: number; total: number; link: (n: number) => string; empty?: boolean }): string {
  const nav =
    opts.total > 1
      ? `		<div class='ast-pagination'>
	        <nav class="navigation pagination" aria-label="文章分頁">
	                <span class="screen-reader-text">文章分頁</span>
	                <div class="nav-links">${paginateLinks(opts.page, opts.total, opts.link, { prev: '<span class="ast-left-arrow">&larr;</span> Previous', next: 'Next <span class="ast-right-arrow">&rarr;</span>' })}</div>
	        </nav></div>${
            opts.page < opts.total
              ? `				<div class="ast-ajax-pagination-wrapper">
										<nav class="ast-pagination-infinite" data-page="${opts.page + 1}" data-total="${opts.total}">
							<div class="ast-loader">
									<div class="ast-loader-1"></div>
									<div class="ast-loader-2"></div>
									<div class="ast-loader-3"></div>
							</div>
													</nav>
									</div>`
              : ''
          }`
      : ''
  const body = opts.empty
    ? `<section class="no-results not-found">
	<div class="page-content">
			<p>找不到符合條件的內容。請使用搜尋功能，應會有所幫助。</p>
			${searchForm()}
	</div><!-- .page-content -->
</section><!-- .no-results -->`
    : `<div class="ast-row">${opts.cards.map(cardHtml).join('')}</div>`
  return `${CONTENT_OPEN}
	<div id="primary" class="content-area primary ast-blog-layout-4-grid ast-grid-4 ast-grid-md-1 ast-grid-sm-1">
				${opts.description || ''}
					<main id="main" class="site-main">
				${body}			</main><!-- #main -->
	${nav}
	</div><!-- #primary -->
${CONTENT_CLOSE}`
}

function archiveSeo(title: string, path: string, page: number, total: number, stored?: any): Seo {
  const s = fromStored(stored, { title: `${title} - ${SITE_NAME}`, canonical: path, ogType: 'article' })
  if (page > 1) {
    s.title = `${title} - 第 ${page} 頁 - ${SITE_NAME}`
    s.canonical = pagedUrl(path, page)
    s.meta = undefined
    s.jsonld = undefined
  }
  s.prev = page > 1 ? pagedUrl(path, page - 1) : null
  s.next = page < total ? pagedUrl(path, page + 1) : null
  return s
}

export function termArchiveView(t: Term, ctx: Ctx, page: number): View | null {
  const site = ctx.site
  const ids = new Set(site.termObjs.get(t.id) || [])
  const posts = publishedPosts(site).filter((p) => ids.has(p.id))
  const total = Math.max(1, Math.ceil(posts.length / PER_PAGE))
  if (page > total) return null
  const slice = posts.slice((page - 1) * PER_PAGE, page * PER_PAGE)
  const base = termLink(t)
  const desc = `<section class="ast-archive-description">
			<h1 class="page-title ast-archive-title">${esc(t.name)}</h1>${t.description ? `<p>${esc(t.description)}</p>` : ''}		</section>`
  return {
    status: 200,
    kind: t.taxonomy === 'category' ? 'category' : 'tag',
    legacyPath: base,
    main: archiveMain({ description: desc, cards: slice.map((p) => postCard(site, p)), page, total, link: (n) => pagedUrl(base, n), empty: !posts.length }),
    seo: archiveSeo(t.name, base, page, total, t.meta?.seo),
  }
}

export function authorView(a: Author, ctx: Ctx, page: number): View | null {
  const site = ctx.site
  const posts = publishedPosts(site).filter((p) => p.author_id === a.id)
  const total = Math.max(1, Math.ceil(posts.length / PER_PAGE))
  if (page > total) return null
  const base = authorLink(a)
  const avatar = a.avatar_url ? a.avatar_url.replace(/([?&])s=\d+/, '$1s=120') : ''
  const desc = `<section class="ast-author-box ast-archive-description">
					<div class="ast-author-bio">
												<h1 class='page-title ast-archive-title'>${esc(a.display_name)}</h1>
												<p>${esc(a.description).replace(/\r?\n/g, '<br />\n')}</p>
											</div>
					<div class="ast-author-avatar">
						${avatar ? `<img alt='' src='${esc(avatar)}' srcset='${esc(avatar.replace('s=120', 's=240'))} 2x' class='avatar avatar-120 photo' height='120' width='120' decoding='async'/>` : ''}					</div>
				</section>`
  const stored = site.settings.seo_paths?.[base]
  return {
    status: 200,
    kind: 'author',
    legacyPath: base,
    main: archiveMain({ description: desc, cards: posts.slice((page - 1) * PER_PAGE, page * PER_PAGE).map((p) => postCard(site, p)), page, total, link: (n) => pagedUrl(base, n), empty: !posts.length }),
    seo: archiveSeo(a.display_name, base, page, total, stored),
  }
}

/** WordPress search: posts, pages and products whose title or content contains every term. */
export function searchView(q: string, ctx: Ctx, page: number): View {
  const site = ctx.site
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
  const hit = (title: string, body: string) => {
    const t = title.toLowerCase()
    const b = stripTags(body).toLowerCase()
    return terms.every((w) => t.includes(w) || b.includes(w))
  }
  type R = { date: string; titleHit: boolean; card: Card }
  const res: R[] = []
  if (terms.length) {
    for (const p of site.posts) {
      if (p.status !== 'publish' || (p.post_type !== 'post' && p.post_type !== 'page')) continue
      if (p.seo?.robots?.includes('noindex') && p.post_type === 'page') continue
      if (hit(p.title, p.content_html + p.excerpt_html)) res.push({ date: p.published_at || '', titleHit: terms.every((w) => p.title.toLowerCase().includes(w)), card: postCard(site, p) })
    }
    for (const p of site.products) {
      if (p.status !== 'publish' || p.catalog_visibility === 'hidden' || p.catalog_visibility === 'catalog') continue
      if (hit(p.name, p.description_html + p.short_description_html)) res.push({ date: p.published_at || '', titleHit: terms.every((w) => p.name.toLowerCase().includes(w)), card: productCard(site, p) })
    }
  }
  // WP orders by relevance: full title matches first, then date desc
  res.sort((a, b) => Number(b.titleHit) - Number(a.titleHit) || b.date.localeCompare(a.date))
  const total = Math.max(1, Math.ceil(res.length / PER_PAGE))
  const qs = 's=' + encodeURIComponent(q)
  const seo: Seo = { title: `${q} - ${SITE_NAME}`, robots: 'follow, noindex', canonical: null, meta: [{ k: 'name', n: 'robots', c: 'follow, noindex' }, { k: 'property', n: 'og:locale', c: 'zh_TW' }, { k: 'property', n: 'og:type', c: 'article' }, { k: 'property', n: 'og:title', c: `${q} - ${SITE_NAME}` }, { k: 'property', n: 'og:url', c: `/?${qs}` }, { k: 'property', n: 'og:site_name', c: SITE_NAME }, { k: 'name', n: 'twitter:card', c: 'summary_large_image' }, { k: 'name', n: 'twitter:title', c: `${q} - ${SITE_NAME}` }] }
  return {
    status: 200,
    kind: 'search',
    legacyPath: '/?s=燈',
    main: archiveMain({ cards: res.slice((page - 1) * PER_PAGE, page * PER_PAGE).map((r) => r.card), page, total, link: (n) => (n <= 1 ? `/?${qs}` : `/page/${n}/?${qs}`), empty: !res.length }),
    seo,
  }
}

export function notFoundView(_ctx: Ctx): View {
  const main = `${CONTENT_OPEN}
	<div id="primary" class="content-area primary">
<section class="error-404 not-found">
	<div class="ast-404-layout-1" >
	<header class="page-header"><h1 class="page-title">這個頁面不存在。</h1></header><!-- .page-header -->
	<div class="page-content">
		<div class="page-sub-title">
			指向這裡的連結發生錯誤，請使用搜尋功能查詢其他結果。		</div>
		<div class="ast-404-search">
			<div class="widget widget_search">${searchForm()}
</div>		</div>
	</div><!-- .page-content -->
</div>
</section><!-- .error-404 -->
	</div><!-- #primary -->
${CONTENT_CLOSE}`
  return {
    status: 404,
    kind: '404',
    legacyPath: '/this-page-does-not-exist-404/',
    main,
    seo: { title: `Page Not Found - ${SITE_NAME}`, canonical: null, meta: [{ k: 'name', n: 'robots', c: 'follow, noindex' }, { k: 'property', n: 'og:locale', c: 'zh_TW' }, { k: 'property', n: 'og:title', c: `Page Not Found - ${SITE_NAME}` }, { k: 'property', n: 'og:site_name', c: SITE_NAME }] },
  }
}
