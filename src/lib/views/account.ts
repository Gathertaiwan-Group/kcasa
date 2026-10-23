/* eslint-disable @typescript-eslint/no-explicit-any */
/** WooCommerce "My account" (Supabase Auth): login / register / lost password, dashboard, orders, addresses, account details. */
import type { SessionUser } from '../auth'
import { svc } from '../sb'
import type { Post } from '../site'
import { esc, money } from '../util'
import { BILLING_FIELDS, SHIPPING_FIELDS, fieldHtml, fmtDate, orderDetailsHtml, statusLabel } from './checkout'
import { noticesHtml, type Ctx, type View } from './common'
import { pageMain, seoFor } from './content'

function wrap(page: Post, ctx: Ctx, inner: string, title?: string): View {
  const p = title ? { ...page, title } : page
  return { status: 200, kind: 'account', legacyPath: '/my-account/', main: pageMain(p, ctx, `<div class="woocommerce">${inner}</div>`), seo: seoFor(page), cache: 'private' }
}

export function loginView(page: Post, ctx: Ctx): View {
  const inner = `${noticesHtml(ctx.notices)}
		<h2>登入</h2>
		<form class="woocommerce-form woocommerce-form-login login" method="post" action="/my-account/" novalidate>
			<input type="hidden" name="kc_action" value="login" />
			<p class="woocommerce-form-row woocommerce-form-row--wide form-row form-row-wide">
				<label for="username">使用者名稱 或 電子郵件&nbsp;<span class="required" aria-hidden="true">*</span><span class="screen-reader-text">必填</span></label>
				<input type="text" class="woocommerce-Input woocommerce-Input--text input-text" name="username" id="username" autocomplete="username" value="" required aria-required="true" />			</p>
			<p class="woocommerce-form-row woocommerce-form-row--wide form-row form-row-wide">
				<label for="password">密碼&nbsp;<span class="required" aria-hidden="true">*</span><span class="screen-reader-text">必填</span></label>
				<input class="woocommerce-Input woocommerce-Input--text input-text" type="password" name="password" id="password" autocomplete="current-password" required aria-required="true" />
			</p>
			<p class="form-row">
				<label class="woocommerce-form__label woocommerce-form__label-for-checkbox woocommerce-form-login__rememberme">
					<input class="woocommerce-form__input woocommerce-form__input-checkbox" name="rememberme" type="checkbox" id="rememberme" value="forever" /> <span>保持登入</span>
				</label>
				<button type="submit" class="woocommerce-button button woocommerce-form-login__submit" name="login" value="登入">登入</button>
			</p>
			<p class="woocommerce-LostPassword lost_password">
				<a href="/my-account/lost-password/">忘記密碼？</a>
			</p>
			<p class="woocommerce-register-link">
				還沒有帳號嗎？ <a href="/my-account/?action=register">註冊新帳號</a>
			</p>
		</form>
`
  return wrap(page, ctx, inner)
}

export function registerView(page: Post, ctx: Ctx): View {
  const inner = `${noticesHtml(ctx.notices)}
		<h2>註冊</h2>
		<form method="post" class="woocommerce-form woocommerce-form-register register" action="/my-account/?action=register">
			<input type="hidden" name="kc_action" value="register" />
			<p class="woocommerce-form-row woocommerce-form-row--wide form-row form-row-wide">
				<label for="reg_email">電子郵件地址&nbsp;<span class="required" aria-hidden="true">*</span><span class="screen-reader-text">必填</span></label>
				<input type="email" class="woocommerce-Input woocommerce-Input--text input-text" name="email" id="reg_email" autocomplete="email" value="" required aria-required="true" />			</p>
			<p class="woocommerce-form-row woocommerce-form-row--wide form-row form-row-wide">
				<label for="reg_password">密碼&nbsp;<span class="required" aria-hidden="true">*</span><span class="screen-reader-text">必填</span></label>
				<input type="password" class="woocommerce-Input woocommerce-Input--text input-text" name="password" id="reg_password" autocomplete="new-password" required aria-required="true" minlength="8" />
			</p>
			<div class="woocommerce-privacy-policy-text"><p>您的個人資料將用於處理訂單、支援您在本網站的使用體驗，以及用於本站隱私權政策中說明的其他用途。</p></div>
			<p class="woocommerce-form-row form-row">
				<button type="submit" class="woocommerce-Button woocommerce-button button woocommerce-form-register__submit" name="register" value="註冊">註冊</button>
			</p>
			<p><a href="/my-account/">已經有帳號了？登入</a></p>
		</form>
`
  return wrap(page, ctx, inner)
}

export function lostPasswordView(page: Post, ctx: Ctx, sent: boolean): View {
  const inner = sent
    ? `${noticesHtml([{ type: 'info', html: '密碼重設電子郵件已寄出。' }])}<p>重設密碼的電子郵件已寄送至你帳號的電子郵件地址，但它可能需要幾分鐘的時間才會顯示在你的收件匣中。請至少等待10分鐘，然後再嘗試另一次重設。</p>`
    : `${noticesHtml(ctx.notices)}
<form method="post" class="woocommerce-ResetPassword lost_reset_password" action="/my-account/lost-password/">
	<input type="hidden" name="kc_action" value="lost_password" />
	<p>忘記密碼了嗎？請輸入你的電子郵件地址。你會收到一封電子郵件，內含建立新密碼的連結。</p>
	<p class="woocommerce-form-row woocommerce-form-row--first form-row form-row-first">
		<label for="user_login">電子郵件&nbsp;<span class="required" aria-hidden="true">*</span><span class="screen-reader-text">必填</span></label>
		<input class="woocommerce-Input woocommerce-Input--text input-text" type="text" name="user_login" id="user_login" autocomplete="username" required aria-required="true" />
	</p>
	<div class="clear"></div>
	<p class="woocommerce-form-row form-row">
		<button type="submit" class="woocommerce-Button button" value="重設密碼">重設密碼</button>
	</p>
</form>`
  return wrap(page, ctx, inner, '忘記密碼')
}

const NAV: [string, string][] = [
  ['dashboard', '控制台'],
  ['orders', '訂單'],
  ['edit-address', '地址'],
  ['edit-account', '帳號詳細資料'],
  ['customer-logout', '登出'],
]

function navHtml(active: string): string {
  return `<nav class="woocommerce-MyAccount-navigation" aria-label="帳號頁面">
	<ul>
${NAV.map(([k, l]) => `					<li class="woocommerce-MyAccount-navigation-link woocommerce-MyAccount-navigation-link--${k}${k === active ? ' is-active' : ''}">
				<a href="/my-account/${k === 'dashboard' ? '' : k + '/'}" ${k === active ? 'aria-current="page"' : ''}>${l}</a>
			</li>`).join('\n')}
			</ul>
</nav>`
}

function accountShell(page: Post, ctx: Ctx, active: string, content: string, title?: string): View {
  return wrap(page, ctx, `${navHtml(active)}<div class="woocommerce-MyAccount-content">
	${noticesHtml(ctx.notices)}${content}
</div>`, title)
}

export async function accountView(page: Post, ctx: Ctx, user: SessionUser, customer: any, endpoint: string, arg: string): Promise<View | null> {
  const name = customer?.display_name || user.email
  if (endpoint === '' || endpoint === 'dashboard') {
    return accountShell(
      page,
      ctx,
      'dashboard',
      `<p>
	哈囉 <strong>${esc(name)}</strong> (不是 <strong>${esc(name)}</strong>？<a href="/my-account/customer-logout/">登出</a>)</p>

<p>
	從帳號控制台，你可以檢視<a href="/my-account/orders/">近期訂單</a>、管理<a href="/my-account/edit-address/">收貨地址和帳單地址</a>，以及<a href="/my-account/edit-account/">編輯密碼和帳號詳細資料</a>。</p>
`,
    )
  }
  if (endpoint === 'orders') {
    const { data: orders } = await svc().from('orders').select('id,order_number,status,total,created_at,order_key').eq('customer_id', customer.id).neq('status', 'trash').order('created_at', { ascending: false }).limit(100)
    const content = orders?.length
      ? `<table class="woocommerce-orders-table woocommerce-MyAccount-orders shop_table shop_table_responsive my_account_orders account-orders-table">
		<thead>
			<tr>
				<th class="woocommerce-orders-table__header woocommerce-orders-table__header-order-number"><span class="nobr">訂單</span></th>
				<th class="woocommerce-orders-table__header woocommerce-orders-table__header-order-date"><span class="nobr">日期</span></th>
				<th class="woocommerce-orders-table__header woocommerce-orders-table__header-order-status"><span class="nobr">狀態</span></th>
				<th class="woocommerce-orders-table__header woocommerce-orders-table__header-order-total"><span class="nobr">總計</span></th>
				<th class="woocommerce-orders-table__header woocommerce-orders-table__header-order-actions"><span class="nobr">動作</span></th>
			</tr>
		</thead>
		<tbody>
${orders
  .map(
    (o) => `				<tr class="woocommerce-orders-table__row woocommerce-orders-table__row--status-${esc(o.status)} order">
					<th class="woocommerce-orders-table__cell woocommerce-orders-table__cell-order-number" data-title="訂單" scope="row"><a href="/my-account/view-order/${o.id}/">#${esc(o.order_number || o.id)}</a></th>
					<td class="woocommerce-orders-table__cell woocommerce-orders-table__cell-order-date" data-title="日期"><time datetime="${esc(o.created_at)}">${fmtDate(o.created_at)}</time></td>
					<td class="woocommerce-orders-table__cell woocommerce-orders-table__cell-order-status" data-title="狀態">${statusLabel(o.status)}</td>
					<td class="woocommerce-orders-table__cell woocommerce-orders-table__cell-order-total" data-title="總計">${money(o.total)}</td>
					<td class="woocommerce-orders-table__cell woocommerce-orders-table__cell-order-actions" data-title="動作"><a href="/my-account/view-order/${o.id}/" class="woocommerce-button button view">檢視</a></td>
				</tr>`,
  )
  .join('\n')}
		</tbody>
	</table>`
      : `<div class="woocommerce-message woocommerce-message--info woocommerce-Message woocommerce-Message--info woocommerce-info">
		<a class="woocommerce-Button wc-forward button" href="/shop/">瀏覽產品</a>		目前尚無訂單。	</div>`
    return accountShell(page, ctx, 'orders', content, '訂單')
  }
  if (endpoint === 'view-order') {
    const id = Number(arg)
    const { data: o } = await svc().from('orders').select('*').eq('id', id).eq('customer_id', customer.id).maybeSingle()
    if (!o) return accountShell(page, ctx, 'orders', `<div class="woocommerce-error">無效的訂單。 <a href="/my-account/" class="wc-forward">我的帳號</a></div>`)
    const { data: items } = await svc().from('order_items').select('*').eq('order_id', id).order('id')
    return accountShell(page, ctx, 'orders', orderDetailsHtml(o, items || [], false), `訂單 #${o.order_number || o.id}`)
  }
  if (endpoint === 'edit-address') {
    const kind = arg === 'billing' || arg === 'shipping' ? arg : ''
    if (!kind) {
      const addr = (a: any) => (a && (a.address_1 || a.city) ? esc([`${a.last_name || ''}${a.first_name || ''}`, `${a.postcode || ''} ${a.state || ''}${a.city || ''}`, a.address_1, a.address_2].filter((x) => x && x.trim()).join('\n')).replace(/\n/g, '<br/>') : '你尚未設定這類型的地址。')
      return accountShell(
        page,
        ctx,
        'edit-address',
        `<p>
	下列地址會預設使用於結帳頁面。</p>

	<div class="u-columns woocommerce-Addresses col2-set addresses">

	<div class="u-column1 col-1 woocommerce-Address">
		<header class="woocommerce-Address-title title">
			<h2>帳單地址</h2>
			<a href="/my-account/edit-address/billing/" class="edit">${customer.billing?.address_1 ? '編輯帳單地址' : '新增帳單地址'}</a>
		</header>
		<address>
			${addr(customer.billing)}
					</address>
	</div>

	<div class="u-column2 col-2 woocommerce-Address">
		<header class="woocommerce-Address-title title">
			<h2>收件地址</h2>
			<a href="/my-account/edit-address/shipping/" class="edit">${customer.shipping?.address_1 ? '編輯收件地址' : '新增收件地址'}</a>
		</header>
		<address>
			${addr(customer.shipping)}
					</address>
	</div>

	</div>
	`,
      )
    }
    const fields = kind === 'billing' ? BILLING_FIELDS : SHIPPING_FIELDS
    const cur = customer[kind] || {}
    return accountShell(
      page,
      ctx,
      'edit-address',
      `<form method="post" action="/my-account/edit-address/${kind}/" novalidate>
	<input type="hidden" name="kc_action" value="save_address" /><input type="hidden" name="kind" value="${kind}" />
		<h2>${kind === 'billing' ? '帳單地址' : '收件地址'}</h2>
		<div class="woocommerce-address-fields">
			<div class="woocommerce-address-fields__field-wrapper">
				${fields.map((f) => fieldHtml(kind, f, cur[f.key] || '')).join('')}
			</div>
			<p>
				<button type="submit" class="button" name="save_address" value="儲存地址">儲存地址</button>
			</p>
		</div>
	</form>`,
    )
  }
  if (endpoint === 'edit-account') {
    return accountShell(
      page,
      ctx,
      'edit-account',
      `<form class="woocommerce-EditAccountForm edit-account" action="/my-account/edit-account/" method="post">
	<input type="hidden" name="kc_action" value="save_account" />
	<p class="woocommerce-form-row woocommerce-form-row--first form-row form-row-first">
		<label for="account_first_name">名字&nbsp;<span class="required" aria-hidden="true">*</span></label>
		<input type="text" class="woocommerce-Input woocommerce-Input--text input-text" name="account_first_name" id="account_first_name" autocomplete="given-name" value="${esc(customer.first_name || '')}" />
	</p>
	<p class="woocommerce-form-row woocommerce-form-row--last form-row form-row-last">
		<label for="account_last_name">姓氏&nbsp;<span class="required" aria-hidden="true">*</span></label>
		<input type="text" class="woocommerce-Input woocommerce-Input--text input-text" name="account_last_name" id="account_last_name" autocomplete="family-name" value="${esc(customer.last_name || '')}" />
	</p>
	<div class="clear"></div>
	<p class="woocommerce-form-row woocommerce-form-row--wide form-row form-row-wide">
		<label for="account_display_name">顯示名稱&nbsp;<span class="required" aria-hidden="true">*</span></label>
		<input type="text" class="woocommerce-Input woocommerce-Input--text input-text" name="account_display_name" id="account_display_name" value="${esc(customer.display_name || '')}" /> <span><em>這將是你的名稱在帳號區域和評論中顯示的方式</em></span>
	</p>
	<div class="clear"></div>
	<p class="woocommerce-form-row woocommerce-form-row--wide form-row form-row-wide">
		<label for="account_email">電子郵件地址&nbsp;<span class="required" aria-hidden="true">*</span></label>
		<input type="email" class="woocommerce-Input woocommerce-Input--email input-text" name="account_email" id="account_email" autocomplete="email" value="${esc(user.email)}" readonly />
	</p>
	<fieldset>
		<legend>變更密碼</legend>
		<p class="woocommerce-form-row woocommerce-form-row--wide form-row form-row-wide">
			<label for="password_1">新密碼 (留空則不變更)</label>
			<input type="password" class="woocommerce-Input woocommerce-Input--password input-text" name="password_1" id="password_1" autocomplete="new-password" />
		</p>
		<p class="woocommerce-form-row woocommerce-form-row--wide form-row form-row-wide">
			<label for="password_2">確認新密碼</label>
			<input type="password" class="woocommerce-Input woocommerce-Input--password input-text" name="password_2" id="password_2" autocomplete="new-password" />
		</p>
	</fieldset>
	<div class="clear"></div>
	<p>
		<button type="submit" class="woocommerce-Button button" name="save_account_details" value="儲存變更">儲存變更</button>
	</p>
</form>`,
      '帳號詳細資料',
    )
  }
  return null
}
