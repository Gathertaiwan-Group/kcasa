-- NewebPay (藍新金流) MPG: transaction log + atomic "mark paid" (status change and stock reduction happen
-- exactly once, in one transaction, no matter how many times NewebPay re-sends the NotifyURL request).
-- Only touches schema site_kcasa. Card numbers are never stored (NewebPay only returns first 6 / last 4).

create table if not exists site_kcasa.payment_transactions (
  id                bigint generated always as identity primary key,
  order_id          bigint references site_kcasa.orders(id) on delete cascade,
  gateway           text not null default 'newebpay',
  source            text not null default 'notify' check (source in ('notify','return')),
  merchant_order_no text,
  trade_no          text,
  status            text,          -- NewebPay Status (SUCCESS / error code)
  message           text,
  amount            numeric(12,2),
  payment_type      text,
  outcome           text not null, -- paid / duplicate / failed / ignored / rejected:<reason>
  result            jsonb not null default '{}'::jsonb,  -- decrypted Result (no secrets)
  created_at        timestamptz not null default now()
);
create index if not exists payment_transactions_order_idx on site_kcasa.payment_transactions (order_id, created_at desc);

revoke all on site_kcasa.payment_transactions from anon, authenticated;
grant all on site_kcasa.payment_transactions to service_role;
alter table site_kcasa.payment_transactions enable row level security;
alter table site_kcasa.payment_transactions force row level security;

-- Mark a NewebPay order paid. Returns true only for the single call that actually changed the order;
-- re-sent notifications (or a concurrent duplicate) get false and change nothing.
create or replace function site_kcasa.newebpay_mark_paid(p_order_id bigint, p_trade_no text, p_meta jsonb)
returns boolean
language plpgsql
set search_path = site_kcasa, pg_temp
as $$
declare
  hit bigint;
  li record;
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

  for li in select product_id, variation_id, quantity from site_kcasa.order_items
             where order_id = p_order_id and item_type = 'line_item' loop
    if li.variation_id is not null then
      update site_kcasa.product_variations
         set stock_quantity = stock_quantity - li.quantity,
             stock_status = case when stock_quantity - li.quantity <= 0 and backorders = 'no' then 'outofstock' else stock_status end
       where id = li.variation_id and manage_stock and stock_quantity is not null;
    elsif li.product_id is not null then
      update site_kcasa.products
         set stock_quantity = stock_quantity - li.quantity,
             stock_status = case when stock_quantity - li.quantity <= 0 and backorders = 'no' then 'outofstock' else stock_status end
       where id = li.product_id and manage_stock and stock_quantity is not null;
    end if;
    if li.product_id is not null then
      update site_kcasa.products set total_sales = total_sales + li.quantity where id = li.product_id;
    end if;
  end loop;
  return true;
end $$;

revoke all on function site_kcasa.newebpay_mark_paid(bigint, text, jsonb) from public, anon, authenticated;
grant execute on function site_kcasa.newebpay_mark_paid(bigint, text, jsonb) to service_role;
