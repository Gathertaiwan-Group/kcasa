-- Kcasa 工富家飾 (kcasa.pro) — WordPress/WooCommerce → Supabase schema.
-- All objects live in schema site_kcasa. Legacy WordPress IDs are kept as primary keys
-- (or in wp_id columns) so private data (orders, customers, coupons...) can be matched later.
-- Writes go through the server (service_role). anon/authenticated may only read published content.

-- ---------- helpers ----------
create or replace function site_kcasa.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;

-- ---------- admins / audit ----------
create table if not exists site_kcasa.admins (
  user_id     uuid primary key,              -- auth.users.id
  email       text not null unique,
  role        text not null default 'admin' check (role in ('owner','admin','editor','shop_manager')),
  created_at  timestamptz not null default now()
);

create or replace function site_kcasa.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from site_kcasa.admins a where a.user_id = (select auth.uid()));
$$;
revoke all on function site_kcasa.is_admin() from public;
grant execute on function site_kcasa.is_admin() to anon, authenticated, service_role;

create table if not exists site_kcasa.audit_log (
  id          bigint generated always as identity primary key,
  actor       text not null,                  -- admin email / 'mcp' / 'import'
  actor_id    uuid,
  via         text not null default 'admin' check (via in ('admin','mcp','import','system','storefront')),
  action      text not null,                  -- e.g. product.update
  entity_type text not null,
  entity_id   text,
  before      jsonb,
  after       jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists audit_log_entity_idx on site_kcasa.audit_log (entity_type, entity_id);
create index if not exists audit_log_created_idx on site_kcasa.audit_log (created_at desc);

-- ---------- site settings (wp_options-like) ----------
create table if not exists site_kcasa.settings (
  key         text primary key,
  value       jsonb not null,
  is_public   boolean not null default true,  -- private ones (plugin/api settings) hidden from anon
  source      text,                           -- where the value came from (rest/root.json, features.json, db...)
  updated_at  timestamptz not null default now()
);

-- ---------- authors (wp_users public profile) ----------
create table if not exists site_kcasa.authors (
  id           bigint primary key,            -- wp user ID
  slug         text not null unique,          -- user_nicename (author archive /author/<slug>/)
  display_name text not null,
  description  text not null default '',
  url          text not null default '',
  avatar_url   text,
  auth_user_id uuid,                          -- optional link to a Supabase auth user
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------- media (attachments) ----------
create table if not exists site_kcasa.media (
  id            bigint primary key,           -- wp attachment ID
  slug          text not null,
  title         text not null default '',
  alt_text      text not null default '',
  caption_html  text not null default '',
  description_html text not null default '',
  media_type    text not null default 'image', -- image | file
  mime_type     text not null,                 -- mime type of stored file
  orig_mime_type text,                         -- mime type on old site
  storage_path  text,                          -- key in bucket site-kcasa (null = not yet available)
  url           text,                          -- public URL of stored file
  old_url       text not null,                 -- original source_url on kcasa.pro
  width         int,
  height        int,
  filesize      bigint,
  orig_width    int,
  orig_height   int,
  orig_filesize bigint,
  sha1          text,                          -- sha1 of the original download (dedup)
  author_id     bigint references site_kcasa.authors(id) on delete set null,
  parent_id     bigint,                        -- post/product the attachment is attached to
  status        text not null default 'inherit',
  is_private    boolean not null default false,
  published_at  timestamptz,
  modified_at   timestamptz,
  meta          jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists media_author_idx on site_kcasa.media (author_id);
create index if not exists media_parent_idx on site_kcasa.media (parent_id);
create index if not exists media_slug_idx on site_kcasa.media (slug);

-- every old URL (original, -scaled, -WxH thumbnails, url-encoded variants) → new URL
create table if not exists site_kcasa.media_url_map (
  old_url     text primary key,
  new_url     text not null,
  media_id    bigint references site_kcasa.media(id) on delete cascade,
  kind        text not null default 'original' check (kind in ('original','scaled','size','alias')),
  created_at  timestamptz not null default now()
);
create index if not exists media_url_map_media_idx on site_kcasa.media_url_map (media_id);

-- ---------- taxonomy (wp_terms + wp_term_taxonomy) ----------
-- taxonomy: category | post_tag | product_cat | product_tag | product_brand | pa_<attribute> | nav_menu ...
create table if not exists site_kcasa.terms (
  id          bigint primary key,             -- wp term_id
  taxonomy    text not null,
  name        text not null,
  slug        text not null,                  -- as used in the old URL (may be percent-encoded)
  description text not null default '',
  parent_id   bigint references site_kcasa.terms(id) on delete set null,
  count       int not null default 0,
  menu_order  int not null default 0,
  image_id    bigint references site_kcasa.media(id) on delete set null,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (taxonomy, slug)
);
create index if not exists terms_parent_idx on site_kcasa.terms (parent_id);
create index if not exists terms_image_idx on site_kcasa.terms (image_id);

-- ---------- posts / pages / custom post types (wp_posts) ----------
-- post_type: post | page | wp_block | wp_navigation | astra-advanced-hook | elementor_library | <any CPT>
create table if not exists site_kcasa.posts (
  id               bigint primary key,        -- wp post ID
  post_type        text not null,
  slug             text not null,             -- post_name (may be percent-encoded, as in old URL)
  path             text,                      -- old URL path, e.g. /services/ (kept for SEO)
  title            text not null default '',
  content_html     text not null default '',  -- rendered HTML, old URLs rewritten
  excerpt_html     text not null default '',
  status           text not null default 'publish' check (status in ('publish','draft','pending','private','future','trash','inherit')),
  author_id        bigint references site_kcasa.authors(id) on delete set null,
  featured_media_id bigint references site_kcasa.media(id) on delete set null,
  parent_id        bigint references site_kcasa.posts(id) on delete set null,
  menu_order       int not null default 0,
  template         text not null default '',
  format           text not null default 'standard',
  sticky           boolean not null default false,
  comment_status   text not null default 'closed',
  ping_status      text not null default 'closed',
  password_protected boolean not null default false,
  builder          text,                      -- elementor | stackable | gutenberg
  seo              jsonb not null default '{}'::jsonb,  -- Rank Math title/description/canonical/og
  meta             jsonb not null default '{}'::jsonb,
  published_at     timestamptz,
  modified_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (post_type, slug)
);
create index if not exists posts_type_status_idx on site_kcasa.posts (post_type, status, published_at desc);
create index if not exists posts_author_idx on site_kcasa.posts (author_id);
create index if not exists posts_featured_idx on site_kcasa.posts (featured_media_id);
create index if not exists posts_parent_idx on site_kcasa.posts (parent_id);
create index if not exists posts_path_idx on site_kcasa.posts (path);

-- ---------- comments (wp_comments; product reviews have rating) ----------
create table if not exists site_kcasa.comments (
  id            bigint primary key,           -- wp comment ID (new ones continue the sequence)
  post_id       bigint,                       -- posts.id or products.id
  object_type   text not null default 'post' check (object_type in ('post','product')),
  parent_id     bigint references site_kcasa.comments(id) on delete cascade,
  author_name   text not null default '',
  author_email  text,                         -- private (column not granted to anon)
  author_url    text not null default '',
  author_ip     inet,                         -- private
  user_id       bigint,
  content_html  text not null default '',
  rating        smallint check (rating between 1 and 5),
  comment_type  text not null default 'comment', -- comment | review | pingback
  status        text not null default 'hold' check (status in ('approved','hold','spam','trash')),
  verified_owner boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists comments_post_idx on site_kcasa.comments (object_type, post_id, status);
create index if not exists comments_parent_idx on site_kcasa.comments (parent_id);
create sequence if not exists site_kcasa.comments_id_seq start 1000000 owned by site_kcasa.comments.id;
alter table site_kcasa.comments alter column id set default nextval('site_kcasa.comments_id_seq');

-- ---------- products (WooCommerce) ----------
create table if not exists site_kcasa.products (
  id                bigint primary key,       -- wp product ID
  slug              text not null unique,
  name              text not null,
  type              text not null default 'simple' check (type in ('simple','variable','grouped','external')),
  status            text not null default 'publish' check (status in ('publish','draft','pending','private','trash')),
  featured          boolean not null default false,
  catalog_visibility text not null default 'visible',
  sku               text not null default '',
  description_html  text not null default '',
  short_description_html text not null default '',
  -- prices (TWD, minor unit 0). For variable products these are the min of variations.
  regular_price     numeric(12,2),
  sale_price        numeric(12,2),
  price             numeric(12,2),
  price_min         numeric(12,2),
  price_max         numeric(12,2),
  sale_starts_at    timestamptz,
  sale_ends_at      timestamptz,
  currency          text not null default 'TWD',
  tax_status        text not null default 'taxable',
  tax_class         text not null default '',
  -- inventory
  manage_stock      boolean not null default false,
  stock_quantity    int,
  stock_status      text not null default 'instock' check (stock_status in ('instock','outofstock','onbackorder')),
  backorders        text not null default 'no',
  low_stock_amount  int,
  sold_individually boolean not null default false,
  min_purchase_qty  int not null default 1,
  max_purchase_qty  int,
  purchasable       boolean not null default true,
  -- shipping
  weight            numeric(10,3),
  length            numeric(10,2),
  width             numeric(10,2),
  height            numeric(10,2),
  shipping_class    text not null default '',
  -- media
  featured_media_id bigint references site_kcasa.media(id) on delete set null,
  gallery_media_ids bigint[] not null default '{}',
  -- misc
  average_rating    numeric(3,2) not null default 0,
  review_count      int not null default 0,
  total_sales       int not null default 0,
  menu_order        int not null default 0,
  reviews_allowed   boolean not null default true,
  external_url      text,
  button_text       text,
  upsell_ids        bigint[] not null default '{}',
  cross_sell_ids    bigint[] not null default '{}',
  path              text,                     -- /product/<slug>/
  seo               jsonb not null default '{}'::jsonb,
  meta              jsonb not null default '{}'::jsonb,
  published_at      timestamptz,
  modified_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists products_status_idx on site_kcasa.products (status, menu_order);
create index if not exists products_featured_media_idx on site_kcasa.products (featured_media_id);

-- global attributes (wc_attribute_taxonomies); terms live in site_kcasa.terms with taxonomy = 'pa_' || slug
create table if not exists site_kcasa.product_attributes (
  id           bigint primary key,            -- wc attribute_id
  name         text not null,
  slug         text not null unique,          -- taxonomy without the pa_ prefix
  taxonomy     text not null unique,          -- pa_<slug>
  type         text not null default 'select',
  order_by     text not null default 'menu_order',
  has_archives boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- attributes attached to a product (_product_attributes meta). attribute_id null = custom (local) attribute
create table if not exists site_kcasa.product_attribute_values (
  id                 bigint generated always as identity primary key,
  product_id         bigint not null references site_kcasa.products(id) on delete cascade,
  attribute_id       bigint references site_kcasa.product_attributes(id) on delete set null,
  name               text not null,
  options            text[] not null default '{}',
  term_ids           bigint[] not null default '{}',
  position           int not null default 0,
  visible            boolean not null default true,
  used_for_variations boolean not null default false,
  unique (product_id, name)
);
create index if not exists pav_attribute_idx on site_kcasa.product_attribute_values (attribute_id);

create table if not exists site_kcasa.product_variations (
  id               bigint primary key,        -- wp variation post ID
  product_id       bigint not null references site_kcasa.products(id) on delete cascade,
  sku              text not null default '',
  attributes       jsonb not null default '[]'::jsonb,  -- [{name, value}] ; value null = "any"
  description_html text not null default '',
  status           text not null default 'publish' check (status in ('publish','private','draft','trash')),
  regular_price    numeric(12,2),
  sale_price       numeric(12,2),
  price            numeric(12,2),
  sale_starts_at   timestamptz,
  sale_ends_at     timestamptz,
  manage_stock     boolean not null default false,
  stock_quantity   int,
  stock_status     text not null default 'instock' check (stock_status in ('instock','outofstock','onbackorder')),
  backorders       text not null default 'no',
  weight           numeric(10,3),
  length           numeric(10,2),
  width            numeric(10,2),
  height           numeric(10,2),
  image_id         bigint references site_kcasa.media(id) on delete set null,
  menu_order       int not null default 0,
  purchasable      boolean not null default true,
  meta             jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists variations_product_idx on site_kcasa.product_variations (product_id, menu_order);
create index if not exists variations_image_idx on site_kcasa.product_variations (image_id);

-- object ↔ term (wp_term_relationships) for posts and products
create table if not exists site_kcasa.term_relationships (
  object_type text not null check (object_type in ('post','product','media')),
  object_id   bigint not null,
  term_id     bigint not null references site_kcasa.terms(id) on delete cascade,
  term_order  int not null default 0,
  primary key (object_type, object_id, term_id)
);
create index if not exists term_rel_term_idx on site_kcasa.term_relationships (term_id);

-- ---------- menus ----------
create table if not exists site_kcasa.menus (
  id         bigint primary key,              -- wp nav_menu term_id / wp_navigation post id
  name       text not null,
  slug       text not null unique,
  location   text,                            -- primary | mobile_menu | footer_menu ...
  source     text,                            -- wp_navigation | live_dom | db
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists site_kcasa.menu_items (
  id          bigint generated by default as identity primary key,
  menu_id     bigint not null references site_kcasa.menus(id) on delete cascade,
  parent_id   bigint references site_kcasa.menu_items(id) on delete cascade,
  wp_id       bigint,                          -- nav_menu_item post ID once DB is available
  title       text not null,
  url         text not null,                   -- new relative URL
  object_type text,                            -- page | category | product_cat | custom
  object_id   bigint,
  target      text,
  css_classes text not null default '',
  position    int not null default 0
);
create index if not exists menu_items_menu_idx on site_kcasa.menu_items (menu_id, position);
create index if not exists menu_items_parent_idx on site_kcasa.menu_items (parent_id);

-- ---------- customers / carts / orders / coupons (filled later from DB backup) ----------
create table if not exists site_kcasa.customers (
  id            bigint primary key,           -- wp user ID (guest customers get ids from the sequence)
  auth_user_id  uuid unique,
  email         text not null,
  username      text,
  first_name    text not null default '',
  last_name     text not null default '',
  display_name  text not null default '',
  role          text not null default 'customer',
  billing       jsonb not null default '{}'::jsonb,  -- first_name,last_name,company,address_1,address_2,city,state,postcode,country,email,phone
  shipping      jsonb not null default '{}'::jsonb,
  is_paying     boolean not null default false,
  orders_count  int not null default 0,
  total_spent   numeric(12,2) not null default 0,
  meta          jsonb not null default '{}'::jsonb,
  registered_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists customers_email_idx on site_kcasa.customers (lower(email));
create sequence if not exists site_kcasa.customers_id_seq start 1000000 owned by site_kcasa.customers.id;
alter table site_kcasa.customers alter column id set default nextval('site_kcasa.customers_id_seq');

create table if not exists site_kcasa.carts (
  id          uuid primary key default gen_random_uuid(),
  session_key text not null unique,            -- opaque cookie token
  customer_id bigint references site_kcasa.customers(id) on delete set null,
  coupon_codes text[] not null default '{}',
  shipping_method text,
  currency    text not null default 'TWD',
  expires_at  timestamptz not null default now() + interval '14 days',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists carts_customer_idx on site_kcasa.carts (customer_id);
create index if not exists carts_expires_idx on site_kcasa.carts (expires_at);
create table if not exists site_kcasa.cart_items (
  id           bigint generated always as identity primary key,
  cart_id      uuid not null references site_kcasa.carts(id) on delete cascade,
  product_id   bigint not null references site_kcasa.products(id) on delete cascade,
  variation_id bigint references site_kcasa.product_variations(id) on delete cascade,
  quantity     int not null check (quantity > 0),
  attributes   jsonb not null default '{}'::jsonb,
  unit_price   numeric(12,2),                   -- snapshot at add time (recomputed at checkout)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists cart_items_cart_idx on site_kcasa.cart_items (cart_id);
create index if not exists cart_items_product_idx on site_kcasa.cart_items (product_id);
create index if not exists cart_items_variation_idx on site_kcasa.cart_items (variation_id);

create table if not exists site_kcasa.orders (
  id                  bigint primary key,       -- wp order ID (new orders continue from the sequence)
  order_key           text not null unique default ('wc_order_' || replace(gen_random_uuid()::text,'-','')),
  order_number        text,
  status              text not null default 'pending' check (status in ('pending','processing','on-hold','completed','cancelled','refunded','failed','checkout-draft','trash')),
  currency            text not null default 'TWD',
  customer_id         bigint references site_kcasa.customers(id) on delete set null,
  billing             jsonb not null default '{}'::jsonb,
  shipping            jsonb not null default '{}'::jsonb,
  payment_method      text not null default '',
  payment_method_title text not null default '',
  transaction_id      text not null default '',
  shipping_method     text,
  subtotal            numeric(12,2) not null default 0,
  discount_total      numeric(12,2) not null default 0,
  shipping_total      numeric(12,2) not null default 0,
  fee_total           numeric(12,2) not null default 0,
  tax_total           numeric(12,2) not null default 0,
  total               numeric(12,2) not null default 0,
  prices_include_tax  boolean not null default true,
  customer_note       text not null default '',
  customer_ip         inet,
  customer_user_agent text,
  created_via         text not null default 'checkout',
  coupon_codes        text[] not null default '{}',
  meta                jsonb not null default '{}'::jsonb,   -- invoice / logistics (woomp) etc.
  created_at          timestamptz not null default now(),
  paid_at             timestamptz,
  completed_at        timestamptz,
  updated_at          timestamptz not null default now()
);
create index if not exists orders_customer_idx on site_kcasa.orders (customer_id);
create index if not exists orders_status_idx on site_kcasa.orders (status, created_at desc);
create sequence if not exists site_kcasa.orders_id_seq start 100000 owned by site_kcasa.orders.id;
alter table site_kcasa.orders alter column id set default nextval('site_kcasa.orders_id_seq');

create table if not exists site_kcasa.order_items (
  id           bigint primary key,              -- woocommerce_order_items.order_item_id
  order_id     bigint not null references site_kcasa.orders(id) on delete cascade,
  item_type    text not null default 'line_item' check (item_type in ('line_item','shipping','fee','coupon','tax')),
  name         text not null,
  product_id   bigint references site_kcasa.products(id) on delete set null,
  variation_id bigint references site_kcasa.product_variations(id) on delete set null,
  sku          text,
  quantity     int not null default 1,
  subtotal     numeric(12,2) not null default 0,
  subtotal_tax numeric(12,2) not null default 0,
  total        numeric(12,2) not null default 0,
  total_tax    numeric(12,2) not null default 0,
  meta         jsonb not null default '{}'::jsonb,  -- variation attributes, method_id, coupon code...
  created_at   timestamptz not null default now()
);
create index if not exists order_items_order_idx on site_kcasa.order_items (order_id);
create index if not exists order_items_product_idx on site_kcasa.order_items (product_id);
create index if not exists order_items_variation_idx on site_kcasa.order_items (variation_id);
create sequence if not exists site_kcasa.order_items_id_seq start 1000000 owned by site_kcasa.order_items.id;
alter table site_kcasa.order_items alter column id set default nextval('site_kcasa.order_items_id_seq');

create table if not exists site_kcasa.order_notes (
  id          bigint generated by default as identity primary key,
  order_id    bigint not null references site_kcasa.orders(id) on delete cascade,
  content     text not null,
  is_customer_note boolean not null default false,
  added_by    text,
  created_at  timestamptz not null default now()
);
create index if not exists order_notes_order_idx on site_kcasa.order_notes (order_id);

create table if not exists site_kcasa.coupons (
  id                    bigint primary key,      -- wp shop_coupon post ID
  code                  text not null,
  description           text not null default '',
  status                text not null default 'publish',
  discount_type         text not null default 'fixed_cart' check (discount_type in ('percent','fixed_cart','fixed_product')),
  amount                numeric(12,2) not null default 0,
  free_shipping         boolean not null default false,
  expires_at            timestamptz,
  minimum_amount        numeric(12,2),
  maximum_amount        numeric(12,2),
  individual_use        boolean not null default false,
  exclude_sale_items    boolean not null default false,
  product_ids           bigint[] not null default '{}',
  excluded_product_ids  bigint[] not null default '{}',
  product_category_ids  bigint[] not null default '{}',
  excluded_category_ids bigint[] not null default '{}',
  email_restrictions    text[] not null default '{}',
  usage_limit           int,
  usage_limit_per_user  int,
  limit_usage_to_x_items int,
  usage_count           int not null default 0,
  used_by               text[] not null default '{}',
  meta                  jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index if not exists coupons_code_idx on site_kcasa.coupons (lower(code));
create sequence if not exists site_kcasa.coupons_id_seq start 1000000 owned by site_kcasa.coupons.id;
alter table site_kcasa.coupons alter column id set default nextval('site_kcasa.coupons_id_seq');

-- quantity / bulk discount rules (no plugin detected on live site; table ready for DB import or new rules)
create table if not exists site_kcasa.quantity_discount_rules (
  id            bigint generated by default as identity primary key,
  title         text not null,
  enabled       boolean not null default true,
  priority      int not null default 10,
  applies_to    text not null default 'all' check (applies_to in ('all','products','categories')),
  product_ids   bigint[] not null default '{}',
  category_ids  bigint[] not null default '{}',
  min_qty       int not null check (min_qty > 0),
  max_qty       int,
  discount_type text not null default 'percent' check (discount_type in ('percent','fixed_per_item','fixed_price')),
  amount        numeric(12,2) not null,
  starts_at     timestamptz,
  ends_at       timestamptz,
  meta          jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- shipping (WooCommerce shipping zones/methods; observed on cart: local_pickup:1, flat_rate:2)
create table if not exists site_kcasa.shipping_zones (
  id         bigint primary key,
  name       text not null,
  regions    jsonb not null default '[]'::jsonb,
  zone_order int not null default 0
);
create table if not exists site_kcasa.shipping_methods (
  id          bigint primary key,               -- instance_id
  zone_id     bigint not null references site_kcasa.shipping_zones(id) on delete cascade,
  method_id   text not null,                    -- flat_rate | local_pickup | free_shipping
  title       text not null,
  cost        numeric(12,2) not null default 0,
  enabled     boolean not null default true,
  method_order int not null default 0,
  settings    jsonb not null default '{}'::jsonb
);
create index if not exists shipping_methods_zone_idx on site_kcasa.shipping_methods (zone_id);

-- ---------- forms ----------
create table if not exists site_kcasa.forms (
  id         bigint primary key,                -- wpforms form ID
  title      text not null,
  slug       text not null unique,
  plugin     text not null default 'wpforms',
  page_path  text,                              -- page that embeds the form
  fields     jsonb not null default '[]'::jsonb,
  settings   jsonb not null default '{}'::jsonb,  -- notifications/confirmation (private parts filled later)
  status     text not null default 'publish',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists site_kcasa.form_submissions (
  id         bigint generated by default as identity primary key,
  form_id    bigint not null references site_kcasa.forms(id) on delete cascade,
  wp_entry_id bigint,
  data       jsonb not null,
  status     text not null default 'new' check (status in ('new','read','spam','trash')),
  ip         inet,
  user_agent text,
  page_url   text,
  created_at timestamptz not null default now()
);
create index if not exists form_submissions_form_idx on site_kcasa.form_submissions (form_id, created_at desc);

-- ---------- redirects / old URL inventory ----------
create table if not exists site_kcasa.redirects (
  id          bigint generated always as identity primary key,
  source_path text not null unique,              -- old path (as requested, percent-encoded)
  target      text not null,
  status_code smallint not null default 301 check (status_code in (301,302,307,308,410)),
  kind        text not null default 'manual',    -- attachment | manual | legacy
  enabled     boolean not null default true,
  hits        bigint not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- every public URL of the old site and what serves it now (SEO parity checklist)
create table if not exists site_kcasa.url_inventory (
  path        text primary key,
  old_url     text not null,
  object_type text,                              -- page | post | product | term | author | archive | other
  object_id   bigint,
  in_sitemap  boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ---------- updated_at triggers ----------
do $$
declare t text;
begin
  foreach t in array array['settings','authors','media','terms','posts','comments','products','product_attributes',
    'product_variations','menus','customers','carts','cart_items','orders','coupons','quantity_discount_rules',
    'forms','redirects']
  loop
    execute format('drop trigger if exists set_updated_at on site_kcasa.%I', t);
    execute format('create trigger set_updated_at before update on site_kcasa.%I for each row execute function site_kcasa.set_updated_at()', t);
  end loop;
end $$;

-- ---------- convenience views (security_invoker → RLS of base tables applies) ----------
create or replace view site_kcasa.pages with (security_invoker = true) as
  select * from site_kcasa.posts where post_type = 'page';
create or replace view site_kcasa.articles with (security_invoker = true) as
  select * from site_kcasa.posts where post_type = 'post';
create or replace view site_kcasa.product_categories with (security_invoker = true) as
  select * from site_kcasa.terms where taxonomy = 'product_cat';
create or replace view site_kcasa.product_tags with (security_invoker = true) as
  select * from site_kcasa.terms where taxonomy = 'product_tag';
create or replace view site_kcasa.categories with (security_invoker = true) as
  select * from site_kcasa.terms where taxonomy = 'category';
create or replace view site_kcasa.tags with (security_invoker = true) as
  select * from site_kcasa.terms where taxonomy = 'post_tag';
