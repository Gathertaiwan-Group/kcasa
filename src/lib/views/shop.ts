/* eslint-disable @typescript-eslint/no-explicit-any */
/** WooCommerce catalogue (shop / product-category / product-tag archives) and single product — Astra markup. */
import { attrKey, discountedUnit, purchasable, rulesFor, unitPrice } from '../cart'
import { fromStored, type Seo } from '../seo'
import { img, productLink, termLink, termsOf, visibleProducts, type Media, type Product, type Site, type Term, type Variation } from '../site'
import { esc, fmtNumber, money, num, stripTags } from '../util'
import { CONTENT_CLOSE, CONTENT_OPEN, imgTag, noticesHtml, paginateLinks, pagedUrl, type Ctx, type View } from './common'

export const SHOP_PER_PAGE = 12
const SITE_NAME = 'Kcasa 工富家飾'
const SYM = '&#78;&#84;&#36;'

function variationsOf(site: Site, p: Product): Variation[] {
  return (site.variations.get(p.id) || []).filter((v) => v.status === 'publish' && v.purchasable && num(v.price) !== null)
}

export function priceHtml(site: Site, p: Product): string {
  if (p.type === 'variable') {
    const prices = variationsOf(site, p).map((v) => Number(v.price))
    if (!prices.length) return ''
    const lo = Math.min(...prices)
    const hi = Math.max(...prices)
    if (lo === hi) return money(lo)
    const a = (n: number) => money(n).replace('<span class="woocommerce-Price-amount amount">', '<span class="woocommerce-Price-amount amount" aria-hidden="true">')
    return `${a(lo)} <span aria-hidden="true">–</span> ${a(hi)}<span class="screen-reader-text">價格範圍：${SYM}${fmtNumber(lo)} 到 ${SYM}${fmtNumber(hi)}</span>`
  }
  const { regular, price } = unitPrice(p, null)
  if (num(p.price) === null) return ''
  if (num(p.sale_price) !== null && regular > price) {
    return `<del aria-hidden="true">${money(regular)}</del> <span class="screen-reader-text">原始價格：${SYM}${fmtNumber(regular)}。</span><ins aria-hidden="true">${money(price)}</ins><span class="screen-reader-text">目前價格：${SYM}${fmtNumber(price)}。</span>`
  }
  return money(price)
}

function productClasses(site: Site, p: Product, pos: string): string {
  const cats = termsOf(site, 'product', p.id, 'product_cat').map((t) => 'product_cat-' + t.slug)
  const tags = termsOf(site, 'product', p.id, 'product_tag').map((t) => 'product_tag-' + (/%/.test(t.slug) ? t.id : t.slug))
  const buyable = p.type === 'variable' ? variationsOf(site, p).length > 0 : purchasable(p, null)
  return [
    'product type-product',
    `post-${p.id}`,
    'status-publish',
    pos,
    p.stock_status === 'outofstock' ? 'outofstock' : p.stock_status === 'onbackorder' ? 'onbackorder' : 'instock',
    ...cats,
    ...tags,
    p.featured ? 'featured' : '',
    p.featured_media_id ? 'has-post-thumbnail' : '',
    num(p.sale_price) !== null ? 'sale' : '',
    'shipping-taxable',
    buyable ? 'purchasable' : '',
    `product-type-${p.type}`,
  ]
    .filter(Boolean)
    .join(' ')
}

const THUMB_STYLE = 'aspect-ratio:4/3;object-fit:cover;width:100%;height:auto'

export function loopItem(site: Site, p: Product, i: number, cols: number, inContent = false): string {
  const pos = i % cols === 0 ? 'first' : i % cols === cols - 1 ? 'last' : ''
  const link = productLink(p)
  const m = img(site, p.featured_media_id)
  const price = priceHtml(site, p)
  const variableCls = p.type === 'variable' ? ' ast-product-single-variable' : ''
  const sale = num(p.sale_price) !== null && p.type !== 'variable' ? `<span class="ast-on-card-button ast-onsale-card" data-sale="sale">特價！</span>` : ''
  const lead = inContent ? 'ast-article-single desktop-align-center tablet-align-center mobile-align-center' : 'ast-col-sm-12 ast-article-post desktop-align-center tablet-align-center mobile-align-center ast-col-md-3 ast-archive-post'
  return `<li class="${lead} ast-product-gallery-layout-horizontal-slider ast-magnify-disabled${variableCls} ast-product-tabs-layout-horizontal ${productClasses(site, p, pos)}">
	<div class="astra-shop-thumbnail-wrap">${sale}<a href="${esc(link)}" class="woocommerce-LoopProduct-link woocommerce-loop-product__link">${m ? imgTag(m, { cls: 'attachment-woocommerce_thumbnail size-woocommerce_thumbnail', alt: p.name, size: [600, 450], style: THUMB_STYLE }) : `<img width="600" height="450" src="/legacy/wp-content/plugins/woocommerce/assets/images/placeholder.png" class="woocommerce-placeholder wp-post-image" alt="預留位置" decoding="async" />`}</a></div><div class="astra-shop-summary-wrap"><a href="${esc(link)}" class="ast-loop-product__link"><h2 class="woocommerce-loop-product__title">${esc(p.name)}</h2></a>
${price ? `	<span class="price">${price}</span>\n` : ''}</div></li>
`
}

const ORDERBY: [string, string][] = [
  ['menu_order', '預設排序'],
  ['popularity', '依熱銷度'],
  ['rating', '依平均評分'],
  ['date', '依最新項目排序'],
  ['price', '依價格排序:低至高'],
  ['price-desc', '依價格排序:高至低'],
]

function sortProducts(site: Site, list: Product[], orderby: string): Product[] {
  const minPrice = (p: Product) => {
    if (p.type === 'variable') {
      const v = variationsOf(site, p).map((x) => Number(x.price))
      return v.length ? Math.min(...v) : Number(p.price_min ?? p.price ?? 0)
    }
    return Number(p.price ?? 0)
  }
  const maxPrice = (p: Product) => {
    if (p.type === 'variable') {
      const v = variationsOf(site, p).map((x) => Number(x.price))
      return v.length ? Math.max(...v) : Number(p.price_max ?? p.price ?? 0)
    }
    return Number(p.price ?? 0)
  }
  const byTitle = (a: Product, b: Product) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  const date = (p: Product) => p.published_at || ''
  const arr = [...list]
  switch (orderby) {
    case 'popularity':
      return arr.sort((a, b) => b.total_sales - a.total_sales || b.id - a.id)
    case 'rating':
      return arr.sort((a, b) => Number(b.average_rating) - Number(a.average_rating) || b.review_count - a.review_count || b.id - a.id)
    case 'date':
      return arr.sort((a, b) => date(b).localeCompare(date(a)) || b.id - a.id)
    case 'price':
      return arr.sort((a, b) => minPrice(a) - minPrice(b) || b.id - a.id)
    case 'price-desc':
      return arr.sort((a, b) => maxPrice(b) - maxPrice(a) || b.id - a.id)
    default:
      return arr.sort((a, b) => a.menu_order - b.menu_order || byTitle(a, b))
  }
}

function resultCount(page: number, total: number): string {
  const first = (page - 1) * SHOP_PER_PAGE + 1
  const last = Math.min(total, page * SHOP_PER_PAGE)
  if (total === 1) return '顯示單一結果'
  if (total <= SHOP_PER_PAGE) return `顯示全部 ${total} 項結果`
  return `顯示第 ${first} 至 ${last} 項結果，共 ${total} 項`
}

export function catalogView(ctx: Ctx, opts: { term?: Term; page: number; base: string; legacyPath: string; kind: string; title: string; stored?: any }): View | null {
  const site = ctx.site
  const orderby = ORDERBY.some(([k]) => k === ctx.query.get('orderby')) ? ctx.query.get('orderby')! : 'menu_order'
  let list = visibleProducts(site).filter((p) => p.catalog_visibility !== 'search')
  if (opts.term) {
    const ids = new Set(site.termObjs.get(opts.term.id) || [])
    // child categories count too
    for (const t of site.terms.filter((x) => x.parent_id === opts.term!.id)) for (const id of site.termObjs.get(t.id) || []) ids.add(id)
    list = list.filter((p) => ids.has(p.id))
  }
  const catFilter = ctx.query.get('product_cat')
  if (catFilter) {
    const t = site.termBySlug.get(`product_cat:${catFilter.toLowerCase()}`)
    const ids = new Set(t ? site.termObjs.get(t.id) || [] : [])
    list = list.filter((p) => ids.has(p.id))
  }
  const total = list.length
  const pages = Math.max(1, Math.ceil(total / SHOP_PER_PAGE))
  if (opts.page > pages) return null
  const sorted = sortProducts(site, list, orderby)
  const slice = sorted.slice((opts.page - 1) * SHOP_PER_PAGE, opts.page * SHOP_PER_PAGE)
  const keep = new URLSearchParams()
  for (const [k, v] of ctx.query) if (k !== 'paged') keep.set(k, v)
  const qs = keep.toString()
  const ordering = `<form class="woocommerce-ordering" method="get">
		<select
		name="orderby"
		class="orderby"
					aria-label="商店訂單"
			>
${ORDERBY.map(([k, label]) => `					<option value="${k}" ${k === orderby ? " selected='selected'" : ''}>${label}</option>`).join('\n')}
			</select>
	<input type="hidden" name="paged" value="1" />
	${[...ctx.query].filter(([k]) => !['orderby', 'paged', 'submit'].includes(k)).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}" />`).join('')}</form>`
  const desc = opts.term?.description ? `<div class="term-description"><p>${esc(opts.term.description)}</p></div>` : ''
  const body = total
    ? `				<div class="ast-shop-toolbar-container">
							<div class="ast-shop-toolbar-aside-wrap">
			<button class="astra-shop-filter-button ast-flyout-filter" data-selector="astra-off-canvas-sidebar-wrapper"><span class="astra-woo-filter-icon"><span class="ast-icon icon-menu-bars"><span class="menu-toggle-icon"></span></span> <span class="ast-icon icon-close"></span></span><span class="astra-woo-filter-text">商品分類</span></button><p class="woocommerce-result-count" role="alert" aria-relevant="all" >
	${resultCount(opts.page, total)}</p>
				</div>
							<div class="ast-shop-toolbar-aside-wrap">
			${ordering}
				</div>
							</div>
			<ul class="products columns-3">
${slice.map((p, i) => loopItem(site, p, i, 3)).join('')}</ul>
${
  pages > 1
    ? `<nav class="woocommerce-pagination" aria-label="商品分頁">
	${paginateLinks(opts.page, pages, (n) => pagedUrl(opts.base, n, qs), { prev: '&larr;', next: '&rarr;', mid: 3, end: 3, li: true })}</nav>
`
    : ''
}`
    : `<div class="woocommerce-no-products-found">

	<div class="woocommerce-info" role="status">
		找不到符合你選擇的商品。	</div>
</div>
`
  const main = `${CONTENT_OPEN}
					<div id="primary" class="content-area primary">
				<main id="main" class="site-main">
					<div class="ast-woocommerce-container">
			<header class="woocommerce-products-header">
	${desc}</header>
${noticesHtml(ctx.notices)}${body}					</div> <!-- .ast-woocommerce-container -->
				</main> <!-- #main -->
			</div> <!-- #primary -->
${CONTENT_CLOSE}`
  const seo: Seo = fromStored(opts.stored, { title: `${opts.title} - ${SITE_NAME}`, canonical: opts.base, ogType: 'article' })
  if (opts.page > 1) {
    seo.title = `${opts.title} - 第 ${opts.page} 頁 - ${SITE_NAME}`
    seo.canonical = pagedUrl(opts.base, opts.page)
    seo.meta = undefined
    seo.jsonld = undefined
  }
  seo.prev = opts.page > 1 ? pagedUrl(opts.base, opts.page - 1) : null
  seo.next = opts.page < pages ? pagedUrl(opts.base, opts.page + 1) : null
  return { status: 200, kind: opts.kind, legacyPath: opts.legacyPath, main, seo }
}

// ---------------------------------------------------------------- single product
function variationJson(site: Site, p: Product, v: Variation): any {
  const m = img(site, v.image_id || p.featured_media_id)
  const attrs: Record<string, string> = {}
  for (const a of v.attributes || []) attrs[`attribute_${attrKey(site, p.id, a.name)}`] = a.value ?? ''
  const { regular, price } = unitPrice(p, v)
  const stockQty = v.manage_stock ? v.stock_quantity : p.manage_stock ? p.stock_quantity : null
  const inStock = v.stock_status !== 'outofstock'
  const avail = stockQty !== null && stockQty !== undefined ? stockHtml(inStock, stockQty) : !inStock ? stockHtml(false, null) : ''
  return {
    attributes: attrs,
    availability_html: avail,
    backorders_allowed: v.backorders !== 'no',
    dimensions: { length: v.length || '', width: v.width || '', height: v.height || '' },
    dimensions_html: v.length || v.width || v.height ? [v.length, v.width, v.height].filter(Boolean).join(' &times; ') + ' cm' : '不提供',
    display_price: price,
    display_regular_price: regular,
    image: m
      ? { title: m.title, caption: stripTags(m.caption_html || ''), url: m.url, alt: m.alt_text || m.title, src: m.url, srcset: '', sizes: '(max-width: 600px) 100vw, 600px', full_src: m.url, full_src_w: m.width, full_src_h: m.height, gallery_thumbnail_src: m.url, gallery_thumbnail_src_w: 100, gallery_thumbnail_src_h: 100, thumb_src: m.url, thumb_src_w: 600, thumb_src_h: 450, src_w: 600, src_h: m.width && m.height ? Math.round((600 * m.height) / m.width) : 600 }
      : {},
    image_id: m?.id || 0,
    is_downloadable: false,
    is_in_stock: inStock,
    is_purchasable: true,
    is_sold_individually: p.sold_individually ? 'yes' : 'no',
    is_virtual: false,
    max_qty: stockQty !== null && stockQty !== undefined && v.backorders === 'no' ? stockQty : '',
    min_qty: 1,
    price_html: `<span class="price">${regular > price ? `<del aria-hidden="true">${money(regular)}</del> <ins aria-hidden="true">${money(price)}</ins>` : money(price)}</span>`,
    sku: v.sku || '',
    variation_description: v.description_html || '',
    variation_id: v.id,
    variation_is_active: true,
    variation_is_visible: true,
    weight: v.weight || '',
    weight_html: v.weight ? `${v.weight} kg` : '不提供',
  }
}

function stockHtml(inStock: boolean, qty: number | null): string {
  return `				<p class="ast-stock-detail">
					<span class="ast-stock-avail">庫存量:</span>
					<span class="stock ${inStock ? 'in-stock' : 'out-of-stock'}">${inStock ? (qty !== null ? `${qty} 件庫存` : '有庫存') : '缺貨'}</span>
				</p>
				`
}

function qtyInput(p: Product, max: number | null): string {
  const id = 'quantity_' + p.id.toString(16) + Math.floor(Math.random() * 1e9).toString(16)
  return `<div class="quantity">
		<label class="screen-reader-text" for="${id}">${esc(p.name)} 數量</label>
	<input
		type="number"
				id="${id}"
		class="input-text qty text"
		name="quantity"
		value="1"
		aria-label="商品數量"
				min="1"
		${max ? `			max="${max}"\n` : ''}							step="1"
			placeholder=""
			inputmode="numeric"
			autocomplete="off"
			/>
	</div>`
}

function qtyDiscountTable(site: Site, p: Product): string {
  const rules = rulesFor(site, p)
  if (!rules.length) return ''
  const base = p.type === 'variable' ? null : unitPrice(p, null).price
  const rows = rules
    .map((r) => {
      const range = r.max_qty ? `${r.min_qty} - ${r.max_qty}` : `${r.min_qty}+`
      const val = r.discount_type === 'percent' ? `${Number(r.amount)}% off` : base !== null ? money(discountedUnit(r, base)) : r.discount_type === 'fixed_per_item' ? `-${money(r.amount)}` : money(r.amount)
      return `<tr><td>${esc(range)}</td><td>${val}</td></tr>`
    })
    .join('')
  return `<div class="kc-quantity-discounts"><table class="shop_table kc-qty-table"><thead><tr><th>數量</th><th>${base !== null ? '單價' : '折扣'}</th></tr></thead><tbody>${rows}</tbody></table></div>`
}

function galleryHtml(site: Site, p: Product): string {
  const ids = [p.featured_media_id, ...(p.gallery_media_ids || [])].filter((x): x is number => !!x).map(Number)
  const uniq = [...new Set(ids)]
  const ms = uniq.map((id) => site.media.get(id)).filter((m): m is Media => !!m)
  if (!ms.length) {
    return `<div class="woocommerce-product-gallery woocommerce-product-gallery--without-images woocommerce-product-gallery--columns-4 images" data-columns="4" style="opacity: 0; transition: opacity .25s ease-in-out;">
	<figure class="woocommerce-product-gallery__wrapper">
		<div class="woocommerce-product-gallery__image--placeholder"><img src="/legacy/wp-content/plugins/woocommerce/assets/images/placeholder.png" alt="等待產品圖片" class="wp-post-image" /></div>	</figure>
	</div>`
  }
  const h600 = (m: Media) => (m.width && m.height ? Math.round((600 * m.height) / m.width) : 600)
  const main = ms
    .map((m, i) => {
      const alt = i === 0 ? p.name : `${p.name}：圖片 ${i + 1}`
      return `<div data-thumb="${esc(m.url)}" data-thumb-alt="${esc(alt)}" data-thumb-srcset="" data-thumb-sizes="(max-width: 150px) 100vw, 150px" class="woocommerce-product-gallery__image"><a href="${esc(m.url)}"><img width="600" height="${h600(m)}" src="${esc(m.url)}" class="${i === 0 ? 'wp-post-image' : ''}" alt="${esc(alt)}" data-caption="${esc(stripTags(m.caption_html || ''))}" data-src="${esc(m.url)}" data-large_image="${esc(m.url)}" data-large_image_width="${m.width || 1200}" data-large_image_height="${m.height || 1200}" decoding="async" /></a></div>`
    })
    .join('')
  const thumbs =
    ms.length > 1
      ? `		<!-- Product gallery thumbnail -->
			<div class="ast-single-product-thumbnails
		">
			<div class="woocommerce-product-gallery-thumbnails__wrapper">
				${ms.map((m, i) => `<div data-slide-number="${i}" data-thumb="${esc(m.url)}" data-thumb-alt="" class="ast-woocommerce-product-gallery__image ${i === 0 ? 'flex-active-slide' : ''}"><img width="100" height="100" src="${esc(m.url)}" class="attachment-100x100 size-100x100" alt="" data-original-src="${esc(m.url)}" style="object-fit:cover;aspect-ratio:1/1" /></div>`).join('')}			</div>
		</div>
`
      : ''
  return `<div class="woocommerce-product-gallery woocommerce-product-gallery--with-images woocommerce-product-gallery--columns-4 images" data-columns="4" style="opacity: 0; transition: opacity .25s ease-in-out;">
	<figure class="woocommerce-product-gallery__wrapper">
		${main}	</figure>
${thumbs}	</div>`
}

function addToCartHtml(site: Site, p: Product): string {
  const link = productLink(p)
  if (p.type === 'variable') {
    const vars = variationsOf(site, p)
    if (!vars.length) return ''
    const json = JSON.stringify(vars.map((v) => variationJson(site, p, v)))
    const rows = (site.attrValues.get(p.id) || [])
      .filter((a) => a.used_for_variations)
      .map((a) => {
        const key = attrKey(site, p.id, a.name)
        const isTax = !!a.attribute_id
        const opts = isTax
          ? (a.term_ids || []).map((tid) => site.termById.get(Number(tid))).filter((t): t is Term => !!t).map((t) => [t.slug, t.name])
          : a.options.map((o) => [o, o])
        return `									<tr>
						<th class="label"><label for="${esc(key)}">${esc(a.name)}</label></th>
						<td class="value">
							<select id="${esc(key)}" class="" name="attribute_${esc(key)}" data-attribute_name="attribute_${esc(key)}" data-show_option_none="yes"><option value="">請選取一個選項</option>${opts.map(([v, l]) => `<option value="${esc(v)}" >${esc(l)}</option>`).join('')}</select><a class="reset_variations" href="#" aria-label="清除選項">清除</a>						</td>
					</tr>
`
      })
      .join('')
    return `
<form class="variations_form cart" action="${esc(link)}" method="post" enctype='multipart/form-data' data-product_id="${p.id}" data-product_variations="${esc(json)}">
			<table class="variations" cellspacing="0" role="presentation">
			<tbody>
${rows}							</tbody>
		</table>
		<div class="reset_variations_alert screen-reader-text" role="alert" aria-live="polite" aria-relevant="all"></div>
		<div class="single_variation_wrap">
			<div class="woocommerce-variation single_variation" role="alert" aria-relevant="additions"></div><div class="woocommerce-variation-add-to-cart variations_button">
	${qtyInput(p, null)}
	<button type="submit" class="single_add_to_cart_button button alt">加入購物車</button>
	<input type="hidden" name="add-to-cart" value="${p.id}" />
	<input type="hidden" name="product_id" value="${p.id}" />
	<input type="hidden" name="variation_id" class="variation_id" value="0" />
</div>
		</div>
	</form>
${qtyDiscountTable(site, p)}`
  }
  if (!purchasable(p, null)) return ''
  const max = p.manage_stock && p.stock_quantity !== null && p.backorders === 'no' ? p.stock_quantity : null
  return `	<form class="cart" action="${esc(link)}" method="post" enctype='multipart/form-data'>
		${p.sold_individually ? `<input type="hidden" name="quantity" value="1" />` : qtyInput(p, max)}

		<button type="submit" name="add-to-cart" value="${p.id}" class="single_add_to_cart_button button alt">加入購物車</button>

			</form>
${qtyDiscountTable(site, p)}`
}

function reviewsHtml(site: Site, p: Product): { title: string; html: string } {
  const reviews = site.comments.filter((c) => c.object_type === 'product' && Number(c.post_id) === p.id && c.status === 'approved')
  const list = reviews.length
    ? `<ol class="commentlist">${reviews
        .map(
          (r) => `<li class="review byuser comment-author even thread-even depth-1" id="li-comment-${r.id}">
	<div id="comment-${r.id}" class="comment_container">
		<div class="comment-text">
			${r.rating ? `<div class="star-rating" role="img" aria-label="評分為 ${r.rating}，滿分為 5 分"><span style="width:${r.rating * 20}%">評分為 <strong class="rating">${r.rating}</strong>，滿分為 5 分</span></div>` : ''}
	<p class="meta">
		<strong class="woocommerce-review__author">${esc(r.author_name)} </strong>
				<span class="woocommerce-review__dash">&ndash;</span> <time class="woocommerce-review__published-date" datetime="${esc(r.created_at)}">${new Date(r.created_at).toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Taipei' })}</time>
	</p>
	<div class="description">${r.content_html}</div>
		</div>
	</div>
</li><!-- #comment-## -->`,
        )
        .join('')}</ol>`
    : `					<p class="woocommerce-noreviews">目前沒有評價。</p>`
  const html = `<div id="reviews" class="woocommerce-Reviews">
	<div id="comments">
		<h2 class="woocommerce-Reviews-title">
			${reviews.length ? `「${esc(p.name)}」有 ${reviews.length} 則評價` : '商品評價'}		</h2>

${list}
			</div>

			<div id="review_form_wrapper">
			<div id="review_form">
					<div id="respond" class="comment-respond">
		<span id="reply-title" class="comment-reply-title" role="heading" aria-level="3">${reviews.length ? '新增評價' : `搶先評價 &ldquo;${esc(p.name)}&rdquo;`} <small><a rel="nofollow" id="cancel-comment-reply-link" href="${esc(productLink(p))}#respond" style="display:none;">取消回覆</a></small></span><form action="/wp-comments-post.php" method="post" id="commentform" class="comment-form"><p class="comment-notes"><span id="email-notes">發佈留言必須填寫的電子郵件地址不會公開。</span> <span class="required-field-message">必填欄位標示為 <span class="required">*</span></span></p><div class="comment-form-rating"><label for="rating" id="comment-form-rating-label">您的評分&nbsp;<span class="required">*</span></label><select name="rating" id="rating" required>
						<option value="">評分&hellip;</option>
						<option value="5">完美</option>
						<option value="4">很好</option>
						<option value="3">一般</option>
						<option value="2">不錯</option>
						<option value="1">很差</option>
					</select></div><p class="comment-form-comment"><label for="comment">您的評價&nbsp;<span class="required">*</span></label><textarea id="comment" name="comment" cols="45" rows="8" required></textarea></p><p class="comment-form-author"><label for="author">名稱&nbsp;<span class="required">*</span></label><input id="author" name="author" type="text" autocomplete="name" value="" size="30" required /></p>
<p class="comment-form-email"><label for="email">電子郵件地址&nbsp;<span class="required">*</span></label><input id="email" name="email" type="email" autocomplete="email" value="" size="30" required /></p>
<p class="comment-form-cookies-consent"><input id="wp-comment-cookies-consent" name="wp-comment-cookies-consent" type="checkbox" value="yes" /> <label for="wp-comment-cookies-consent">在<strong>瀏覽器</strong>中儲存顯示名稱、電子郵件地址及個人網站網址，以供下次發佈留言時使用。</label></p>
<p class="form-submit"><input name="submit" type="submit" id="submit" class="submit" value="送出" /> <input type='hidden' name='comment_post_ID' value='${p.id}' id='comment_post_ID' />
<input type='hidden' name='comment_parent' id='comment_parent' value='0' />
</p></form>	</div><!-- #respond -->
				</div>
		</div>

	<div class="clear"></div>
</div>`
  return { title: `評價 (${reviews.length})`, html }
}

function tabsHtml(site: Site, p: Product): string {
  const tabs: { id: string; cls: string; title: string; html: string }[] = []
  if (p.description_html.trim()) tabs.push({ id: 'description', cls: 'description_tab', title: '描述', html: `<h2>描述</h2>\n${p.description_html}` })
  const info = (site.attrValues.get(p.id) || []).filter((a) => a.visible)
  const dims = [p.length, p.width, p.height].filter(Boolean)
  if (info.length || p.weight || dims.length) {
    const rows = [
      p.weight ? `<tr class="woocommerce-product-attributes-item woocommerce-product-attributes-item--weight"><th class="woocommerce-product-attributes-item__label" scope="row">重量</th><td class="woocommerce-product-attributes-item__value">${esc(p.weight)} kg</td></tr>` : '',
      dims.length ? `<tr class="woocommerce-product-attributes-item woocommerce-product-attributes-item--dimensions"><th class="woocommerce-product-attributes-item__label" scope="row">尺寸</th><td class="woocommerce-product-attributes-item__value">${dims.map(esc).join(' &times; ')} cm</td></tr>` : '',
      ...info.map((a) => {
        const vals = a.attribute_id ? (a.term_ids || []).map((t) => site.termById.get(Number(t))?.name).filter(Boolean) : a.options
        return `<tr class="woocommerce-product-attributes-item woocommerce-product-attributes-item--attribute_${esc(attrKey(site, p.id, a.name))}"><th class="woocommerce-product-attributes-item__label" scope="row">${esc(a.name)}</th><td class="woocommerce-product-attributes-item__value"><p>${vals.map(esc).join(', ')}</p></td></tr>`
      }),
    ].join('')
    tabs.push({ id: 'additional_information', cls: 'additional_information_tab', title: '額外資訊', html: `<h2>額外資訊</h2>\n<table class="woocommerce-product-attributes shop_attributes" aria-label="商品詳細資訊">${rows}</table>` })
  }
  for (const t of (p.meta?.custom_tabs || []) as { id: string; title: string; content_html: string }[]) {
    tabs.push({ id: t.id, cls: `${t.id}_tab`, title: t.title, html: `<h2 class="yikes-custom-woo-tab-title yikes-custom-woo-tab-title-${esc(t.id)}">${esc(t.title)}</h2>${t.content_html}` })
  }
  if (p.reviews_allowed) {
    const r = reviewsHtml(site, p)
    tabs.push({ id: 'reviews', cls: 'reviews_tab', title: r.title, html: r.html })
  }
  if (!tabs.length) return ''
  return `
	<div class="woocommerce-tabs wc-tabs-wrapper">
		<ul class="tabs wc-tabs" role="tablist">
${tabs
  .map(
    (t) => `							<li role="presentation" class="${esc(t.cls)}" id="tab-title-${esc(t.id)}">
					<a href="#tab-${esc(t.id)}" role="tab" aria-controls="tab-${esc(t.id)}">
						${esc(t.title)}					</a>
				</li>
`,
  )
  .join('')}					</ul>
${tabs
  .map(
    (t) => `					<div class="woocommerce-Tabs-panel woocommerce-Tabs-panel--${esc(t.id)} panel entry-content wc-tab" id="tab-${esc(t.id)}" role="tabpanel" aria-labelledby="tab-title-${esc(t.id)}">
				${t.html}
			</div>
`,
  )
  .join('')}
			</div>
`
}

export function productView(p: Product, ctx: Ctx): View {
  const site = ctx.site
  const variableCls = p.type === 'variable' ? ' ast-product-single-variable' : ''
  const cls = `ast-article-single ast-woo-product-no-review desktop-align-center tablet-align-center mobile-align-center ast-product-gallery-layout-horizontal-slider ast-magnify-disabled${variableCls} ast-product-tabs-layout-horizontal ${productClasses(site, p, 'first')}`
  const short = p.short_description_html.trim() ? `<div class="woocommerce-product-details__short-description">\n\t${p.short_description_html.trim()}\n</div>\n` : ''
  const stock = p.type !== 'variable' && (p.manage_stock || p.stock_status === 'outofstock') ? stockHtml(p.stock_status !== 'outofstock', p.manage_stock ? p.stock_quantity : null) : ''
  const sale = num(p.sale_price) !== null && p.type !== 'variable' ? '<span class="onsale">特價！</span>\n' : ''
  const main = `${CONTENT_OPEN}
				<div id="primary" class="content-area primary">
				<main id="main" class="site-main">
					<div class="ast-woocommerce-container">
			${noticesHtml(ctx.notices)}<div id="product-${p.id}" class="${esc(cls)}">
	${sale}${galleryHtml(site, p)}
	<div class="summary entry-summary">
		<h1 class="product_title entry-title">${esc(p.name)}</h1><p class="price">${priceHtml(site, p)}</p>
${short}${stock}${addToCartHtml(site, p)}
	</div>
${tabsHtml(site, p)}
</div>
						</div> <!-- .ast-woocommerce-container -->
				</main> <!-- #main -->
			</div> <!-- #primary -->
${CONTENT_CLOSE}`
  const m = img(site, p.featured_media_id)
  const seo = fromStored(p.seo, { title: `${p.name} - ${SITE_NAME}`, canonical: productLink(p), ogType: 'product', image: m?.url, description: stripTags(p.short_description_html).trim() || undefined })
  return { status: 200, kind: p.type === 'variable' ? 'product_variable' : 'product', legacyPath: productLink(p), main, seo }
}

/** WooCommerce product-categories block list (off-canvas filter), live counts. */
export function productCategoriesList(site: Site): string {
  const vis = new Set(visibleProducts(site).map((p) => p.id))
  const cats = site.terms
    .filter((t) => t.taxonomy === 'product_cat' && !t.parent_id)
    .map((t) => ({ t, n: (site.termObjs.get(t.id) || []).filter((id) => vis.has(id)).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => (a.t.name < b.t.name ? -1 : a.t.name > b.t.name ? 1 : 0))
  return `<ul class="wc-block-product-categories-list wc-block-product-categories-list--depth-0">${cats
    .map(
      ({ t, n }) => `				<li class="wc-block-product-categories-list-item">					<a style="" href="${esc(termLink(t))}"><span class="wc-block-product-categories-list-item__name">${esc(t.name)}</span></a><span class="wc-block-product-categories-list-item-count"><span aria-hidden="true">${n}</span><span class="screen-reader-text">${n} 個產品</span></span>				</li>`,
    )
    .join('')}</ul>`
}

/** Re-render WooCommerce [products] shortcode loops stored in page content (REST rendering lacked Astra's loop markup). */
export function rerenderProductLoops(site: Site, html: string): string {
  return html.replace(/<ul class="products columns-(\d+)">([\s\S]*?)<\/ul>/g, (all, cols: string, inner: string) => {
    const ids = [...inner.matchAll(/<li class="[^"]*\bpost-(\d+)\b/g)].map((m) => Number(m[1]))
    const items = ids.map((id) => site.productById.get(id)).filter((p): p is Product => !!p && p.status === 'publish')
    if (!ids.length) return all
    return `<ul class="products columns-${cols}">\n${items.map((p, i) => loopItem(site, p, i, Number(cols) || 3, true)).join('')}</ul>`
  })
}
