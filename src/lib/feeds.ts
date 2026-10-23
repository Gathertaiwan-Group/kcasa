/** robots.txt, Rank Math-style XML sitemaps and the RSS feed. */
import { abs } from './seo'
import { img, postLink, productLink, publishedPosts, termLink, visibleProducts, type Site } from './site'
import { esc, siteUrl, stripTags } from './util'

export function robotsTxt(): string {
  return `User-agent: *
Disallow: /wp-content/uploads/wc-logs/
Disallow: /wp-content/uploads/woocommerce_transient_files/
Disallow: /wp-content/uploads/woocommerce_uploads/
Disallow: /*?add-to-cart=
Disallow: /*?*add-to-cart=
Disallow: /wp-admin/
Allow: /wp-admin/admin-ajax.php

Sitemap: ${siteUrl()}/sitemap_index.xml
`
}

const XSL = '' // Rank Math adds an XSL stylesheet; plain XML is equivalent for crawlers

type Entry = { loc: string; lastmod?: string | null; images?: string[] }

function urlset(entries: Entry[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>${XSL}
<urlset xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1" xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9 http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd http://www.google.com/schemas/sitemap-image/1.1 http://www.google.com/schemas/sitemap-image/1.1/sitemap-image.xsd" xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
  .map(
    (e) => `	<url>
		<loc>${esc(abs(e.loc))}</loc>
${e.lastmod ? `		<lastmod>${new Date(e.lastmod).toISOString().replace(/\.\d{3}Z$/, '+00:00')}</lastmod>\n` : ''}${(e.images || []).map((i) => `		<image:image>\n			<image:loc>${esc(i)}</image:loc>\n		</image:image>\n`).join('')}	</url>`,
  )
  .join('\n')}
</urlset>`
}

const indexable = (seo: { robots?: string } | null | undefined) => !String(seo?.robots || '').includes('noindex')

export function sitemapEntries(site: Site, name: string): Entry[] | null {
  switch (name) {
    case 'post':
      return publishedPosts(site)
        .filter((p) => indexable(p.seo))
        .map((p) => ({ loc: postLink(p), lastmod: p.modified_at, images: [img(site, p.featured_media_id)?.url].filter((x): x is string => !!x) }))
    case 'page': {
      const front = Number(site.settings.page_on_front || 0)
      return site.posts
        .filter((p) => p.post_type === 'page' && p.status === 'publish') // Rank Math listed cart/checkout/my-account too
        .sort((a, b) => (a.id === front ? -1 : b.id === front ? 1 : (b.modified_at || '').localeCompare(a.modified_at || '')))
        .map((p) => ({ loc: p.id === front ? '/' : postLink(p), lastmod: p.modified_at }))
    }
    case 'product':
      return visibleProducts(site)
        .filter((p) => indexable(p.seo))
        .map((p) => ({ loc: productLink(p), lastmod: p.modified_at, images: [p.featured_media_id, ...(p.gallery_media_ids || [])].map((id) => img(site, id)?.url).filter((x): x is string => !!x) }))
    case 'category':
      return site.terms.filter((t) => t.taxonomy === 'category' && t.count > 0).map((t) => ({ loc: termLink(t) }))
    case 'product_cat':
      return site.terms.filter((t) => t.taxonomy === 'product_cat' && t.count > 0).map((t) => ({ loc: termLink(t) }))
  }
  return null
}

export const SITEMAPS = ['post', 'page', 'product', 'category']

export function sitemapIndex(site: Site): string {
  return `<?xml version="1.0" encoding="UTF-8"?>${XSL}
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${SITEMAPS.map((n) => {
  const e = sitemapEntries(site, n) || []
  const last = e.map((x) => x.lastmod || '').sort().pop()
  return `	<sitemap>
		<loc>${siteUrl()}/${n}-sitemap.xml</loc>
${last ? `		<lastmod>${new Date(last).toISOString().replace(/\.\d{3}Z$/, '+00:00')}</lastmod>\n` : ''}	</sitemap>`
}).join('\n')}
</sitemapindex>`
}

export function sitemapXml(site: Site, name: string): string | null {
  const e = sitemapEntries(site, name)
  return e ? urlset(e) : null
}

export function rss(site: Site): string {
  const posts = publishedPosts(site).slice(0, 10)
  const base = siteUrl()
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"
	xmlns:content="http://purl.org/rss/1.0/modules/content/"
	xmlns:wfw="http://wellformedweb.org/CommentAPI/"
	xmlns:dc="http://purl.org/dc/elements/1.1/"
	xmlns:atom="http://www.w3.org/2005/Atom"
	xmlns:sy="http://purl.org/rss/1.0/modules/syndication/"
	xmlns:slash="http://purl.org/rss/1.0/modules/slash/"
	>

<channel>
	<title>Kcasa 工富家飾</title>
	<atom:link href="${base}/feed/" rel="self" type="application/rss+xml" />
	<link>${base}</link>
	<description></description>
	<lastBuildDate>${new Date(posts[0]?.modified_at || Date.now()).toUTCString().replace('GMT', '+0000')}</lastBuildDate>
	<language>zh-TW</language>
	<sy:updatePeriod>
	hourly	</sy:updatePeriod>
	<sy:updateFrequency>
	1	</sy:updateFrequency>
${posts
  .map((p) => {
    const a = p.author_id ? site.authorById.get(p.author_id) : null
    const cats = (site.objTerms.get(`post:${p.id}`) || []).map((t) => site.termById.get(t)).filter((t) => t && (t.taxonomy === 'category' || t.taxonomy === 'post_tag'))
    return `	<item>
		<title>${esc(p.title)}</title>
		<link>${esc(abs(postLink(p)))}</link>
		<dc:creator><![CDATA[${a?.display_name || ''}]]></dc:creator>
		<pubDate>${new Date(p.published_at || Date.now()).toUTCString().replace('GMT', '+0000')}</pubDate>
${cats.map((t) => `				<category><![CDATA[${t!.name}]]></category>`).join('\n')}
		<guid isPermaLink="false">${base}/?p=${p.id}</guid>

					<description><![CDATA[${stripTags(p.excerpt_html).trim()}]]></description>
										<content:encoded><![CDATA[${p.content_html.replace(/]]>/g, ']]]]><![CDATA[>')}]]></content:encoded>
					</item>`
  })
  .join('\n')}
	</channel>
</rss>
`
}
