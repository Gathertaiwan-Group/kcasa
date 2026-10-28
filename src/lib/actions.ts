/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Form posts, handled like WordPress/WooCommerce do (POST to the page URL → redirect back with a notice):
 * add to cart, cart update / coupons / shipping, checkout (creates a *pending* order; 藍新信用卡 orders then go to NewebPay MPG),
 * my-account login / register / lost password / addresses / account details, product reviews, WPForms.
 */
import { cookies, headers } from 'next/headers'
import { authClient, currentUser, customerFor } from './auth'
import { addToCart, applyCoupon, clearCart, loadCart, setQuantities, updateCartMeta } from './cart'
import { pushNotice, type Out } from './router'
import { svc } from './sb'
import { purgePublicPages } from './page-cache'
import { getSite, invalidateSite } from './site'
import { esc, normPath, siteUrl } from './util'
import { verifyWpformsToken } from './wpforms-token'
import { BILLING_FIELDS, SHIPPING_FIELDS } from './views/checkout'
import { GATEWAY_ID, HOLD_MINUTES, holdStock, paymentMethods, releaseExpiredHolds, settleHoldForStatus } from './newebpay'

type F = Record<string, string>

function formObj(fd: FormData): F {
  const o: F = {}
  for (const [k, v] of fd.entries()) if (typeof v === 'string') o[k] = v
  return o
}

const back = (to: string): Out => ({ type: 'redirect', to, status: 303 })

async function clientIp(): Promise<string | null> {
  const h = await headers()
  const ip = (h.get('x-forwarded-for') || '').split(',')[0].trim() || h.get('x-real-ip') || ''
  return /^[0-9a-f.:]+$/i.test(ip) ? ip : null
}

async function tooMany(table: 'form_submissions' | 'comments' | 'orders', ip: string | null, max: number, minutes = 10): Promise<boolean> {
  if (!ip) return false
  const col = table === 'form_submissions' ? 'ip' : table === 'comments' ? 'author_ip' : 'customer_ip'
  const since = new Date(Date.now() - minutes * 60_000).toISOString()
  const { count } = await svc().from(table).select('id', { count: 'exact', head: true }).eq(col, ip).gte('created_at', since)
  return (count || 0) >= max
}

export async function handlePost(url: URL, fd: FormData): Promise<Out> {
  const f = formObj(fd)
  const path = normPath(url.pathname)

  // ---- WPForms (contact form)
  if (f['wpforms[id]']) return wpforms(url, f)

  // ---- product reviews
  if (path === '/wp-comments-post.php') return review(f)

  // ---- add to cart (product page form, or any URL with add-to-cart)
  if (f['add-to-cart'] || url.searchParams.get('add-to-cart')) {
    const pid = Number(f['add-to-cart'] || url.searchParams.get('add-to-cart'))
    await releaseExpiredHolds() // before the stock check: an expired 藍新 hold must not make the item look sold out
    const r = await addToCart(pid, Number(f.variation_id) || null, Number(f.quantity) || 1, f)
    if (r.ok) await pushNotice({ type: 'success', html: `<a href="/cart/" tabindex="1" class="button wc-forward">查看購物車</a> 「${esc(r.product!.name)}」已加入您的購物車。` })
    else await pushNotice({ type: 'error', html: esc(r.error || '無法加入購物車。') })
    return back(url.pathname)
  }

  if (path === '/cart/') {
    if (f['shipping_method[0]']) await updateCartMeta({ shipping_method: f['shipping_method[0]'] })
    if (f.apply_coupon !== undefined || (f.coupon_code && f.update_cart === undefined)) {
      const err = await applyCoupon(f.coupon_code || '')
      await pushNotice(err ? { type: 'error', html: esc(err) } : { type: 'success', html: '已成功套用優惠券。' })
      return back('/cart/')
    }
    const qtys: Record<number, number> = {}
    for (const [k, v] of Object.entries(f)) {
      const m = k.match(/^cart\[(\d+)\]\[qty\]$/)
      if (m) qtys[Number(m[1])] = Math.max(0, Math.floor(Number(v) || 0))
    }
    if (Object.keys(qtys).length) {
      await setQuantities(qtys)
      if (f.update_cart !== undefined) await pushNotice({ type: 'success', html: '購物車已更新。' })
    }
    return back('/cart/')
  }

  if (path === '/checkout/') {
    if (f.apply_coupon !== undefined) {
      const err = await applyCoupon(f.coupon_code || '')
      await pushNotice(err ? { type: 'error', html: esc(err) } : { type: 'success', html: '已成功套用優惠券。' })
      return back('/checkout/')
    }
    return placeOrder(f)
  }

  if (path.startsWith('/my-account/')) return account(url, f)

  return back(url.pathname + url.search)
}

// ---------------------------------------------------------------- checkout
async function placeOrder(f: F): Promise<Out> {
  const errors: string[] = []
  const shipDiff = !!f.ship_to_different_address
  const billing: Record<string, string> = { country: 'TW' }
  for (const fld of BILLING_FIELDS) {
    const v = (f['billing_' + fld.key] || '').trim().slice(0, 200)
    billing[fld.key] = v
    if (fld.required && !v) errors.push(`<strong>帳單 ${esc(fld.label)}</strong> 是必要欄位。`)
  }
  if (billing.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billing.email)) errors.push('<strong>帳單 電子郵件地址</strong> 不是有效的電子郵件地址。')
  if (billing.phone && !/^[0-9+\-()#\s]{6,20}$/.test(billing.phone)) errors.push('<strong>帳單 聯絡電話</strong> 不是有效的電話號碼。')
  let shipping: Record<string, string> = { country: 'TW' }
  if (shipDiff) {
    for (const fld of SHIPPING_FIELDS) {
      const v = (f['shipping_' + fld.key] || '').trim().slice(0, 200)
      shipping[fld.key] = v
      if (fld.required && !v) errors.push(`<strong>運送 ${esc(fld.label)}</strong> 是必要欄位。`)
    }
  } else {
    shipping = Object.fromEntries(SHIPPING_FIELDS.map((x) => [x.key, billing[x.key] || ''])) as Record<string, string>
    shipping.country = 'TW'
  }
  if (f['shipping_method[0]']) await updateCartMeta({ shipping_method: f['shipping_method[0]'] })
  const reqHost = ((await headers()).get('x-forwarded-host') || (await headers()).get('host') || '').split(',')[0].trim() || null
  const methods = paymentMethods(reqHost)
  const pm = methods.find((m) => m.id === (f.payment_method || methods[0].id))
  if (!pm) errors.push('無效的付款方式。')
  const online = pm?.id === GATEWAY_ID
  const user = await currentUser()
  // expired 藍新 orders give their held stock back before any stock check of this order
  await releaseExpiredHolds()
  const cart = await loadCart({ email: billing.email })
  if (!cart.lines.length) errors.push('抱歉，您的工作階段已過期。<a href="/shop/" class="wc-backward">回到商店</a>')
  // amount is always the server-side cart total; NewebPay needs a positive whole-dollar TWD amount
  else if (online && !(Number.isInteger(cart.total) && cart.total > 0)) errors.push('此訂單金額無法使用信用卡付款，請選擇其他付款方式。')
  const ip = await clientIp()
  if (!errors.length && (await tooMany('orders', ip, 10, 10))) errors.push('下單次數過於頻繁，請稍後再試。')
  if (errors.length) {
    await pushNotice(errors.map((e) => ({ type: 'error' as const, html: e })))
    const keep: F = {}
    for (const [k, v] of Object.entries(f)) if (/^(billing|shipping)_|^order_comments$|^ship_to_different_address$|^payment_method$/.test(k)) keep[k] = v.slice(0, 200)
    ;(await cookies()).set('kc_checkout_form', Buffer.from(JSON.stringify(keep)).toString('base64url'), { path: '/checkout/', httpOnly: true, sameSite: 'lax', maxAge: 300 })
    return back('/checkout/')
  }
  const db = svc()
  const customer = user ? await customerFor(user).catch(() => null) : null
  const h = await headers()
  const ship = cart.chosenShipping
  const { data: order, error } = await db
    .from('orders')
    .insert({
      status: 'pending',
      currency: 'TWD',
      customer_id: customer?.id ?? null,
      billing,
      shipping,
      payment_method: pm!.id,
      payment_method_title: pm!.title,
      shipping_method: ship?.id || null,
      subtotal: cart.subtotal,
      discount_total: cart.discount,
      shipping_total: cart.shippingTotal,
      total: cart.total,
      customer_note: (f.order_comments || '').slice(0, 2000),
      customer_ip: ip,
      customer_user_agent: (h.get('user-agent') || '').slice(0, 300),
      created_via: 'checkout',
      coupon_codes: cart.coupons.map((c) => c.code),
      meta: { shipping_title: ship?.label || '', source: 'nextjs' },
    })
    .select('id,order_key')
    .single()
  if (error || !order) {
    await pushNotice({ type: 'error', html: '處理訂單時發生錯誤，請再試一次。' })
    return back('/checkout/')
  }
  await db.from('orders').update({ order_number: String(order.id) }).eq('id', order.id)
  const items: any[] = cart.lines.map((l) => ({
    order_id: order.id,
    item_type: 'line_item',
    name: l.name,
    product_id: l.product.id,
    variation_id: l.variation?.id ?? null,
    sku: l.variation?.sku || l.product.sku || null,
    quantity: l.quantity,
    subtotal: l.lineSubtotal,
    total: l.lineSubtotal,
    meta: { attributes: l.attributes, unit_price: l.unit, regular_unit_price: l.regularUnit, qty_discount: l.discountNote },
  }))
  if (ship) items.push({ order_id: order.id, item_type: 'shipping', name: ship.label, quantity: 1, subtotal: cart.shippingTotal, total: cart.shippingTotal, meta: { method_id: ship.method_id, instance_id: ship.instance } })
  for (const c of cart.coupons) items.push({ order_id: order.id, item_type: 'coupon', name: c.code, quantity: 1, subtotal: c.amount, total: c.amount, meta: { code: c.code, discount: c.amount } })
  const { error: itemsErr } = await db.from('order_items').insert(items)
  // Stock, atomically in the DB (row locks; refused when short — no overselling between concurrent checkouts):
  //  - 藍新: reserve now (woocommerce_hold_stock_minutes = 60); payment converts the hold, failure / timeout releases it.
  //    The same call enforces the flood guard (MAX_UNPAID_PER_BUYER unpaid 藍新 orders per IP / e-mail).
  //  - 領取報價: reduce now, as before (hold + immediate convert, which also counts total_sales).
  const hold = itemsErr ? ({ ok: false, reason: 'error' } as const) : await holdStock(order.id)
  if (!hold.ok) {
    await db.from('orders').delete().eq('id', order.id) // never shown to anyone; items cascade
    const names = new Map(cart.lines.map((l) => [l.variation ? `v${l.variation.id}` : `p${l.product.id}`, l.name]))
    const msg =
      hold.reason === 'out_of_stock'
        ? (hold.short || []).map((x: any) => `抱歉，我們沒有足夠的「${esc(names.get(x.variation_id ? `v${x.variation_id}` : `p${x.product_id}`) || '商品')}」庫存可以完成您的訂單（剩餘 ${Number(x.available) || 0} 件）。請編輯您的購物車並再試一次。`)
        : hold.reason === 'too_many_unpaid'
          ? [`您已有多筆尚未完成付款的信用卡訂單。請先完成這些訂單的付款，或等待 ${HOLD_MINUTES} 分鐘後未付款訂單自動取消，再重新下單。`]
          : ['處理訂單時發生錯誤，請再試一次。']
    await pushNotice(msg.map((html) => ({ type: 'error' as const, html })))
    invalidateSite()
    return back(hold.reason === 'out_of_stock' ? '/cart/' : '/checkout/')
  }
  if (!online) await settleHoldForStatus(order.id, 'on-hold', true).catch((e) => console.error('[checkout] convert hold', (e as Error).message))
  await db.from('order_notes').insert({ order_id: order.id, content: online ? `訂單狀態設為「等待付款中」。付款方式：${pm!.title}，已預留庫存 ${HOLD_MINUTES} 分鐘，轉往藍新金流付款。` : `訂單狀態設為「等待付款中」。付款方式：${pm!.title}。`, added_by: 'system' })
  // coupon usage
  for (const c of cart.coupons) await db.from('coupons').update({ usage_count: (c.row.usage_count || 0) + 1, used_by: [...(c.row.used_by || []), billing.email] }).eq('id', c.row.id)
  if (customer) {
    await db.from('customers').update({ billing, ...(shipDiff ? { shipping } : {}), orders_count: (customer.orders_count || 0) + 1, first_name: customer.first_name || billing.first_name, last_name: customer.last_name || billing.last_name }).eq('id', customer.id)
  }
  if (cart.cartId) await clearCart(cart.cartId)
  invalidateSite()
  await purgePublicPages() // stock / sales counts on product pages
  if (online) {
    return back(`/api/newebpay/pay/?order=${order.id}&key=${order.order_key}`)
  }
  return back(`/checkout/order-received/${order.id}/?key=${order.order_key}`)
}

// ---------------------------------------------------------------- my account
async function account(url: URL, f: F): Promise<Out> {
  const action = f.kc_action
  if (action === 'login') {
    const email = (f.username || '').trim()
    if (!email || !f.password) {
      await pushNotice({ type: 'error', html: '<strong>錯誤：</strong>請輸入使用者名稱或電子郵件與密碼。' })
      return back('/my-account/')
    }
    const sb = await authClient()
    const { data, error } = await sb.auth.signInWithPassword({ email, password: f.password })
    if (error || !data.user) {
      await pushNotice({ type: 'error', html: '<strong>錯誤：</strong>電子郵件地址或密碼不正確。<a href="/my-account/lost-password/">忘記密碼？</a>' })
      return back('/my-account/')
    }
    await customerFor({ id: data.user.id, email: data.user.email || email }).catch(() => null)
    return back('/my-account/')
  }
  if (action === 'register') {
    const email = (f.email || '').trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      await pushNotice({ type: 'error', html: '<strong>錯誤：</strong>請提供有效的電子郵件地址。' })
      return back('/my-account/?action=register')
    }
    if ((f.password || '').length < 8) {
      await pushNotice({ type: 'error', html: '<strong>錯誤：</strong>密碼至少需要 8 個字元。' })
      return back('/my-account/?action=register')
    }
    const sb = await authClient()
    const { data, error } = await sb.auth.signUp({ email, password: f.password, options: { emailRedirectTo: `${siteUrl()}/api/auth/callback/?next=/my-account/` } })
    if (error) {
      await pushNotice({ type: 'error', html: `<strong>錯誤：</strong>${/registered|exists/i.test(error.message) ? '此電子郵件已註冊帳號，請直接登入。' : '註冊失敗，請稍後再試。'}` })
      return back('/my-account/?action=register')
    }
    if (data.user) await customerFor({ id: data.user.id, email }).catch(() => null)
    if (!data.session) {
      await pushNotice({ type: 'info', html: '註冊成功！請至信箱點擊確認連結以啟用帳號，然後再登入。' })
      return back('/my-account/')
    }
    return back('/my-account/')
  }
  if (action === 'lost_password') {
    const email = (f.user_login || '').trim()
    if (email) {
      const sb = await authClient()
      await sb.auth.resetPasswordForEmail(email, { redirectTo: `${siteUrl()}/api/auth/callback/?next=/my-account/edit-account/` }).catch(() => null)
    }
    return back('/my-account/lost-password/?reset-link-sent=true')
  }
  const user = await currentUser()
  if (!user) return back('/my-account/')
  const customer = await customerFor(user)
  const db = svc()
  if (action === 'save_address') {
    const kind = f.kind === 'shipping' ? 'shipping' : 'billing'
    const fields = kind === 'billing' ? BILLING_FIELDS : SHIPPING_FIELDS
    const addr: Record<string, string> = { country: 'TW' }
    const errs: string[] = []
    for (const fld of fields) {
      addr[fld.key] = (f[`${kind}_${fld.key}`] || '').trim().slice(0, 200)
      if (fld.required && !addr[fld.key]) errs.push(`<strong>${esc(fld.label)}</strong> 是必要欄位。`)
    }
    if (errs.length) {
      await pushNotice(errs.map((e) => ({ type: 'error' as const, html: e })))
      return back(`/my-account/edit-address/${kind}/`)
    }
    await db.from('customers').update({ [kind]: addr }).eq('id', customer.id)
    await pushNotice({ type: 'success', html: '地址已成功變更。' })
    return back('/my-account/edit-address/')
  }
  if (action === 'save_account') {
    const patch = { first_name: (f.account_first_name || '').trim().slice(0, 100), last_name: (f.account_last_name || '').trim().slice(0, 100), display_name: (f.account_display_name || '').trim().slice(0, 100) || customer.display_name }
    await db.from('customers').update(patch).eq('id', customer.id)
    if (f.password_1) {
      if (f.password_1 !== f.password_2) {
        await pushNotice({ type: 'error', html: '新密碼不相符。' })
        return back('/my-account/edit-account/')
      }
      if (f.password_1.length < 8) {
        await pushNotice({ type: 'error', html: '密碼至少需要 8 個字元。' })
        return back('/my-account/edit-account/')
      }
      const sb = await authClient()
      const { error } = await sb.auth.updateUser({ password: f.password_1 })
      if (error) {
        await pushNotice({ type: 'error', html: '密碼變更失敗，請重新登入後再試。' })
        return back('/my-account/edit-account/')
      }
    }
    await pushNotice({ type: 'success', html: '帳號詳細資料已成功變更。' })
    return back('/my-account/')
  }
  return back(url.pathname)
}

// ---------------------------------------------------------------- reviews
async function review(f: F): Promise<Out> {
  const site = await getSite()
  const pid = Number(f.comment_post_ID)
  const p = site.productById.get(pid)
  const post = site.postById.get(pid)
  const link = p ? `/product/${p.slug}/` : post?.path || '/'
  const errs: string[] = []
  if (!p && !post) errs.push('無效的文章。')
  if (p && !f.rating) errs.push('請選擇一個評分')
  if (!(f.comment || '').trim()) errs.push('<strong>錯誤</strong>：請輸入留言內容。')
  if (!(f.author || '').trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email || '')) errs.push('<strong>錯誤</strong>：請填寫必要欄位 (名稱、電子郵件地址)。')
  const ip = await clientIp()
  if (!errs.length && (await tooMany('comments', ip, 5))) errs.push('<strong>錯誤</strong>：留言速度過快，請稍候再試。')
  if (errs.length) {
    await pushNotice(errs.map((e) => ({ type: 'error' as const, html: e })))
    return back(link + '#respond')
  }
  const h = await headers()
  await svc()
    .from('comments')
    .insert({
      post_id: pid,
      object_type: p ? 'product' : 'post',
      parent_id: Number(f.comment_parent) || null,
      author_name: f.author.trim().slice(0, 100),
      author_email: f.email.trim().slice(0, 200),
      author_ip: ip,
      content_html: esc(f.comment.trim().slice(0, 5000)).replace(/\n/g, '<br />'),
      rating: p ? Math.min(5, Math.max(1, Number(f.rating) || 5)) : null,
      comment_type: p ? 'review' : 'comment',
      status: 'hold',
    })
  void h
  await pushNotice({ type: 'info', html: '您的評價正在等待審核。' })
  return back(link + '#reviews')
}

// ---------------------------------------------------------------- WPForms → site_kcasa.form_submissions
async function wpforms(url: URL, f: F): Promise<Out> {
  const site = await getSite()
  const formId = Number(f['wpforms[id]'])
  const form = site.forms.find((x) => Number(x.id) === formId)
  const backTo = url.pathname
  if (!form) return back(backTo)
  if (f['wpforms[hp]']) return back(backTo) // honeypot
  // anti-spam token issued by /api/wp/admin-ajax/ (action=wpforms_get_token) and stamped on the rendered form
  if (!verifyWpformsToken(formId, f['wpforms[token]'])) {
    await pushNotice({ type: 'error', html: '表單驗證已過期，請重新整理頁面後再送出。' })
    return back(backTo + `#wpforms-${formId}`)
  }
  const data: Record<string, any> = {}
  const errs: string[] = []
  for (const fld of form.fields || []) {
    let v = f[`wpforms[fields][${fld.id}]`]
    if (v === undefined && fld.type === 'name') v = [f[`wpforms[fields][${fld.id}][first]`], f[`wpforms[fields][${fld.id}][last]`]].filter(Boolean).join(' ')
    v = (v || '').trim().slice(0, 5000)
    if (fld.required && !v) errs.push(`${fld.label} 為必填欄位。`)
    if (fld.type === 'email' && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) errs.push('請輸入有效的電子郵件地址。')
    data[fld.label || `field_${fld.id}`] = v
  }
  const ip = await clientIp()
  if (!errs.length && (await tooMany('form_submissions', ip, 5))) errs.push('送出次數過於頻繁，請稍後再試。')
  if (errs.length) {
    await pushNotice(errs.map((e) => ({ type: 'error' as const, html: esc(e) })))
    return back(backTo + `#wpforms-${formId}`)
  }
  const h = await headers()
  const { error } = await svc()
    .from('form_submissions')
    .insert({ form_id: formId, data, status: 'new', ip, user_agent: (h.get('user-agent') || '').slice(0, 300), page_url: (f.page_url || backTo).slice(0, 500) })
  if (error) {
    await pushNotice({ type: 'error', html: '送出失敗，請稍後再試。' })
    return back(backTo + `#wpforms-${formId}`)
  }
  await pushNotice({ type: 'success', html: `wpforms:${formId}` })
  return back(backTo + `#wpforms-confirm-${formId}`)
}
