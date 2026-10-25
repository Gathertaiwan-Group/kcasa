-- Private data import (WordPress DB backup → site_kcasa), schema part only.
-- The data itself is loaded by a local one-off script that reads the DB backup outside the repo;
-- no customer / order data is ever stored in this repository.

-- ---------- columns used to keep imports idempotent / traceable ----------
alter table site_kcasa.customers add column if not exists wc_customer_id bigint;
create unique index if not exists customers_wc_customer_idx on site_kcasa.customers (wc_customer_id);

alter table site_kcasa.order_notes add column if not exists wp_comment_id bigint;
create unique index if not exists order_notes_wp_comment_idx on site_kcasa.order_notes (wp_comment_id);

alter table site_kcasa.form_submissions add column if not exists meta jsonb not null default '{}'::jsonb;
alter table site_kcasa.form_submissions add column if not exists wp_log_id bigint;
create unique index if not exists form_submissions_wp_log_idx on site_kcasa.form_submissions (wp_log_id);

alter table site_kcasa.comments add column if not exists author_user_agent text;
alter table site_kcasa.comments add column if not exists meta jsonb not null default '{}'::jsonb;

-- ---------- RLS: customers / orders / carts / coupons / submissions are service-role only ----------
-- (previously site admins could read them with an authenticated JWT; /admin and /api/mcp use the
--  service role, so nothing needs that path — anon and authenticated now get no access at all)
do $$
declare t text;
begin
  foreach t in array array['customers','orders','order_items','order_notes','order_refunds','carts','cart_items',
    'coupons','form_submissions'] loop
    execute format('revoke all on site_kcasa.%I from anon, authenticated', t);
    execute format('grant all on site_kcasa.%I to service_role', t);
    execute format('drop policy if exists admin_read on site_kcasa.%I', t);
    execute format('alter table site_kcasa.%I enable row level security', t);
    execute format('alter table site_kcasa.%I force row level security', t);
  end loop;
end $$;

-- private columns of comments stay hidden (column grants from the RLS migration); re-assert after the new columns
revoke select on site_kcasa.comments from anon, authenticated;
grant select (id, post_id, object_type, parent_id, author_name, author_url, user_id, content_html, rating,
  comment_type, status, verified_owner, created_at, updated_at) on site_kcasa.comments to anon, authenticated;
grant all on site_kcasa.comments to service_role;
