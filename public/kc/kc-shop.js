/* Kcasa storefront helpers (cart / checkout) — replaces WooCommerce's AJAX cart/checkout scripts. */
(function ($) {
  if (!$) return;
  $(function () {
    // shipping calculator toggle (cart)
    $(document).on('click', '.shipping-calculator-button', function (e) {
      e.preventDefault();
      var $s = $(this).next('.shipping-calculator-form');
      $s.slideToggle('fast');
      $(this).attr('aria-expanded', $(this).attr('aria-expanded') === 'true' ? 'false' : 'true');
    });
    // shipping method change: save in the cart; cart page reloads, checkout updates the total in place
    $(document).on('change', 'input.shipping_method', function () {
      var v = $(this).val();
      var onCheckout = $('form.woocommerce-checkout').length > 0;
      var body = new URLSearchParams();
      body.set('shipping_method[0]', v);
      fetch('/cart/', { method: 'POST', body: body, credentials: 'same-origin', redirect: 'manual' }).then(function () {
        if (!onCheckout) { location.reload(); return; }
        location.hash = '';
        var cost = parseFloat($(':input.shipping_method:checked').closest('li').find('.woocommerce-Price-amount').text().replace(/[^0-9.]/g, '')) || 0;
        var $t = $('.order-total .woocommerce-Price-amount bdi');
        var net = parseFloat($('.order-total').attr('data-net'));
        if (isNaN(net)) {
          var total = parseFloat($t.text().replace(/[^0-9.]/g, '')) || 0;
          var prev = parseFloat($('.order-total').attr('data-ship') || $('.order-total').data('ship0')) || 0;
          net = total - prev;
          $('.order-total').attr('data-net', net);
        }
        $('.order-total').attr('data-ship', cost);
        $t.html('<span class="woocommerce-Price-currencySymbol">&#78;&#84;&#36;</span>' + Math.round(net + cost).toLocaleString('en-US'));
      });
    });
    // checkout: coupon form toggle
    $(document).on('click', 'a.showcoupon', function (e) {
      e.preventDefault();
      $('.checkout_coupon').slideToggle(400, function () { $('.checkout_coupon').find(':input:eq(0)').trigger('focus'); });
    });
    // checkout: ship to a different address
    $('#ship-to-different-address input').on('change', function () {
      $('div.shipping_address').toggle(this.checked);
    });
    // Taiwan county / district selects (woomp twzipcode) → billing_state / billing_city / billing_postcode
    if ($.fn.twzipcode) {
      $.each(['billing', 'shipping'], function (_, k) {
        var $state = $('#' + k + '_state'), $city = $('#' + k + '_city'), $zip = $('#' + k + '_postcode');
        if (!$state.length || !$city.length) return;
        var $box = $('<div style="display:none"></div>').appendTo('body');
        $box.twzipcode({ countyName: 'kc_' + k + '_county', districtName: 'kc_' + k + '_district', zipcodeName: 'kc_' + k + '_zip' });
        var $county = $box.find('select[name="kc_' + k + '_county"]').addClass('kc-twzip-select input-text');
        var $district = $box.find('select[name="kc_' + k + '_district"]').addClass('kc-twzip-select input-text');
        var $z = $box.find('input[name="kc_' + k + '_zip"]');
        $county.find('option:first').text('縣市');
        $district.find('option:first').text('鄉鎮市區');
        if ($state.val()) { $box.twzipcode('set', { county: $state.val(), district: $city.val() }); }
        $state.hide().after($county.removeAttr('name'));
        $city.hide().after($district.removeAttr('name'));
        var sync = function () {
          $state.val($county.val() || '');
          $city.val($district.val() || '');
          if ($z.val()) $zip.val($z.val());
        };
        $county.on('change', function () { setTimeout(function () { $district.find('option:first').text('鄉鎮市區'); sync(); }, 0); });
        $district.on('change', function () { setTimeout(sync, 0); });
      });
    }
  });
})(window.jQuery);
