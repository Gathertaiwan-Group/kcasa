-- RLS for site_kcasa: every table has RLS on.
-- Public content: anon/authenticated may read published rows only.
-- Private tables (customers, carts, orders, coupons, submissions, admins, audit_log ...): no anon access at all;
-- site admins (site_kcasa.admins) may read via authenticated JWT; all writes go through service_role (bypasses RLS).

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'site_kcasa' loop
    execute format('alter table site_kcasa.%I enable row level security', t);
    execute format('alter table site_kcasa.%I force row level security', t);
  end loop;
end $$;

-- privileges -------------------------------------------------------------
grant usage on schema site_kcasa to anon, authenticated, service_role;
grant all on all tables in schema site_kcasa to service_role;
grant all on all sequences in schema site_kcasa to service_role;
revoke insert, update, delete, truncate on all tables in schema site_kcasa from anon, authenticated;

-- public-content tables: readable
grant select on site_kcasa.settings, site_kcasa.authors, site_kcasa.media, site_kcasa.media_url_map,
  site_kcasa.terms, site_kcasa.posts, site_kcasa.products, site_kcasa.product_attributes,
  site_kcasa.product_attribute_values, site_kcasa.product_variations, site_kcasa.term_relationships,
  site_kcasa.menus, site_kcasa.menu_items, site_kcasa.shipping_zones, site_kcasa.shipping_methods,
  site_kcasa.forms, site_kcasa.redirects, site_kcasa.url_inventory, site_kcasa.quantity_discount_rules
  to anon, authenticated;
grant select on site_kcasa.pages, site_kcasa.articles, site_kcasa.product_categories, site_kcasa.product_tags,
  site_kcasa.categories, site_kcasa.tags to anon, authenticated;

-- comments: hide e-mail / IP columns from anon & authenticated (column-level grant)
revoke select on site_kcasa.comments from anon, authenticated;
grant select (id, post_id, object_type, parent_id, author_name, author_url, user_id, content_html, rating,
  comment_type, status, verified_owner, created_at, updated_at) on site_kcasa.comments to anon, authenticated;

-- private tables: anon gets nothing; authenticated may select (RLS limits to admins)
revoke all on site_kcasa.customers, site_kcasa.carts, site_kcasa.cart_items, site_kcasa.orders,
  site_kcasa.order_items, site_kcasa.order_notes, site_kcasa.coupons, site_kcasa.form_submissions,
  site_kcasa.admins, site_kcasa.audit_log from anon;
grant select on site_kcasa.customers, site_kcasa.carts, site_kcasa.cart_items, site_kcasa.orders,
  site_kcasa.order_items, site_kcasa.order_notes, site_kcasa.coupons, site_kcasa.form_submissions,
  site_kcasa.admins, site_kcasa.audit_log to authenticated;

-- policies ---------------------------------------------------------------
do $$
declare t text;
begin
  -- admin read on every table
  for t in select tablename from pg_tables where schemaname = 'site_kcasa' loop
    execute format('drop policy if exists admin_read on site_kcasa.%I', t);
    execute format('create policy admin_read on site_kcasa.%I for select to authenticated using ((select site_kcasa.is_admin()))', t);
  end loop;
  -- unconditional public read for reference tables
  foreach t in array array['authors','media_url_map','terms','product_attributes','term_relationships',
    'menus','menu_items','shipping_zones','shipping_methods','redirects','url_inventory'] loop
    execute format('drop policy if exists public_read on site_kcasa.%I', t);
    execute format('create policy public_read on site_kcasa.%I for select to anon, authenticated using (true)', t);
  end loop;
end $$;

drop policy if exists public_read on site_kcasa.settings;
create policy public_read on site_kcasa.settings for select to anon, authenticated using (is_public);

drop policy if exists public_read on site_kcasa.media;
create policy public_read on site_kcasa.media for select to anon, authenticated using (not is_private);

drop policy if exists public_read on site_kcasa.posts;
create policy public_read on site_kcasa.posts for select to anon, authenticated
  using (status = 'publish' and post_type <> 'wp_block');

drop policy if exists public_read on site_kcasa.products;
create policy public_read on site_kcasa.products for select to anon, authenticated
  using (status = 'publish' and catalog_visibility <> 'hidden');

drop policy if exists public_read on site_kcasa.product_variations;
create policy public_read on site_kcasa.product_variations for select to anon, authenticated
  using (status = 'publish' and exists (select 1 from site_kcasa.products p where p.id = product_id and p.status = 'publish'));

drop policy if exists public_read on site_kcasa.product_attribute_values;
create policy public_read on site_kcasa.product_attribute_values for select to anon, authenticated
  using (exists (select 1 from site_kcasa.products p where p.id = product_id and p.status = 'publish'));

drop policy if exists public_read on site_kcasa.comments;
create policy public_read on site_kcasa.comments for select to anon, authenticated using (status = 'approved');

drop policy if exists public_read on site_kcasa.forms;
create policy public_read on site_kcasa.forms for select to anon, authenticated using (status = 'publish');

drop policy if exists public_read on site_kcasa.quantity_discount_rules;
create policy public_read on site_kcasa.quantity_discount_rules for select to anon, authenticated
  using (enabled and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now()));
