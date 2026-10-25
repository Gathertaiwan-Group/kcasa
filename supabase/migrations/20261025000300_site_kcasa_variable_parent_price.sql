-- WooCommerce keeps no _regular_price/_sale_price on a variable product parent; its price range comes from the
-- variations (price_min / price_max). The REST import had copied the cheapest variation's regular price onto the parent.
update site_kcasa.products set regular_price = null, sale_price = null where type = 'variable';
