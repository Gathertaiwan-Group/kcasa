-- Variations 2472 and 2510 have no _price/_regular_price meta in WordPress (price is empty, not purchasable).
-- The WooCommerce Store API reports such prices as '0' and the import stored 0.00; restore NULL.
update site_kcasa.product_variations
   set regular_price = null, sale_price = null, price = null
 where id in (2472, 2510);
