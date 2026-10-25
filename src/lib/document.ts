/** Assemble a full HTML document: captured head + SEO, Astra header chrome, rendered #content, captured footer. */
import type { CartView } from './cart'
import { legacyRecord, renderHead, renderPre, renderSuf, type Chrome } from './legacy'
import { responsiveImages } from './images'
import { renderSeo } from './seo'
import type { Site } from './site'
import { esc, money } from './util'
import { trackingEnabled } from './tracking'
import { stampWpformsTokens } from './wpforms-token'
import type { View } from './views/common'
import { productCategoriesList } from './views/shop'

export function miniCartHtml(cart: CartView | null): string {
  if (!cart || !cart.lines.length) return '\n\n\t<p class="woocommerce-mini-cart__empty-message">購物車內沒有任何商品。</p>\n\n\n'
  return `

	<ul class="woocommerce-mini-cart cart_list product_list_widget ">
		${cart.lines
      .map(
        (l) => `<li class="woocommerce-mini-cart-item mini_cart_item">
					<a role="button" href="/cart/?remove_item=${l.id}" class="remove remove_from_cart_button" aria-label="從購物車移除 ${esc(l.name)}" data-product_id="${l.product.id}" data-cart_item_key="${l.id}" data-product_sku="${esc(l.product.sku)}" data-success_message="「${esc(l.name)}」已從您的購物車移除">&times;</a>											<a href="${esc(l.link)}">
							${l.image ? `<img width="600" height="450" src="${esc(l.image)}" class="attachment-woocommerce_thumbnail size-woocommerce_thumbnail" alt="${esc(l.name)}" decoding="async" style="aspect-ratio:4/3;object-fit:cover" />` : ''}${esc(l.name)}						</a>
										<span class="quantity">${l.quantity} &times; ${money(l.unit)}</span>					</li>`,
      )
      .join('\n')}
			</ul>

	<p class="woocommerce-mini-cart__total total">
		<strong>小計：</strong> ${money(cart.subtotal)}	</p>


	<p class="woocommerce-mini-cart__buttons buttons"><a href="/cart/" class="button wc-forward">查看購物車</a><a href="/checkout/" class="button checkout wc-forward">結帳</a></p>



`
}

function bodyClassFor(view: View, recPath: string, captured: string, exact: boolean): string {
  if (view.bodyClass) return view.bodyClass
  if (exact || !view.objectId) return captured
  void recPath
  // a template page of the same kind: swap the object ids in the captured body class
  return captured.replace(/\b(postid|page-id|elementor-page|term)-\d+/g, `$1-${view.objectId}`)
}

export function renderDocument(site: Site, view: View, cart: CartView | null, path: string): string {
  const rec = legacyRecord(view.legacyPath, view.kind)
  const exact = legacyRecord(view.legacyPath, '__none__') === rec
  const chrome: Chrome = {
    menus: {
      primary: site.menus.get('primary') || [],
      secondary: site.menus.get('secondary_menu') || [],
      mobile: site.menus.get('mobile_menu') || [],
    },
    currentPath: path,
    cartCount: cart?.count || 0,
    cartTotalHtml: money(cart?.total || 0),
    miniCartHtml: miniCartHtml(cart),
  }
  let bodyClass = bodyClassFor(view, view.legacyPath, rec.bodyClass, exact)
  if (view.status === 404 && !/error404/.test(bodyClass)) bodyClass = rec.bodyClass
  const head = renderHead(rec)
  // SEO block goes right after <meta charset>/<meta viewport> like Rank Math prints it
  const seo = renderSeo(view.seo)
  const headHtml = head.replace(/(<meta name="viewport"[^>]*>)/, `$1\n\t<link rel="profile" href="https://gmpg.org/xfn/11">\n${seo}`)
  const headFinal = headHtml === head ? '<meta charset="UTF-8">\n' + seo + '\n' + head : headHtml
  let suf = renderSuf(rec, chrome)
  suf = suf.replace(/<ul class="wc-block-product-categories-list wc-block-product-categories-list--depth-0">[\s\S]*?<\/ul>/, productCategoriesList(site))
  const doc = applySiteSettings(site, `<!DOCTYPE html>
<html lang="zh-TW" prefix="og: https://ogp.me/ns#">
<head>
${headFinal}<link rel='stylesheet' id='kc-site-css' href='/kc/kc.css?v=1' media='all' />
${view.headExtra || ''}
</head>

<body ${rec.bodyAttrs} class="${esc(bodyClass)}">
${renderPre(rec, chrome)}
${stampWpformsTokens(view.main)}
${suf}
${view.footExtra || ''}
</body>
</html>
`)
  // header chrome (logo) stays eager; the first image inside #content is the above-the-fold image
  const contentAt = doc.indexOf('<div id="content"')
  return responsiveImages(site, doc, { eagerBefore: contentAt >= 0 ? contentAt : 0 })
}

/**
 * Values edited in /admin/settings that live inside the captured Astra chrome / SEO blocks: the captured
 * originals are swapped for the current values (site name, logo, phone, Google tag ids), and the
 * custom head/body code is appended.
 */
export function applySiteSettings(site: Site, html: string): string {
  const s = site.settings
  const swap = (from: unknown, to: unknown) => {
    if (typeof from === 'string' && typeof to === 'string' && from && to && from !== to) html = html.split(from).join(to)
  }
  swap(s.site_name_original, s.site_name)
  swap(s.site_logo?.original_url, s.site_logo?.url)
  swap(s.contact_phone_original, s.contact_phone)
  if (typeof s.contact_phone_original === 'string' && typeof s.contact_phone === 'string') {
    swap('tel:' + s.contact_phone_original.replace(/\D/g, ''), 'tel:' + s.contact_phone.replace(/\D/g, ''))
  }
  const t = s.tracking || {}
  const o = t.original || {}
  swap(o.gtm, t.gtm?.[0])
  swap(o.google_tag, t.google_tag?.ids?.[0])
  swap(o.google_ads, t.google_ads?.ids?.[0])
  swap(o.adsense, t.adsense?.publisher_id)
  const c = s.tracking_custom || {}
  if (c.enabled !== false && trackingEnabled()) {
    if (c.head_html) html = html.replace('</head>', `${c.head_html}\n</head>`)
    if (c.body_html) html = html.replace(/<\/body>\s*<\/html>\s*$/, `${c.body_html}\n</body>\n</html>\n`)
  }
  return html
}
