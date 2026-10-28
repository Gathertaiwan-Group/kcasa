-- NewebPay (藍新金流) follow-ups, schema site_kcasa only (plus one pg_cron job that calls only this site's function).
--  1. newebpay_cancel_expired writes the order note + audit row itself, so a cancellation by the scheduled job
--     is recorded exactly like one triggered from the app (the app no longer adds its own note).
--  2. order_convert_hold: an order whose hold was already released (60-min timeout / payment failure / admin
--     cancel) and is later set back to processing / completed / on-hold reduces its stock again, once, without
--     a stock check (the money is already taken); an order note is left when that oversells.
--  3. pg_cron job site_kcasa_expire_holds: every 5 minutes cancel expired unpaid 藍新 orders and release holds.

-- ---------------------------------------------------------------- expire (replaces 20261029000100 version)
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
      insert into site_kcasa.order_notes (order_id, content, is_customer_note, added_by)
      values (r.id, '未付款訂單已取消 - 已達付款時限，預留庫存已釋放。訂單狀態已從「等待付款中」變更為「已取消」。', false, 'system');
      insert into site_kcasa.audit_log (actor, via, action, entity_type, entity_id, before, after)
      values ('newebpay', 'system', 'order.status', 'order', r.id::text, jsonb_build_object('status', 'pending'),
              jsonb_build_object('status', 'cancelled', 'reason', format('unpaid after %s minutes', p_minutes), 'stock_hold', 'released'));
      return next r.id;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------- convert (replaces 20261029000100 version)
create or replace function site_kcasa.order_convert_hold(p_order_id bigint, p_always boolean default false)
returns boolean
language plpgsql
set search_path = site_kcasa, pg_temp
as $$
declare
  o  site_kcasa.orders%rowtype;
  li record;
  had_hold boolean;
  was_released boolean;
  left_qty int;
  short text := '';
begin
  select * into o from site_kcasa.orders where id = p_order_id for update;
  if not found then return false; end if;
  if coalesce((o.meta->>'stock_reduced')::boolean, false) then return false; end if;
  had_hold := exists (select 1 from site_kcasa.stock_holds where order_id = p_order_id and state = 'held');
  was_released := not had_hold and coalesce(o.meta->>'stock_hold', '') = 'released';  -- coalesce: never null
  if not had_hold and not was_released and not p_always then return false; end if;

  if had_hold then
    update site_kcasa.stock_holds set state = 'converted', settled_at = now() where order_id = p_order_id and state = 'held';
  elsif was_released then
    -- reduce again (same lock order as order_hold_stock); never refused, may go negative
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
    insert into site_kcasa.order_notes (order_id, content, is_customer_note, added_by)
    values (p_order_id,
            '預留庫存先前已釋放，訂單改回已付款狀態，已重新扣除庫存。'
              || case when short = '' then '' else '注意：扣庫存後超賣：' || short || '。請確認出貨或聯繫顧客退款。' end,
            false, 'system');
  end if;

  for li in select product_id, sum(quantity)::int q from site_kcasa.order_items
             where order_id = p_order_id and item_type = 'line_item' and product_id is not null group by product_id order by product_id loop
    update site_kcasa.products set total_sales = total_sales + li.q where id = li.product_id;
  end loop;
  update site_kcasa.orders
     set meta = meta || jsonb_build_object('stock_reduced', true)
                     || case when had_hold then jsonb_build_object('stock_hold', 'converted')
                             when was_released then jsonb_build_object('stock_hold', 'rereduced')
                             else '{}'::jsonb end
   where id = p_order_id;
  return true;
end $$;

revoke all on function site_kcasa.newebpay_cancel_expired(int) from public, anon, authenticated;
grant execute on function site_kcasa.newebpay_cancel_expired(int) to service_role;
revoke all on function site_kcasa.order_convert_hold(bigint, boolean) from public, anon, authenticated;
grant execute on function site_kcasa.order_convert_hold(bigint, boolean) to service_role;

-- ---------------------------------------------------------------- scheduled release (pg_cron, already enabled on Gather)
select cron.unschedule(jobid) from cron.job where jobname = 'site_kcasa_expire_holds';
select cron.schedule('site_kcasa_expire_holds', '*/5 * * * *', $cmd$select count(*) from site_kcasa.newebpay_cancel_expired(60)$cmd$);
