# Kcasa 工富家飾 — Next.js rebuild of kcasa.pro

WordPress (Astra + Elementor/Stackable + WooCommerce + Rank Math) rebuilt on Next.js App Router, data in
Supabase (schema `site_kcasa`, bucket `site-kcasa`).

## How the storefront renders

* `app/[[...slug]]/route.ts` answers every public URL with a complete HTML document (GET/HEAD/POST).
* `src/lib/router.ts` maps old WordPress permalinks → views: front page, pages, posts, `/category/…`,
  `/tag/…`, `/author/…`, `/?s=` search, `/shop/`, `/product-category/…`, `/product-tag/…`, `/product/…`,
  `/cart/`, `/checkout/` (+ `order-received`), `/my-account/…`, `/feed/`, `robots.txt`, Rank Math sitemaps,
  `?p=` / `?page_id=` / attachment pages / `/wp-content/uploads/…` → 301.
* `src/lib/legacy.ts` + `src/generated/legacy.json`: the theme/plugin CSS+JS and the Astra header/footer
  chrome captured from the old pages (`scripts/frontend/extract_legacy.py`). Menus, cart icon/count,
  mini-cart and the product-category widget are filled in from the database at render time.
* `src/lib/views/*`: the `#content` area (Astra / WooCommerce markup) rendered from Supabase rows.
* `src/lib/actions.ts`: form posts — add to cart, cart/coupons/shipping, checkout (creates a **pending**
  order, payment method「領取報價」, no payment gateway), my-account (Supabase Auth), reviews (held for
  moderation), WPForms contact form → `site_kcasa.form_submissions`.
* `app/api/wc/[endpoint]` — the WooCommerce AJAX endpoints the legacy scripts call (fragments, add_to_cart).
* `public/legacy/` — GPL theme/plugin assets fetched from the old site; `public/kc/` — small additions.

## Admin (`/admin`)

Supabase Auth login; only users listed in `site_kcasa.admins` get in (roles: owner / admin / editor / shop_manager).
`/wp-admin/` and `/wp-login.php` redirect here.

* Content: posts, pages, reusable blocks (wp_block) — WYSIWYG editor (iframe with the storefront's own CSS +
  HTML source tab), draft / pending / private / scheduled (`future`, published by the content loader when due) /
  publish, preview of unsaved edits (`site_kcasa.previews`), trash / restore / delete, categories & tags, SEO overrides.
* Shop: products (prices, sale schedule, stock, attributes, variations, gallery, categories/tags), orders (list, detail,
  status + notes, addresses), customers, coupons, quantity-discount rules.
* Media library: uploads become WebP (≤2000px, q80) via sharp; GIF/video/PDF kept as is; sha1 de-dup;
  large non-image files go straight to storage with a signed URL.
* Menus, form submissions (+ CSV export), site settings (name, logo, contact, tracking ids, custom head/body code —
  applied to the captured chrome in `applySiteSettings`), redirects, audit log.
* All writes: `src/lib/admin/*` (service role) → `site_kcasa.audit_log`, then `settings.content_version` is bumped so
  every instance reloads its content snapshot (checked at most every `SITE_VERSION_CHECK_MS`, default 3s).

## MCP (`/api/mcp`)

Streamable HTTP (stateless, JSON responses), `Authorization: Bearer $MCP_TOKEN`. 47 tools: content / products /
variations / price / stock / terms / media / orders / customers / coupons / forms / settings / menus / redirects /
audit log. New content defaults to draft; deletes go to trash unless `force: true`. Writes are audited with `via = 'mcp'`.

## Environment

| var | |
|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase (service role is server-only) |
| `SITE_URL` | canonical/OG base URL (default `https://kcasa.pro`) |
| `DISABLE_TRACKING=1` | drop GTM / GA4 / Ads / AdSense tags (local testing) |
| `SITE_CACHE_TTL_MS` | content cache TTL per instance (default 30000) |
| `MCP_TOKEN` | bearer token for `/api/mcp` (≥24 chars) |

## Scripts

* `scripts/frontend/extract_legacy.py <export> <repo> <work>` — rebuild `legacy.json` from HTML snapshots
* `scripts/frontend/fetch_assets.py <export> <repo>` — fetch theme/plugin CSS/JS into `public/legacy`
* `scripts/frontend/apply_frontend_data.py <export> <work>` — SEO / title flags / product tabs / menu ids → DB
* `scripts/frontend/visual_diff.js <export> <out> <base_url>` — screenshot + pixel diff vs. old screenshots
