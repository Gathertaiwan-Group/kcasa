/* eslint-disable @typescript-eslint/no-explicit-any */
/** Cart, checkout and order-received pages (WooCommerce classic templates as rendered by Astra). */
import type { CartView } from '../cart'
import { svc } from '../sb'
import type { Post } from '../site'
import { esc, money } from '../util'
import { noticesHtml, type Ctx, type View } from './common'
import { pageMain, seoFor } from './content'

import { CHEQUE, GATEWAY_ID, paymentMethods, type PaymentMethod } from '../newebpay'

/** default (first) payment method — old site woocommerce_cheque_settings */
export const PAYMENT = CHEQUE

function lineAttrs(l: CartView['lines'][number]): string {
  const entries = Object.entries(l.attributes || {}).filter(([, v]) => v)
  if (!entries.length) return ''
  return `<dl class="variation">${entries.map(([k, v]) => `<dt class="variation-${esc(k)}">${esc(k)}:</dt><dd class="variation-${esc(k)}"><p>${esc(v)}</p></dd>`).join('')}</dl>`
}

function shippingRows(cart: CartView, inCart: boolean): string {
  const opts = cart.shipping
  const items = opts
    .map((o) => {
      const id = `shipping_method_0_${o.id.replace(/[^a-z0-9]/gi, '')}`
      const checked = cart.chosenShipping?.id === o.id ? " checked='checked'" : ''
      return `<li>
								<input type="radio" name="shipping_method[0]" data-index="0" id="${id}" value="${esc(o.id)}" class="shipping_method" ${checked} /><label for="${id}">${esc(o.label)}${o.cost > 0 ? `: ${money(o.cost)}` : ''}</label>							</li>`
    })
    .join('\n')
  return `<tr class="woocommerce-shipping-totals shipping">
	<th>運送方式</th>
	<td data-title="運送方式">
					<ul id="shipping_method" class="woocommerce-shipping-methods">
							${items}
					</ul>
		${
      inCart
        ? `<p class="woocommerce-shipping-destination">
					運送選項會在結帳時更新。				</p>

<form class="woocommerce-shipping-calculator" action="/cart/" method="post">

	<a href="#" class="shipping-calculator-button" aria-expanded="false" aria-controls="shipping-calculator-form" role="button">計算運費</a>
	<section class="shipping-calculator-form" id="shipping-calculator-form" style="display:none;">
		<p class="form-row form-row-wide" id="calc_shipping_country_field"><label for="calc_shipping_country" class="screen-reader-text">國家/地區:</label><select name="calc_shipping_country" id="calc_shipping_country" class="country_to_state country_select" rel="calc_shipping_state"><option value="TW" selected='selected'>台灣</option></select></p>
		<p class="form-row form-row-wide" id="calc_shipping_state_field"><label for="calc_shipping_state" class="screen-reader-text">縣 / 市:</label><input type="text" class="input-text" value="" placeholder="縣 / 市" name="calc_shipping_state" id="calc_shipping_state" /></p>
		<p class="form-row form-row-wide" id="calc_shipping_city_field"><label for="calc_shipping_city" class="screen-reader-text">鄉鎮市:</label><input type="text" class="input-text" value="" placeholder="鄉鎮市" name="calc_shipping_city" id="calc_shipping_city" /></p>
		<p class="form-row form-row-wide" id="calc_shipping_postcode_field"><label for="calc_shipping_postcode" class="screen-reader-text">郵遞區號:</label><input type="text" class="input-text" value="" placeholder="郵遞區號" name="calc_shipping_postcode" id="calc_shipping_postcode" /></p>
		<p><button type="submit" name="calc_shipping" value="1" class="button">更新</button></p>
	</section>
</form>
`
        : ''
    }
			</td>
</tr>`
}

function couponRows(cart: CartView, inCart: boolean): string {
  return cart.coupons
    .map(
      (c) => `<tr class="cart-discount coupon-${esc(c.code.toLowerCase())}">
					<th>折價券: ${esc(c.code.toLowerCase())}</th>
					<td data-title="折價券: ${esc(c.code.toLowerCase())}">-${money(c.amount)} <a href="${inCart ? '/cart/' : '/checkout/'}?remove_coupon=${encodeURIComponent(c.code)}" class="woocommerce-remove-coupon" data-coupon="${esc(c.code)}">[移除]</a></td>
				</tr>`,
    )
    .join('\n')
}

function emptyCart(): string {
  return `<div class="woocommerce">${'' /* notices inserted by caller */}<div class="wc-empty-cart-message">
	<div class="cart-empty woocommerce-info" role="status">
		您的購物車裡還沒有任何商品。	</div>
</div>	<p class="return-to-shop">
		<a class="button wc-backward" href="/shop/">
			回到商店		</a>
	</p>
</div>`
}

export function cartView(page: Post, ctx: Ctx, cart: CartView): View {
  let inner: string
  if (!cart.lines.length) {
    inner = emptyCart().replace('<div class="woocommerce">', `<div class="woocommerce">${noticesHtml(ctx.notices)}`)
  } else {
    const rows = cart.lines
      .map(
        (l) => `			<tr class="woocommerce-cart-form__cart-item cart_item">

						<td class="product-remove">
							<a role="button" href="/cart/?remove_item=${l.id}" class="remove" aria-label="從購物車移除 ${esc(l.name)}" data-product_id="${l.product.id}" data-product_sku="${esc(l.variation?.sku || l.product.sku)}">&times;</a>						</td>

						<td class="product-thumbnail">
						<a href="${esc(l.link)}">${l.image ? `<img width="600" height="450" src="${esc(l.image)}" class="attachment-woocommerce_thumbnail size-woocommerce_thumbnail" alt="${esc(l.name)}" decoding="async" style="aspect-ratio:4/3;object-fit:cover" />` : ''}</a>						</td>

						<td scope="row" role="rowheader" class="product-name" data-title="商品">
						<a href="${esc(l.link)}">${esc(l.name)}</a>${lineAttrs(l)}${l.discountNote ? `<p class="kc-qty-discount-note">${esc(l.discountNote)}</p>` : ''}						</td>

						<td class="product-price" data-title="價格">
							${l.regularUnit > l.unit ? `<del>${money(l.regularUnit)}</del> <ins>${money(l.unit)}</ins>` : money(l.unit)}						</td>

						<td class="product-quantity" data-title="數量">
						<div class="quantity">
		<label class="screen-reader-text" for="quantity_${l.id}">${esc(l.name)} 數量</label>
	<input
		type="number"
				id="quantity_${l.id}"
		class="input-text qty text"
		name="cart[${l.id}][qty]"
		value="${l.quantity}"
		aria-label="商品數量"
				min="0"
							step="1"
			placeholder=""
			inputmode="numeric"
			autocomplete="off"
			/>
	</div>
							</td>

						<td class="product-subtotal" data-title="小計">
							${money(l.lineSubtotal)}						</td>
					</tr>`,
      )
      .join('\n')
    inner = `<div class="woocommerce">${noticesHtml(ctx.notices)}
<form class="woocommerce-cart-form" action="/cart/" method="post">
		<table class="shop_table shop_table_responsive cart woocommerce-cart-form__contents" cellspacing="0">
		<thead>
			<tr>
				<th class="product-remove"><span class="screen-reader-text">移除項目</span></th>
				<th class="product-thumbnail"><span class="screen-reader-text">縮圖</span></th>
				<th scope="col" class="product-name">商品</th>
				<th scope="col" class="product-price">價格</th>
				<th scope="col" class="product-quantity">數量</th>
				<th scope="col" class="product-subtotal">小計</th>
			</tr>
		</thead>
		<tbody>
${rows}

			<tr>
				<td colspan="6" class="actions">

											<div class="coupon">
							<label for="coupon_code" class="screen-reader-text">折價券:</label> <input type="text" name="coupon_code" class="input-text" id="coupon_code" value="" placeholder="折價券" /> <button type="submit" class="button" name="apply_coupon" value="使用折價券">使用折價券</button>
													</div>

					<button type="submit" class="button" name="update_cart" value="更新購物車">更新購物車</button>

									</td>
			</tr>

					</tbody>
	</table>
	</form>

<div class="cart-collaterals">
	<div class="cart_totals ">


	<h2>購物車總計</h2>

	<table cellspacing="0" class="shop_table shop_table_responsive">

		<tr class="cart-subtotal">
			<th>小計</th>
			<td data-title="小計">${money(cart.subtotal)}</td>
		</tr>

		${couponRows(cart, true)}
		${shippingRows(cart, true)}

		<tr class="order-total">
			<th>總計</th>
			<td data-title="總計"><strong>${money(cart.total)}</strong> </td>
		</tr>


	</table>

	<div class="wc-proceed-to-checkout">

<a href="/checkout/" class="checkout-button button alt wc-forward">
	前往結帳</a>
	</div>


</div>
</div>

</div>`
  }
  return { status: 200, kind: 'cart', legacyPath: '/cart/', main: pageMain(page, ctx, inner), seo: seoFor(page), cache: 'private', footExtra: '<script src="/kc/kc-shop.js" defer></script>' }
}

type Field = { key: string; label: string; required?: boolean; type?: string; cls?: string; placeholder?: string; autocomplete?: string; hidden?: boolean }

export const BILLING_FIELDS: Field[] = [
  { key: 'first_name', label: '名字', required: true, cls: 'form-row-first', autocomplete: 'given-name' },
  { key: 'last_name', label: '姓氏', required: true, cls: 'form-row-last', autocomplete: 'family-name' },
  { key: 'company', label: '公司名稱', cls: 'form-row-wide', autocomplete: 'organization' },
  { key: 'address_1', label: '街道地址', required: true, cls: 'form-row-wide address-field', placeholder: '門牌號碼與街道名稱', autocomplete: 'address-line1' },
  { key: 'address_2', label: '公寓、套房、單位等 (選填)', cls: 'form-row-wide address-field', placeholder: '公寓、套房、單元等(選填)', autocomplete: 'address-line2' },
  { key: 'city', label: '鄉鎮市', required: true, cls: 'form-row-wide address-field kc-tw-city', autocomplete: 'address-level2' },
  { key: 'state', label: '縣 / 市', required: true, cls: 'form-row-wide address-field kc-tw-state', autocomplete: 'address-level1' },
  { key: 'postcode', label: '郵遞區號', required: true, cls: 'form-row-wide address-field kc-tw-postcode', placeholder: '郵遞區號', autocomplete: 'postal-code' },
  { key: 'phone', label: '聯絡電話', required: true, type: 'tel', cls: 'form-row-wide', autocomplete: 'tel' },
  { key: 'email', label: '電子郵件地址', required: true, type: 'email', cls: 'form-row-wide', autocomplete: 'email' },
]
export const SHIPPING_FIELDS: Field[] = BILLING_FIELDS.filter((f) => f.key !== 'phone' && f.key !== 'email')

export function fieldHtml(prefix: string, f: Field, value: string): string {
  const name = `${prefix}_${f.key}`
  const req = f.required ? '&nbsp;<abbr class="required" title="必要">*</abbr>' : '&nbsp;<span class="optional">(選填)</span>'
  const label = f.key === 'address_2' ? `<label for="${name}" class="screen-reader-text">${esc(f.label)}</label>` : `<label for="${name}" class="">${esc(f.label)}${f.key === 'address_2' ? '' : f.required ? req : ''}</label>`
  return `<p class="form-row ${f.cls || 'form-row-wide'}${f.required ? ' validate-required' : ''}${f.type === 'email' ? ' validate-email' : ''}${f.type === 'tel' ? ' validate-phone' : ''}" id="${name}_field" data-priority="">${label}<span class="woocommerce-input-wrapper"><input type="${f.type || 'text'}" class="input-text " name="${name}" id="${name}" placeholder="${esc(f.placeholder || '')}"  value="${esc(value)}" ${f.autocomplete ? `autocomplete="${f.autocomplete}"` : ''} ${f.required ? 'aria-required="true"' : ''} /></span></p>`
}

function paymentMethodsHtml(methods: PaymentMethod[], chosen: string): string {
  const sel = methods.some((m) => m.id === chosen) ? chosen : methods[0].id
  return methods
    .map(
      (m) => `			<li class="wc_payment_method payment_method_${m.id}">
	<input id="payment_method_${m.id}" type="radio" class="input-radio" name="payment_method" value="${m.id}" ${m.id === sel ? "checked='checked'" : ''} data-order_button_text="" />

	<label for="payment_method_${m.id}">
		${esc(m.title)} 	</label>
			<div class="payment_box payment_method_${m.id}" ${m.id === sel ? '' : 'style="display:none;"'}>
			<p>${esc(m.description)}</p>
		</div>
	</li>`,
    )
    .join('\n')
}

export function checkoutView(page: Post, ctx: Ctx, cart: CartView, prefill: Record<string, string>): View {
  if (!cart.lines.length) {
    const v = cartView(page, ctx, cart)
    return { ...v, kind: 'checkout', legacyPath: '/checkout/' }
  }
  const val = (k: string) => prefill[k] || ''
  const review = `<table class="shop_table woocommerce-checkout-review-order-table">
	<thead>
		<tr>
			<th class="product-name">商品</th>
			<th class="product-total">小計</th>
		</tr>
	</thead>
	<tbody>
		${cart.lines
      .map(
        (l) => `				<tr class="cart_item">
					<td class="product-name">
						${esc(l.name)}&nbsp;						 <strong class="product-quantity">&times;&nbsp;${l.quantity}</strong>											${lineAttrs(l)}</td>
					<td class="product-total">
						${money(l.lineSubtotal)}					</td>
				</tr>`,
      )
      .join('\n')}
	</tbody>
	<tfoot>

		<tr class="cart-subtotal">
			<th>小計</th>
			<td>${money(cart.subtotal)}</td>
		</tr>

		${couponRows(cart, false)}
		${shippingRows(cart, false)}

		<tr class="order-total">
			<th>總計</th>
			<td><strong>${money(cart.total)}</strong> </td>
		</tr>

	</tfoot>
</table>`
  const inner = `<div class="woocommerce">${noticesHtml(ctx.notices)}<div class="woocommerce-form-coupon-toggle">

	<div class="woocommerce-info" role="status">
		有折價券嗎? <a href="#" class="showcoupon" role="button" aria-label="輸入您的優惠券代碼" aria-controls="woocommerce-checkout-form-coupon" aria-expanded="false">按此輸入您的折價碼</a>	</div>
</div>

<form class="checkout_coupon woocommerce-form-coupon" method="post" style="display:none" id="woocommerce-checkout-form-coupon" action="/checkout/">

	<p class="form-row-first">
		<label for="coupon_code" class="screen-reader-text">折價券:</label>
		<input type="text" name="coupon_code" class="input-text" placeholder="折價券代碼" id="coupon_code" value="" />
	</p>

	<p class="form-row-last">
		<button type="submit" class="button" name="apply_coupon" value="使用折價券">使用折價券</button>
	</p>

	<div class="clear"></div>
</form>
<div class="woocommerce-notices-wrapper"></div>
<form name="checkout" method="post" class="checkout woocommerce-checkout" action="/checkout/" enctype="multipart/form-data" aria-label="結帳" novalidate="novalidate">
<input type="hidden" name="kc_checkout" value="1" />
		<div class="col2-set" id="customer_details">
			<div class="col-1">
				<div class="woocommerce-billing-fields">

		<h3>帳單資訊</h3>


	<div class="woocommerce-billing-fields__field-wrapper">
		${BILLING_FIELDS.map((f) => fieldHtml('billing', f, val('billing_' + f.key))).join('')}
		<input type="hidden" name="billing_country" value="TW" />
	</div>

	</div>

			</div>

			<div class="col-2">
				<div class="woocommerce-shipping-fields">

		<h3 id="ship-to-different-address">
			<label class="woocommerce-form__label woocommerce-form__label-for-checkbox checkbox">
				<input id="ship-to-different-address-checkbox" class="woocommerce-form__input woocommerce-form__input-checkbox input-checkbox"  type="checkbox" name="ship_to_different_address" value="1" ${val('ship_to_different_address') ? 'checked' : ''} /> <span>運送到不同的地址?</span>
			</label>
		</h3>

		<div class="shipping_address" ${val('ship_to_different_address') ? '' : 'style="display:none"'}>


			<div class="woocommerce-shipping-fields__field-wrapper">
				${SHIPPING_FIELDS.map((f) => fieldHtml('shipping', f, val('shipping_' + f.key))).join('')}
				<input type="hidden" name="shipping_country" value="TW" />
			</div>


		</div>

	</div>
<div class="woocommerce-additional-fields">



		<div class="woocommerce-additional-fields__field-wrapper">
							<p class="form-row notes" id="order_comments_field" data-priority=""><label for="order_comments" class="">訂單備註&nbsp;<span class="optional">(選填)</span></label><span class="woocommerce-input-wrapper"><textarea name="order_comments" class="input-text " id="order_comments" placeholder="您的訂單的備註，例如: 運送時的特別註記。"  rows="2" cols="5">${esc(val('order_comments'))}</textarea></span></p>					</div>


	</div>
			</div>
		</div>




	<h3 id="order_review_heading">您的訂單</h3>


	<div id="order_review" class="woocommerce-checkout-review-order">
		${review}
<div id="payment" class="woocommerce-checkout-payment">
			<ul class="wc_payment_methods payment_methods methods">
${paymentMethodsHtml(paymentMethods(), val('payment_method'))}
		</ul>
		<div class="form-row place-order">
		<noscript>
			由於你的瀏覽器不支援 JavaScript，或是它已被停用，請在下單前務必按下<em>更新總計</em>按鈕。若沒有這樣做，你可能會被收取比上述金額更多的費用。			<br/><button type="submit" class="button alt" name="woocommerce_checkout_update_totals" value="更新總計">更新總計</button>
		</noscript>

			<div class="woocommerce-terms-and-conditions-wrapper">
		<div class="woocommerce-privacy-policy-text"><p>Your personal data will be used to process your order, support your experience throughout this website, and for other purposes described in our 隱私權政策.</p>
</div>
			</div>


		<button type="submit" class="button alt" name="woocommerce_checkout_place_order" id="place_order" value="下單購買" data-value="下單購買">下單購買</button>

			</div>
</div>
	</div>


</form>

</div>`
  return { status: 200, kind: 'checkout', legacyPath: '/checkout/', main: pageMain(page, ctx, inner), seo: seoFor(page), cache: 'private', footExtra: '<script src="/kc/kc-shop.js" defer></script>' }
}

export async function orderReceivedView(page: Post, ctx: Ctx, orderId: number, key: string): Promise<View | null> {
  const { data: o } = await svc().from('orders').select('*').eq('id', orderId).maybeSingle()
  if (!o || o.order_key !== key) return null
  const { data: items } = await svc().from('order_items').select('*').eq('order_id', orderId).order('id')
  const inner = `<div class="woocommerce">
	<div class="woocommerce-order">
	${orderDetailsHtml(o, items || [], true)}
	</div>
</div>`
  return { status: 200, kind: 'checkout', legacyPath: '/checkout/', main: pageMain({ ...page, title: '訂單已收到' }, ctx, inner), seo: { ...seoFor(page), title: '訂單已收到 - Kcasa 工富家飾' }, cache: 'private' }
}

function thankyouPaymentNote(o: any): string {
  if (o.payment_method !== GATEWAY_ID) return `<p>${esc(PAYMENT.description)}</p>`
  if (o.transaction_id || o.status === 'processing' || o.status === 'completed') return `<p class="kc-payment-status kc-paid">付款完成，感謝您的訂購！</p>`
  if (o.status === 'failed') return `<p class="woocommerce-notice woocommerce-notice--error woocommerce-thankyou-order-failed">很抱歉，您的信用卡付款未成功（銀行或藍新金流拒絕了交易），訂單無法處理。請重新下單購買。</p>`
  if (o.status === 'cancelled') return `<p class="woocommerce-notice woocommerce-notice--error">此訂單因逾時未付款已取消，請重新下單購買。</p>`
  return `<p class="kc-payment-status">付款結果確認中，請稍候重新整理本頁。若您尚未完成付款，<a href="/api/newebpay/pay/?order=${o.id}&amp;key=${encodeURIComponent(o.order_key)}">按此前往藍新金流付款</a>（訂單成立後 60 分鐘內有效）。</p>`
}

const STATUS_LABEL: Record<string, string> = { pending: '等待付款中', processing: '處理中', 'on-hold': '保留', completed: '完成', cancelled: '已取消', refunded: '已退費', failed: '失敗', 'checkout-draft': '草稿' }
export function statusLabel(s: string) {
  return STATUS_LABEL[s] || s
}

export function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Taipei' })
}

function addressHtml(a: any): string {
  if (!a) return ''
  const name = `${a.last_name || ''}${a.first_name || ''}`
  return [a.company, name, a.postcode ? `${a.postcode} ${a.state || ''}${a.city || ''}` : `${a.state || ''}${a.city || ''}`, a.address_1, a.address_2].filter(Boolean).map(esc).join('<br>')
}

export function orderDetailsHtml(o: any, items: any[], thankyou: boolean): string {
  const lines = items.filter((i) => i.item_type === 'line_item')
  const head = thankyou
    ? `<p class="woocommerce-notice woocommerce-notice--success woocommerce-thankyou-order-received">謝謝您，您的訂單已成功建立。</p>
			<ul class="woocommerce-order-overview woocommerce-thankyou-order-details order_details">
				<li class="woocommerce-order-overview__order order">
					訂單編號:					<strong>${esc(o.order_number || o.id)}</strong>
				</li>
				<li class="woocommerce-order-overview__date date">
					日期:					<strong>${fmtDate(o.created_at)}</strong>
				</li>
									<li class="woocommerce-order-overview__email email">
						電子郵件:						<strong>${esc(o.billing?.email || '')}</strong>
					</li>
				<li class="woocommerce-order-overview__total total">
					總計:					<strong>${money(o.total)}</strong>
				</li>
									<li class="woocommerce-order-overview__payment-method method">
						付款方式:						<strong>${esc(o.payment_method_title)}</strong>
					</li>
			</ul>
		${thankyouPaymentNote(o)}`
    : `<p>訂單 #<mark class="order-number">${esc(o.order_number || o.id)}</mark> 已於 <mark class="order-date">${fmtDate(o.created_at)}</mark> 下單，目前狀態為 <mark class="order-status">${statusLabel(o.status)}</mark>。</p>`
  return `${head}
	<section class="woocommerce-order-details">
	<h2 class="woocommerce-order-details__title">訂單詳細資料</h2>
	<table class="woocommerce-table woocommerce-table--order-details shop_table order_details">
		<thead>
			<tr>
				<th class="woocommerce-table__product-name product-name">商品</th>
				<th class="woocommerce-table__product-table product-total">小計</th>
			</tr>
		</thead>
		<tbody>
			${lines
        .map(
          (i) => `<tr class="woocommerce-table__line-item order_item">
	<td class="woocommerce-table__product-name product-name">
		${esc(i.name)} <strong class="product-quantity">&times;&nbsp;${i.quantity}</strong>${
          i.meta?.attributes && Object.keys(i.meta.attributes).length
            ? `<ul class="wc-item-meta">${Object.entries(i.meta.attributes)
                .map(([k, v]) => `<li><strong class="wc-item-meta-label">${esc(k)}:</strong> <p>${esc(v)}</p></li>`)
                .join('')}</ul>`
            : ''
        }	</td>
	<td class="woocommerce-table__product-total product-total">
		${money(i.subtotal)}	</td>
</tr>`,
        )
        .join('\n')}
		</tbody>
		<tfoot>
			<tr><th scope="row">小計:</th><td>${money(o.subtotal)}</td></tr>
			${Number(o.discount_total) > 0 ? `<tr><th scope="row">折扣:</th><td>-${money(o.discount_total)}</td></tr>` : ''}
			<tr><th scope="row">運送方式:</th><td>${esc(o.meta?.shipping_title || '')}${Number(o.shipping_total) > 0 ? ` ${money(o.shipping_total)}` : ''}</td></tr>
			<tr><th scope="row">付款方式:</th><td>${esc(o.payment_method_title)}</td></tr>
			<tr><th scope="row">總計:</th><td>${money(o.total)}</td></tr>
			${o.customer_note ? `<tr><th>備註:</th><td>${esc(o.customer_note)}</td></tr>` : ''}
		</tfoot>
	</table>
	</section>
	<section class="woocommerce-customer-details">
	<section class="woocommerce-columns woocommerce-columns--2 woocommerce-columns--addresses col2-set addresses">
		<div class="woocommerce-column woocommerce-column--1 woocommerce-column--billing-address col-1">
	<h2 class="woocommerce-column__title">帳單地址</h2>
	<address>
		${addressHtml(o.billing)}
					<p class="woocommerce-customer-details--phone">${esc(o.billing?.phone || '')}</p>
					<p class="woocommerce-customer-details--email">${esc(o.billing?.email || '')}</p>
	</address>
		</div><!-- /.col-1 -->
		<div class="woocommerce-column woocommerce-column--2 woocommerce-column--shipping-address col-2">
			<h2 class="woocommerce-column__title">運送地址</h2>
			<address>
				${addressHtml(o.shipping)}
			</address>
		</div><!-- /.col-2 -->
	</section><!-- /.col2-set -->
	</section>`
}
