/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * MCP server for kcasa: lets an AI client manage the site (content, products, prices/stock, terms,
 * media, orders, form submissions, settings, menus, redirects). Every write goes through
 * src/lib/admin/* which records site_kcasa.audit_log (via = 'mcp').
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import * as C from '../admin/content'
import { OpError, type Actor } from '../admin/core'
import * as S from '../admin/shop'
import * as O from '../admin/site-ops'

type Result = { content: { type: 'text'; text: string }[]; isError?: boolean }

function ok(v: unknown): Result {
  return { content: [{ type: 'text', text: JSON.stringify(v, null, 2) }] }
}

function fail(e: unknown): Result {
  const msg = e instanceof OpError ? e.message : e instanceof Error ? e.message : String(e)
  return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true }
}

const wrap =
  <A,>(fn: (a: A) => Promise<unknown>) =>
  async (a: A): Promise<Result> => {
    try {
      return ok(await fn(a))
    } catch (e) {
      return fail(e)
    }
  }

const RO = { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
const RW = { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
const DEL = { readOnlyHint: false, destructiveHint: true, openWorldHint: false }

const id = z.number().int().positive()
const paging = { limit: z.number().int().min(1).max(500).optional(), offset: z.number().int().min(0).optional() }
const seo = z
  .object({ title: z.string().optional(), description: z.string().optional(), robots: z.string().optional(), og_title: z.string().optional(), og_image: z.string().optional(), canonical: z.string().nullable().optional() })
  .optional()
  .describe('Rank Math style overrides')
const contentFields = {
  title: z.string().optional(),
  slug: z.string().optional().describe('URL slug; Chinese is fine (stored percent-encoded like WordPress)'),
  content_html: z.string().optional().describe('Full HTML body'),
  excerpt_html: z.string().optional(),
  status: z.enum(['draft', 'pending', 'private', 'publish', 'future']).optional(),
  published_at: z.string().nullable().optional().describe('ISO 8601; required with status=future (scheduled)'),
  featured_media_id: z.number().int().nullable().optional(),
  parent_id: z.number().int().nullable().optional(),
  menu_order: z.number().int().optional(),
  template: z.string().optional(),
  comment_status: z.enum(['open', 'closed']).optional(),
  sticky: z.boolean().optional(),
  seo,
  category_ids: z.array(z.number().int()).optional().describe('posts only: replaces the post categories'),
  tag_ids: z.array(z.number().int()).optional(),
  tag_names: z.array(z.string()).optional().describe('tags by name (created if missing)'),
}
const productFields = {
  name: z.string().optional(),
  slug: z.string().optional(),
  type: z.enum(['simple', 'variable', 'grouped', 'external']).optional(),
  status: z.enum(['draft', 'pending', 'private', 'publish']).optional(),
  featured: z.boolean().optional(),
  catalog_visibility: z.enum(['visible', 'catalog', 'search', 'hidden']).optional(),
  sku: z.string().optional(),
  description_html: z.string().optional(),
  short_description_html: z.string().optional(),
  regular_price: z.number().nullable().optional(),
  sale_price: z.number().nullable().optional(),
  sale_starts_at: z.string().nullable().optional(),
  sale_ends_at: z.string().nullable().optional(),
  manage_stock: z.boolean().optional(),
  stock_quantity: z.number().int().nullable().optional(),
  stock_status: z.enum(['instock', 'outofstock', 'onbackorder']).optional(),
  backorders: z.enum(['no', 'notify', 'yes']).optional(),
  weight: z.number().nullable().optional(),
  length: z.number().nullable().optional(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  featured_media_id: z.number().int().nullable().optional(),
  gallery_media_ids: z.array(z.number().int()).optional(),
  menu_order: z.number().int().optional(),
  reviews_allowed: z.boolean().optional(),
  seo,
  category_ids: z.array(z.number().int()).optional().describe('product_cat term ids (replaces)'),
  tag_ids: z.array(z.number().int()).optional(),
  tag_names: z.array(z.string()).optional(),
}
const variationFields = {
  sku: z.string().optional(),
  attributes: z.array(z.object({ name: z.string(), value: z.string().nullable() })).optional(),
  status: z.enum(['publish', 'private']).optional(),
  regular_price: z.number().nullable().optional(),
  sale_price: z.number().nullable().optional(),
  manage_stock: z.boolean().optional(),
  stock_quantity: z.number().int().nullable().optional(),
  stock_status: z.enum(['instock', 'outofstock', 'onbackorder']).optional(),
  image_id: z.number().int().nullable().optional(),
  menu_order: z.number().int().optional(),
}

function blockedHost(u: URL) {
  const h = u.hostname.toLowerCase()
  return h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(h) || h === '[::1]' || h.startsWith('[fc') || h.startsWith('[fd')
}

export function buildServer(actor: Actor): McpServer {
  const s = new McpServer({ name: 'kcasa-site', version: '1.0.0' }, { instructions: 'Manage the Kcasa 工富家飾 website (Next.js + Supabase rebuild of kcasa.pro). New content defaults to draft; deletes go to trash unless force=true. Every write is audit-logged. Prices are TWD.' })

  // ------------------------------------------------------------ content (posts / pages / reusable blocks)
  s.registerTool('list_content', { title: 'List posts/pages', description: 'List posts, pages or reusable blocks (wp_block). Excludes trash unless status="trash".', inputSchema: { type: z.enum(['post', 'page', 'wp_block']).optional(), status: z.enum(['all', 'publish', 'draft', 'pending', 'private', 'future', 'trash']).optional(), search: z.string().optional(), ...paging }, annotations: RO }, wrap((a: any) => C.listContent(a)))
  s.registerTool('get_content', { title: 'Get a post/page', description: 'Read one post/page/block by id, including content_html, seo and term_ids.', inputSchema: { id }, annotations: RO }, wrap((a: any) => C.getContent(a.id)))
  s.registerTool('create_content', { title: 'Create a post/page', description: 'Create a post, page or reusable block. Defaults to status=draft.', inputSchema: { post_type: z.enum(['post', 'page', 'wp_block']).default('post'), ...contentFields, title: z.string() }, annotations: RW }, wrap((a: any) => C.createContent(actor, a)))
  s.registerTool('update_content', { title: 'Update a post/page', description: 'Patch fields of a post/page/block. Changing the slug of a published item adds a 301 from the old URL.', inputSchema: { id, ...contentFields }, annotations: RW }, wrap((a: any) => C.updateContent(actor, a.id, a)))
  s.registerTool('delete_content', { title: 'Delete a post/page', description: 'Move to trash (default) or delete permanently with force=true.', inputSchema: { id, force: z.boolean().default(false) }, annotations: DEL }, wrap((a: any) => C.deleteContent(actor, a.id, a.force)))
  s.registerTool('restore_content', { title: 'Restore from trash', description: 'Restore a trashed post/page to its previous status.', inputSchema: { id }, annotations: RW }, wrap((a: any) => C.restoreContent(actor, a.id)))

  // ------------------------------------------------------------ products
  s.registerTool('list_products', { title: 'List products', description: 'List WooCommerce products (filter by status, search name/SKU, category, stock status).', inputSchema: { status: z.enum(['all', 'publish', 'draft', 'pending', 'private', 'trash']).optional(), search: z.string().optional(), category_id: z.number().int().optional(), stock_status: z.enum(['instock', 'outofstock', 'onbackorder']).optional(), ...paging }, annotations: RO }, wrap((a: any) => S.listProducts(a)))
  s.registerTool('get_product', { title: 'Get a product', description: 'Read one product with variations, attributes and term_ids.', inputSchema: { id }, annotations: RO }, wrap((a: any) => S.getProduct(a.id)))
  s.registerTool('create_product', { title: 'Create a product', description: 'Create a product. Defaults to status=draft, type=simple.', inputSchema: { ...productFields, name: z.string() }, annotations: RW }, wrap((a: any) => S.createProduct(actor, a)))
  s.registerTool('update_product', { title: 'Update a product', description: 'Patch product fields (price, stock, descriptions, categories, SEO…).', inputSchema: { id, ...productFields }, annotations: RW }, wrap((a: any) => S.updateProduct(actor, a.id, a)))
  s.registerTool('delete_product', { title: 'Delete a product', description: 'Move to trash (default) or delete permanently with force=true.', inputSchema: { id, force: z.boolean().default(false) }, annotations: DEL }, wrap((a: any) => S.deleteProduct(actor, a.id, a.force)))
  s.registerTool('set_price', { title: 'Set price', description: 'Set regular/sale price (and sale schedule) of a product or one variation.', inputSchema: { product_id: id, variation_id: id.optional(), regular_price: z.number().nullable().optional(), sale_price: z.number().nullable().optional(), sale_starts_at: z.string().nullable().optional(), sale_ends_at: z.string().nullable().optional() }, annotations: RW }, wrap((a: any) => S.setPrice(actor, a)))
  s.registerTool('adjust_stock', { title: 'Adjust stock', description: 'Set stock (set) or change it (delta, e.g. -2) for a product or variation; or set stock_status.', inputSchema: { product_id: id, variation_id: id.optional(), set: z.number().int().optional(), delta: z.number().int().optional(), stock_status: z.enum(['instock', 'outofstock', 'onbackorder']).optional(), manage_stock: z.boolean().optional() }, annotations: RW }, wrap((a: any) => S.adjustStock(actor, a)))
  s.registerTool('create_variation', { title: 'Create a variation', description: 'Add a variation to a variable product.', inputSchema: { product_id: id, ...variationFields }, annotations: RW }, wrap((a: any) => S.createVariation(actor, a.product_id, a)))
  s.registerTool('update_variation', { title: 'Update a variation', description: 'Patch a variation (price, stock, SKU, attributes).', inputSchema: { id, ...variationFields }, annotations: RW }, wrap((a: any) => S.updateVariation(actor, a.id, a)))
  s.registerTool('delete_variation', { title: 'Delete a variation', description: 'Delete one variation permanently.', inputSchema: { id }, annotations: DEL }, wrap((a: any) => S.deleteVariation(actor, a.id)))

  // ------------------------------------------------------------ terms
  const taxonomy = z.enum(['category', 'post_tag', 'product_cat', 'product_tag', 'pa_規格'])
  s.registerTool('list_terms', { title: 'List categories/tags', description: 'List terms of a taxonomy (category, post_tag, product_cat, product_tag).', inputSchema: { taxonomy: taxonomy.optional() }, annotations: RO }, wrap((a: any) => C.listTerms(a.taxonomy)))
  s.registerTool('create_term', { title: 'Create category/tag', description: 'Create a term.', inputSchema: { taxonomy, name: z.string(), slug: z.string().optional(), description: z.string().optional(), parent_id: z.number().int().nullable().optional(), menu_order: z.number().int().optional(), image_id: z.number().int().nullable().optional() }, annotations: RW }, wrap((a: any) => C.createTerm(actor, a)))
  s.registerTool('update_term', { title: 'Update category/tag', description: 'Patch a term (slug change on a used archive adds a 301).', inputSchema: { id, name: z.string().optional(), slug: z.string().optional(), description: z.string().optional(), parent_id: z.number().int().nullable().optional(), menu_order: z.number().int().optional(), image_id: z.number().int().nullable().optional() }, annotations: RW }, wrap((a: any) => C.updateTerm(actor, a.id, a)))
  s.registerTool('delete_term', { title: 'Delete category/tag', description: 'Delete a term (objects lose the term).', inputSchema: { id }, annotations: DEL }, wrap((a: any) => C.deleteTerm(actor, a.id)))
  s.registerTool('set_object_terms', { title: 'Set terms of a post/product', description: 'Replace the terms of one taxonomy on a post or product.', inputSchema: { object_type: z.enum(['post', 'product']), object_id: id, taxonomy, term_ids: z.array(z.number().int()) }, annotations: RW }, wrap(async (a: any) => {
    await C.setObjectTerms(a.object_type, a.object_id, a.taxonomy, a.term_ids)
    const { audit } = await import('../admin/core')
    await audit(actor, 'terms.set', a.object_type, a.object_id, null, { taxonomy: a.taxonomy, term_ids: a.term_ids })
    return { ok: true }
  }))

  // ------------------------------------------------------------ media
  s.registerTool('list_media', { title: 'List media', description: 'List media library items (search title/alt/path, filter by mime prefix e.g. "image").', inputSchema: { search: z.string().optional(), mime: z.string().optional(), ...paging }, annotations: RO }, wrap((a: any) => O.listMedia(a)))
  s.registerTool('upload_media', { title: 'Upload media', description: 'Upload an image/PDF/video from a public https URL or base64. Images are converted to WebP (≤2000px, q80). Returns the media row (id, url).', inputSchema: { url: z.string().url().optional(), base64: z.string().optional(), filename: z.string(), mime_type: z.string().optional(), title: z.string().optional(), alt_text: z.string().optional() }, annotations: { ...RW, openWorldHint: true } }, wrap(async (a: any) => {
    let buffer: Buffer
    let mime = a.mime_type || ''
    if (a.base64) buffer = Buffer.from(a.base64.replace(/^data:[^,]+,/, ''), 'base64')
    else if (a.url) {
      const u = new URL(a.url)
      if (u.protocol !== 'https:' || blockedHost(u)) throw new OpError('only public https URLs are allowed')
      const r = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'GatherMigrator/1.0' } })
      if (!r.ok) throw new OpError(`download failed: HTTP ${r.status}`)
      buffer = Buffer.from(await r.arrayBuffer())
      mime = mime || (r.headers.get('content-type') || '').split(';')[0]
    } else throw new OpError('url or base64 is required')
    return O.uploadMedia(actor, { buffer, filename: a.filename, mime }, { title: a.title, alt_text: a.alt_text })
  }))
  s.registerTool('update_media', { title: 'Update media', description: 'Edit title / alt text / caption of a media item.', inputSchema: { id, title: z.string().optional(), alt_text: z.string().optional(), caption_html: z.string().optional() }, annotations: RW }, wrap((a: any) => O.updateMedia(actor, a.id, a)))

  s.registerTool('delete_media', { title: 'Delete media', description: 'Permanently delete a media item and its stored file (pages using it will show a broken image).', inputSchema: { id }, annotations: DEL }, wrap((a: any) => O.deleteMedia(actor, a.id)))

  // ------------------------------------------------------------ orders & customers
  s.registerTool('list_orders', { title: 'List orders', description: 'List orders (filter by status, search by id/email/name/phone).', inputSchema: { status: z.enum(['all', ...Object.keys(S.ORDER_STATUSES)] as [string, ...string[]]).optional(), search: z.string().optional(), customer_id: z.number().int().optional(), ...paging }, annotations: RO }, wrap((a: any) => S.listOrders(a)))
  s.registerTool('get_order', { title: 'Get an order', description: 'Read an order with items, notes, refunds and customer.', inputSchema: { id }, annotations: RO }, wrap((a: any) => S.getOrder(a.id)))
  s.registerTool('update_order_status', { title: 'Update order status', description: 'Change order status (pending, processing, on-hold, completed, cancelled, refunded, failed) with an optional note.', inputSchema: { id, status: z.enum(Object.keys(S.ORDER_STATUSES) as [string, ...string[]]), note: z.string().optional() }, annotations: RW }, wrap((a: any) => S.updateOrderStatus(actor, a.id, a.status, a.note)))
  s.registerTool('add_order_note', { title: 'Add order note', description: 'Add a private (or customer) note to an order.', inputSchema: { id, content: z.string(), is_customer_note: z.boolean().default(false) }, annotations: RW }, wrap((a: any) => S.addOrderNote(actor, a.id, a.content, a.is_customer_note)))
  s.registerTool('list_customers', { title: 'List customers', description: 'List customers (search email/name).', inputSchema: { search: z.string().optional(), ...paging }, annotations: RO }, wrap((a: any) => S.listCustomers(a)))
  s.registerTool('get_customer', { title: 'Get a customer', description: 'Read a customer with their orders.', inputSchema: { id }, annotations: RO }, wrap((a: any) => S.getCustomer(a.id)))

  // ------------------------------------------------------------ coupons
  s.registerTool('list_coupons', { title: 'List coupons', description: 'List coupons.', inputSchema: {}, annotations: RO }, wrap(() => S.listCoupons()))
  const couponFields = { code: z.string().optional(), description: z.string().optional(), discount_type: z.enum(['percent', 'fixed_cart', 'fixed_product']).optional(), amount: z.number().optional(), free_shipping: z.boolean().optional(), expires_at: z.string().nullable().optional(), minimum_amount: z.number().nullable().optional(), maximum_amount: z.number().nullable().optional(), individual_use: z.boolean().optional(), exclude_sale_items: z.boolean().optional(), product_ids: z.array(z.number().int()).optional(), product_category_ids: z.array(z.number().int()).optional(), usage_limit: z.number().int().nullable().optional(), usage_limit_per_user: z.number().int().nullable().optional(), status: z.enum(['publish', 'draft']).optional() }
  s.registerTool('create_coupon', { title: 'Create coupon', description: 'Create a coupon.', inputSchema: { ...couponFields, code: z.string() }, annotations: RW }, wrap((a: any) => S.createCoupon(actor, a)))
  s.registerTool('update_coupon', { title: 'Update coupon', description: 'Patch a coupon.', inputSchema: { id, ...couponFields }, annotations: RW }, wrap((a: any) => S.updateCoupon(actor, a.id, a)))
  s.registerTool('delete_coupon', { title: 'Delete coupon', description: 'Delete a coupon.', inputSchema: { id }, annotations: DEL }, wrap((a: any) => S.deleteCoupon(actor, a.id)))

  // ------------------------------------------------------------ forms
  s.registerTool('list_forms', { title: 'List forms', description: 'List contact forms with submission counts.', inputSchema: {}, annotations: RO }, wrap(() => O.listForms()))
  s.registerTool('list_form_submissions', { title: 'List form submissions', description: 'List form submissions (contact form entries).', inputSchema: { form_id: z.number().int().optional(), status: z.enum(['all', 'new', 'read', 'spam', 'trash']).optional(), ...paging }, annotations: RO }, wrap((a: any) => O.listSubmissions(a)))
  s.registerTool('update_form_submission_status', { title: 'Mark submission', description: 'Set a submission status (new, read, spam, trash).', inputSchema: { id, status: z.enum(['new', 'read', 'spam', 'trash']) }, annotations: RW }, wrap((a: any) => O.setSubmissionStatus(actor, a.id, a.status)))

  // ------------------------------------------------------------ settings, menus, redirects, audit
  s.registerTool('get_settings', { title: 'Read site settings', description: 'Read site settings (site_name, site_logo, contact_phone, contact_email, contact_address, tracking, tracking_custom, page_on_front, …). Omit keys for all.', inputSchema: { keys: z.array(z.string()).optional() }, annotations: RO }, wrap((a: any) => O.getSettings(a.keys)))
  s.registerTool('update_setting', { title: 'Write a site setting', description: 'Set one setting (value is any JSON). E.g. key=site_name value="Kcasa 工富家飾"; key=contact_phone; key=tracking_custom value={enabled, head_html, body_html}.', inputSchema: { key: z.string(), value: z.any(), is_public: z.boolean().optional() }, annotations: RW }, wrap((a: any) => O.setSetting(actor, a.key, a.value, a.is_public)))
  s.registerTool('list_menus', { title: 'List menus', description: 'List navigation menus with their items.', inputSchema: {}, annotations: RO }, wrap(() => O.listMenus()))
  s.registerTool('save_menu_item', { title: 'Create/update menu item', description: 'Create (omit id; menu_id, title, url required) or update a menu item.', inputSchema: { id: id.optional(), menu_id: z.number().int().optional(), title: z.string().optional(), url: z.string().optional(), parent_id: z.number().int().nullable().optional(), position: z.number().int().optional(), target: z.string().nullable().optional() }, annotations: RW }, wrap((a: any) => O.saveMenuItem(actor, a.id || null, a)))
  s.registerTool('delete_menu_item', { title: 'Delete menu item', description: 'Delete a menu item (and its children).', inputSchema: { id }, annotations: DEL }, wrap((a: any) => O.deleteMenuItem(actor, a.id)))
  s.registerTool('list_redirects', { title: 'List redirects', description: 'List URL redirects (search source/target).', inputSchema: { search: z.string().optional(), kind: z.string().optional(), ...paging }, annotations: RO }, wrap((a: any) => O.listRedirects(a)))
  s.registerTool('save_redirect', { title: 'Create/update redirect', description: 'Create (omit id) or update a redirect.', inputSchema: { id: id.optional(), source_path: z.string().optional(), target: z.string().optional(), status_code: z.union([z.literal(301), z.literal(302), z.literal(307), z.literal(308), z.literal(410)]).optional(), enabled: z.boolean().optional() }, annotations: RW }, wrap((a: any) => O.saveRedirect(actor, a.id || null, a)))
  s.registerTool('delete_redirect', { title: 'Delete redirect', description: 'Delete a redirect.', inputSchema: { id }, annotations: DEL }, wrap((a: any) => O.deleteRedirect(actor, a.id)))
  s.registerTool('list_audit_log', { title: 'Read audit log', description: 'Read the audit trail of admin / MCP writes.', inputSchema: { actor: z.string().optional(), entity_type: z.string().optional(), entity_id: z.string().optional(), via: z.enum(['admin', 'mcp', 'system', 'import', 'storefront']).optional(), ...paging }, annotations: RO }, wrap((a: any) => O.listAudit(a)))

  return s
}
