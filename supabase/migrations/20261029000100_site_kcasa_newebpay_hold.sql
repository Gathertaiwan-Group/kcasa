-- NewebPay (藍新金流) hardening, schema site_kcasa only.
--  1. Stock hold (WooCommerce woocommerce_hold_stock_minutes = 60): a 藍新 order reserves its stock when it is
--     placed, inside one transaction with row locks, and is refused when stock is short. Payment converts the
--     hold (no second reduction); payment failure / 60-minute timeout / admin cancel releases it.
--  2. Flood guard: at most p_max_unpaid unpaid 藍新 orders per IP and per e-mail inside the hold window,
--     counted in the same transaction under advisory locks (no race between two concurrent checkouts).
--  3. One MerchantOrderNo per payment attempt (KC<id>_<n>), recorded atomically so Notify maps it back to the
--     order. Legacy numbers (KC<id>) already stored on orders are back-filled and keep working.

-- ---------------------------------------------------------------- tables
create table if not exists site_kcasa.stock_holds (
  id            bigint generated always as identity primary key,
  order_id      bigint not null references site_kcasa.orders(id) on delete cascade,
  product_id    bigint,          -- set when the product row carries the stock
  variation_id  bigint,          -- set when the variation row carries the stock
  quantity      int not null check (quantity > 0),
  state         text not null default 'held' check (state in ('held','converted','released')),
  created_at    timestamptz not null default now(),
  settled_at    timestamptz,
  check ((product_id is null) <> (variation_id is null))
);
create index if not exists stock_holds_order_idx on site_kcasa.stock_holds (order_id);
create index if not exists stock_holds_held_idx on site_kcasa.stock_holds (state) where state = 'held';
revoke all on site_kcasa.stock_holds from anon, authenticated;
grant all on site_kcasa.stock_holds to service_role;
alter table site_kcasa.stock_holds enable row level security;
alter table site_kcasa.stock_holds force row level security;

create table if not exists site_kcasa.newebpay_attempts (
  merchant_order_no text primary key check (merchant_order_no ~ '^[A-Za-z0-9_]{1,30}$'),
  order_id          bigint not null references site_kcasa.orders(id) on delete cascade,
  attempt           int not null,
  created_at        timestamptz not null default now(),
  unique (order_id, attempt)
);
revoke all on site_kcasa.newebpay_attempts from anon, authenticated;
grant all on site_kcasa.newebpay_attempts to service_role;
alter table site_kcasa.newebpay_attempts enable row level security;
alter table site_kcasa.newebpay_attempts force row level security;

-- legacy KC<id> numbers already handed to NewebPay
insert into site_kcasa.newebpay_attempts (merchant_order_no, order_id, attempt)
select o.meta->'newebpay'->>'merchant_order_no', o.id, 0
  from site_kcasa.orders o
 where o.payment_method = 'ry_newebpay_credit'
   and o.meta->'newebpay'->>'merchant_order_no' ~ '^[A-Za-z0-9_]{1,30}$'
on conflict do nothing;

create index if not exists orders_unpaid_np_idx on site_kcasa.orders (created_at)
  where payment_method = 'ry_newebpay_credit' and status = 'pending' and transaction_id = '';

-- ---------------------------------------------------------------- hold
-- Reserve stock for an order's line items. Returns {ok:true} or {ok:false, reason:'out_of_stock', short:[…]} /
-- {ok:false, reason:'too_many_unpaid'}; on refusal nothing is changed (the caller deletes the order).
create or replace function site_kcasa.order_hold_stock(p_order_id bigint, p_max_unpaid int default 3, p_window_minutes int default 60)
returns jsonb
language plpgsql
set search_path = site_kcasa, pg_temp
as $$
declare
  o       site_kcasa.orders%rowtype;
  v_email text;
  n       int;
  li      record;
  src     record;
  short   jsonb := '[]'::jsonb;
  todo    jsonb := '[]'::jsonb;
  t       jsonb;
begin
  select * into o from site_kcasa.orders where id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_order'); end if;
  if exists (select 1 from site_kcasa.stock_holds where order_id = p_order_id) then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  -- flood guard (ip lock always before e-mail lock → no lock-order cycle)
  v_email := lower(trim(coalesce(o.billing->>'email', '')));
  if o.customer_ip is not null then perform pg_advisory_xact_lock(hashtextextended('site_kcasa.hold.ip:' || host(o.customer_ip), 0)); end if;
  if v_email <> '' then perform pg_advisory_xact_lock(hashtextextended('site_kcasa.hold.email:' || v_email, 0)); end if;
  if p_max_unpaid is not null and o.payment_method = 'ry_newebpay_credit' then
    select count(*) into n
      from site_kcasa.orders x
     where x.id <> o.id
       and x.payment_method = 'ry_newebpay_credit' and x.status = 'pending' and x.transaction_id = ''
       and x.meta->>'stock_hold' = 'held'   -- only orders that passed this guard (set below, same lock)
       and x.created_at > now() - make_interval(mins => p_window_minutes)
       and ((o.customer_ip is not null and x.customer_ip = o.customer_ip)
            or (v_email <> '' and lower(trim(coalesce(x.billing->>'email', ''))) = v_email));
    if n >= p_max_unpaid then return jsonb_build_object('ok', false, 'reason', 'too_many_unpaid', 'unpaid', n); end if;
  end if;

  -- lock + check every stock row first (variations then products, by id → consistent lock order)
  for li in
    select i.product_id, i.variation_id, sum(i.quantity)::int as qty
      from site_kcasa.order_items i
     where i.order_id = p_order_id and i.item_type = 'line_item' and i.quantity > 0
     group by i.product_id, i.variation_id
     order by (i.variation_id is null), coalesce(i.variation_id, i.product_id)
  loop
    if li.variation_id is not null then
      select id, manage_stock, stock_quantity, backorders into src from site_kcasa.product_variations where id = li.variation_id for update;
      if found and src.manage_stock and src.stock_quantity is not null then
        if src.backorders = 'no' and src.stock_quantity < li.qty then
          short := short || jsonb_build_object('variation_id', li.variation_id, 'product_id', li.product_id, 'requested', li.qty, 'available', greatest(src.stock_quantity, 0));
        else
          todo := todo || jsonb_build_object('kind', 'v', 'id', li.variation_id, 'qty', li.qty);
        end if;
      end if;
    elsif li.product_id is not null then
      select id, manage_stock, stock_quantity, backorders into src from site_kcasa.products where id = li.product_id for update;
      if found and src.manage_stock and src.stock_quantity is not null then
        if src.backorders = 'no' and src.stock_quantity < li.qty then
          short := short || jsonb_build_object('product_id', li.product_id, 'requested', li.qty, 'available', greatest(src.stock_quantity, 0));
        else
          todo := todo || jsonb_build_object('kind', 'p', 'id', li.product_id, 'qty', li.qty);
        end if;
      end if;
    end if;
  end loop;
  if jsonb_array_length(short) > 0 then
    return jsonb_build_object('ok', false, 'reason', 'out_of_stock', 'short', short);
  end if;

  for t in select * from jsonb_array_elements(todo) loop
    if t->>'kind' = 'v' then
      update site_kcasa.product_variations
         set stock_quantity = stock_quantity - (t->>'qty')::int,
             stock_status = case when stock_quantity - (t->>'qty')::int <= 0 and backorders = 'no' then 'outofstock' else stock_status end
       where id = (t->>'id')::bigint;
      insert into site_kcasa.stock_holds (order_id, variation_id, quantity) values (p_order_id, (t->>'id')::bigint, (t->>'qty')::int);
    else
      update site_kcasa.products
         set stock_quantity = stock_quantity - (t->>'qty')::int,
             stock_status = case when stock_quantity - (t->>'qty')::int <= 0 and backorders = 'no' then 'outofstock' else stock_status end
       where id = (t->>'id')::bigint;
      insert into site_kcasa.stock_holds (order_id, product_id, quantity) values (p_order_id, (t->>'id')::bigint, (t->>'qty')::int);
    end if;
  end loop;
  update site_kcasa.orders set meta = meta || jsonb_build_object('stock_hold', 'held') where id = p_order_id;
  return jsonb_build_object('ok', true, 'held', jsonb_array_length(todo));
end $$;

-- ---------------------------------------------------------------- release
-- Give a hold's stock back. With p_new_status (failed / cancelled) it is the atomic "pending → p_new_status"
-- transition of an unpaid order and returns true only for the call that changed it. Without p_new_status
-- (admin already changed the status) it just releases whatever is still held and returns whether it did.
create or replace function site_kcasa.order_release_stock(p_order_id bigint, p_new_status text default null, p_meta jsonb default '{}'::jsonb)
returns boolean
language plpgsql
set search_path = site_kcasa, pg_temp
as $$
declare
  o  site_kcasa.orders%rowtype;
  h  record;
  released boolean := false;
begin
  if p_new_status is not null and p_new_status not in ('failed', 'cancelled') then raise exception 'bad status %', p_new_status; end if;
  select * into o from site_kcasa.orders where id = p_order_id for update;
  if not found then return false; end if;
  if p_new_status is not null and (o.status <> 'pending' or o.transaction_id <> '') then return false; end if;

  for h in select * from site_kcasa.stock_holds where order_id = p_order_id and state = 'held'
            order by (variation_id is null), coalesce(variation_id, product_id) loop
    if h.variation_id is not null then
      update site_kcasa.product_variations
         set stock_quantity = stock_quantity + h.quantity,
             stock_status = case when stock_status = 'outofstock' and stock_quantity + h.quantity > 0 then 'instock' else stock_status end
       where id = h.variation_id and stock_quantity is not null;
    else
      update site_kcasa.products
         set stock_quantity = stock_quantity + h.quantity,
             stock_status = case when stock_status = 'outofstock' and stock_quantity + h.quantity > 0 then 'instock' else stock_status end
       where id = h.product_id and stock_quantity is not null;
    end if;
    update site_kcasa.stock_holds set state = 'released', settled_at = now() where id = h.id;
    released := true;
  end loop;

  if p_new_status is not null then
    update site_kcasa.orders
       set status = p_new_status,
           meta = meta || jsonb_build_object('stock_hold', case when released then 'released' else coalesce(meta->>'stock_hold', 'none') end)
                       || case when p_meta = '{}'::jsonb then '{}'::jsonb
                               else jsonb_build_object('newebpay', coalesce(meta->'newebpay', '{}'::jsonb) || p_meta) end
     where id = p_order_id;
    return true;
  end if;
  if released then
    update site_kcasa.orders set meta = meta || jsonb_build_object('stock_hold', 'released') where id = p_order_id;
  end if;
  return released;
end $$;

-- ---------------------------------------------------------------- convert
-- Turn a hold into the final reduction and count total_sales once (meta.stock_reduced guards the count).
-- Admin marking a held order processing / completed / on-hold uses it; 領取報價 checkout calls it with
-- p_always = true right after the hold, so sales are counted even when no line manages stock.
drop function if exists site_kcasa.order_convert_hold(bigint);
create or replace function site_kcasa.order_convert_hold(p_order_id bigint, p_always boolean default false)
returns boolean
language plpgsql
set search_path = site_kcasa, pg_temp
as $$
declare
  o  site_kcasa.orders%rowtype;
  li record;
  had_hold boolean;
begin
  select * into o from site_kcasa.orders where id = p_order_id for update;
  if not found then return false; end if;
  had_hold := exists (select 1 from site_kcasa.stock_holds where order_id = p_order_id and state = 'held');
  if not had_hold and not p_always then return false; end if;
  if coalesce((o.meta->>'stock_reduced')::boolean, false) then return false; end if;
  update site_kcasa.stock_holds set state = 'converted', settled_at = now() where order_id = p_order_id and state = 'held';
  for li in select product_id, sum(quantity)::int q from site_kcasa.order_items
             where order_id = p_order_id and item_type = 'line_item' and product_id is not null group by product_id order by product_id loop
    update site_kcasa.products set total_sales = total_sales + li.q where id = li.product_id;
  end loop;
  update site_kcasa.orders
     set meta = meta || jsonb_build_object('stock_reduced', true) || case when had_hold then jsonb_build_object('stock_hold', 'converted') else '{}'::jsonb end
   where id = p_order_id;
  return true;
end $$;

-- ---------------------------------------------------------------- mark paid (replaces 20261028000100 version)
-- Same contract (true only for the single call that changed the order). A held order converts its hold
-- (no second reduction). An order whose hold was already released (paid after failure / timeout) reduces
-- stock now — the money is taken, so it cannot be refused — and leaves an order note if that oversells.
create or replace function site_kcasa.newebpay_mark_paid(p_order_id bigint, p_trade_no text, p_meta jsonb)
returns boolean
language plpgsql
set search_path = site_kcasa, pg_temp
as $$
declare
  hit bigint;
  li record;
  had_hold boolean;
  short text := '';
  left_qty int;
begin
  update site_kcasa.orders
     set status = 'processing',
         transaction_id = p_trade_no,
         paid_at = coalesce(paid_at, now()),
         meta = meta || jsonb_build_object('newebpay', coalesce(meta->'newebpay', '{}'::jsonb) || p_meta, 'stock_reduced', true)
   where id = p_order_id
     and payment_method = 'ry_newebpay_credit'
     and status in ('pending', 'failed', 'cancelled')
     and transaction_id = ''
     and coalesce((meta->>'stock_reduced')::boolean, false) = false
  returning id into hit;
  if hit is null then
    return false;
  end if;

  had_hold := exists (select 1 from site_kcasa.stock_holds where order_id = p_order_id and state = 'held');
  if had_hold then
    update site_kcasa.stock_holds set state = 'converted', settled_at = now() where order_id = p_order_id and state = 'held';
    update site_kcasa.orders set meta = meta || jsonb_build_object('stock_hold', 'converted') where id = p_order_id;
  else
    for li in select product_id, variation_id, sum(quantity)::int as quantity from site_kcasa.order_items
               where order_id = p_order_id and item_type = 'line_item' and quantity > 0
               group by product_id, variation_id
               order by (variation_id is null), coalesce(variation_id, product_id) loop
      left_qty := null;
      if li.variation_id is not null then
        update site_kcasa.product_variations
           set stock_quantity = stock_quantity - li.quantity,
               stock_status = case when stock_quantity - li.quantity <= 0 and backorders = 'no' then 'outofstock' else stock_status end
         where id = li.variation_id and manage_stock and stock_quantity is not null
        returning case when backorders = 'no' then stock_quantity end into left_qty;
      elsif li.product_id is not null then
        update site_kcasa.products
           set stock_quantity = stock_quantity - li.quantity,
               stock_status = case when stock_quantity - li.quantity <= 0 and backorders = 'no' then 'outofstock' else stock_status end
         where id = li.product_id and manage_stock and stock_quantity is not null
        returning case when backorders = 'no' then stock_quantity end into left_qty;
      end if;
      if left_qty is not null and left_qty < 0 then
        short := short || format('%s%s（庫存 %s）', case when short = '' then '' else '、' end,
                                 coalesce('商品 #' || li.product_id, '') || coalesce(' 款式 #' || li.variation_id, ''), left_qty);
      end if;
    end loop;
    if short <> '' then
      insert into site_kcasa.order_notes (order_id, content, is_customer_note, added_by)
      values (p_order_id, '注意：此訂單在預留庫存釋放後才付款成功，扣庫存後超賣：' || short || '。請確認出貨或聯繫顧客退款。', false, 'system');
    end if;
  end if;

  for li in select product_id, sum(quantity)::int q from site_kcasa.order_items
             where order_id = p_order_id and item_type = 'line_item' and product_id is not null group by product_id order by product_id loop
    update site_kcasa.products set total_sales = total_sales + li.q where id = li.product_id;
  end loop;
  return true;
end $$;

-- ---------------------------------------------------------------- expire
-- Cancel unpaid 藍新 checkout orders older than p_minutes and release their holds; returns the cancelled ids.
create or replace function site_kcasa.newebpay_cancel_expired(p_minutes int default 60)
returns setof bigint
language plpgsql
set search_path = site_kcasa, pg_temp
as $$
declare
  r record;
begin
  for r in select id from site_kcasa.orders
            where payment_method = 'ry_newebpay_credit' and status = 'pending' and transaction_id = ''
              and created_via = 'checkout' and created_at < now() - make_interval(mins => p_minutes)
            order by id limit 200 loop
    if site_kcasa.order_release_stock(r.id, 'cancelled') then
      return next r.id;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------- payment attempts
-- A fresh MerchantOrderNo (KC<id>_<n>) for an unpaid pending 藍新 order; null when the order cannot be paid
-- or after p_max attempts. The order row lock serialises concurrent attempts.
create or replace function site_kcasa.newebpay_new_attempt(p_order_id bigint, p_max int default 20)
returns text
language plpgsql
set search_path = site_kcasa, pg_temp
as $$
declare
  o   site_kcasa.orders%rowtype;
  n   int;
  mon text;
begin
  select * into o from site_kcasa.orders where id = p_order_id for update;
  if not found or o.payment_method <> 'ry_newebpay_credit' or o.status <> 'pending' or o.transaction_id <> '' then return null; end if;
  select coalesce(max(attempt), 0) + 1 into n from site_kcasa.newebpay_attempts where order_id = p_order_id;
  if n > p_max then return null; end if;
  mon := 'KC' || p_order_id || '_' || n;
  insert into site_kcasa.newebpay_attempts (merchant_order_no, order_id, attempt) values (mon, p_order_id, n);
  update site_kcasa.orders
     set meta = meta || jsonb_build_object('newebpay', coalesce(meta->'newebpay', '{}'::jsonb) || jsonb_build_object('merchant_order_no', mon, 'attempts', n))
   where id = p_order_id;
  return mon;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'site_kcasa.order_hold_stock(bigint, int, int)',
    'site_kcasa.order_release_stock(bigint, text, jsonb)',
    'site_kcasa.order_convert_hold(bigint, boolean)',
    'site_kcasa.newebpay_mark_paid(bigint, text, jsonb)',
    'site_kcasa.newebpay_cancel_expired(int)',
    'site_kcasa.newebpay_new_attempt(bigint, int)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
