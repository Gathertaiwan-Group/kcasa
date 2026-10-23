-- Admin (/admin) + MCP (/api/mcp) support for site_kcasa.
-- * id sequences so content created after the migration gets ids above every imported WordPress id
--   (posts/products/variations/media share one sequence, like wp_posts.ID does)
-- * order refunds table (WooCommerce shop_order_refund), empty until the DB import
-- * settings seeds used by /admin/settings (originals are kept so the storefront can swap captured values)

create sequence if not exists site_kcasa.wp_post_id_seq start 1000000;
alter table site_kcasa.posts alter column id set default nextval('site_kcasa.wp_post_id_seq');
alter table site_kcasa.products alter column id set default nextval('site_kcasa.wp_post_id_seq');
alter table site_kcasa.product_variations alter column id set default nextval('site_kcasa.wp_post_id_seq');
alter table site_kcasa.media alter column id set default nextval('site_kcasa.wp_post_id_seq');
alter table site_kcasa.forms alter column id set default nextval('site_kcasa.wp_post_id_seq');

create sequence if not exists site_kcasa.wp_term_id_seq start 1000000;
alter table site_kcasa.terms alter column id set default nextval('site_kcasa.wp_term_id_seq');
alter table site_kcasa.menus alter column id set default nextval('site_kcasa.wp_term_id_seq');

create sequence if not exists site_kcasa.product_attributes_id_seq start 1000;
alter table site_kcasa.product_attributes alter column id set default nextval('site_kcasa.product_attributes_id_seq');

-- WooCommerce refunds (shop_order_refund posts)
create table if not exists site_kcasa.order_refunds (
  id          bigint primary key default nextval('site_kcasa.wp_post_id_seq'),
  order_id    bigint not null references site_kcasa.orders(id) on delete cascade,
  amount      numeric(12,2) not null default 0,
  reason      text not null default '',
  refunded_by text,
  line_items  jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists order_refunds_order_idx on site_kcasa.order_refunds (order_id);
alter table site_kcasa.order_refunds enable row level security;
alter table site_kcasa.order_refunds force row level security;
revoke all on site_kcasa.order_refunds from anon;
grant select on site_kcasa.order_refunds to authenticated;
grant all on site_kcasa.order_refunds to service_role;
drop policy if exists admin_read on site_kcasa.order_refunds;
create policy admin_read on site_kcasa.order_refunds for select to authenticated using ((select site_kcasa.is_admin()));

grant usage, select on all sequences in schema site_kcasa to service_role;

-- audit lookups by actor
create index if not exists audit_log_actor_idx on site_kcasa.audit_log (actor, created_at desc);
create index if not exists form_submissions_status_idx on site_kcasa.form_submissions (status);

-- settings used by /admin/settings ------------------------------------------------------------------
-- keep the values captured from kcasa.pro as "original" so the storefront can replace them in the
-- captured Astra chrome when an admin changes them
update site_kcasa.settings
   set value = value || jsonb_build_object('original_url', value->>'url')
 where key = 'site_logo' and not (value ? 'original_url');

update site_kcasa.settings
   set value = value || jsonb_build_object('original', jsonb_build_object(
         'gtm', value->'gtm'->>0,
         'google_tag', value->'google_tag'->'ids'->>0,
         'google_ads', value->'google_ads'->'ids'->>0,
         'adsense', value->'adsense'->>'publisher_id'))
 where key = 'tracking' and not (value ? 'original');

insert into site_kcasa.settings (key, value, is_public, source) values
  ('site_name_original', '"Kcasa 工富家飾"', true, 'rest/root.json'),
  ('contact_phone_original', '"02-2796-8508"', true, 'html'),
  ('contact_email', '""', true, 'admin'),
  ('contact_address', '""', true, 'admin'),
  ('contact_line', '"https://lin.ee/sCZcWPv"', true, 'features.json'),
  ('tracking_custom', '{"enabled": true, "head_html": "", "body_html": ""}', true, 'admin')
on conflict (key) do nothing;

-- unsaved edits shown by the admin "預覽" button (short-lived, admin only, never public)
create table if not exists site_kcasa.previews (
  token       uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('post','product')),
  object_id   bigint not null,
  data        jsonb not null,
  created_by  text,
  created_at  timestamptz not null default now()
);
create index if not exists previews_created_idx on site_kcasa.previews (created_at);
alter table site_kcasa.previews enable row level security;
alter table site_kcasa.previews force row level security;
revoke all on site_kcasa.previews from anon, authenticated;
grant all on site_kcasa.previews to service_role;
