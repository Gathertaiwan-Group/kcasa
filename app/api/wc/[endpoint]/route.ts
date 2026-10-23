/** WooCommerce AJAX endpoints used by the legacy front-end scripts (?wc-ajax=… rewritten to /api/wc/…/). */
import type { NextRequest } from 'next/server'
import { addToCart, loadCart, removeItem } from '@/lib/cart'
import { miniCartHtml } from '@/lib/document'

export const dynamic = 'force-dynamic'

async function fragments() {
  const cart = await loadCart()
  const hash = cart.lines.map((l) => `${l.id}:${l.quantity}`).join('|')
  return {
    fragments: {
      'div.widget_shopping_cart_content': `<div class="widget_shopping_cart_content">${miniCartHtml(cart)}</div>`,
      '.ast-site-header-cart .ast-count-text, .astra-cart-drawer .ast-count-text': `<span class="ast-count-text">${cart.count}</span>`,
    },
    cart_hash: hash ? Buffer.from(hash).toString('base64url').slice(0, 32) : '',
  }
}

async function handle(req: NextRequest, endpoint: string) {
  const json = (o: unknown, status = 200) => Response.json(o, { status, headers: { 'Cache-Control': 'no-store' } })
  const fd = req.method === 'POST' && /form|urlencoded/.test(req.headers.get('content-type') || '') ? await req.formData() : new FormData()
  switch (endpoint) {
    case 'get_refreshed_fragments':
      return json(await fragments())
    case 'add_to_cart': {
      const pid = Number(fd.get('product_id') || fd.get('add-to-cart'))
      const r = await addToCart(pid, Number(fd.get('variation_id')) || null, Number(fd.get('quantity')) || 1, {})
      if (!r.ok) return json({ error: true, product_url: r.product ? `/product/${r.product.slug}/` : '/shop/' })
      return json(await fragments())
    }
    case 'remove_from_cart': {
      await removeItem(Number(fd.get('cart_item_key')))
      return json(await fragments())
    }
    default:
      return json({ error: true, message: 'unsupported endpoint' }, 400)
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ endpoint: string }> }) {
  return handle(req, (await params).endpoint)
}
export async function POST(req: NextRequest, { params }: { params: Promise<{ endpoint: string }> }) {
  return handle(req, (await params).endpoint)
}
