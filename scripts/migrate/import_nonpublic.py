#!/usr/bin/env python3
"""Import the non-public WordPress content (drafts / private pages / draft products) that the REST export could not
see, from the private DB dump (~/gather-migrate/_db/kcasa/tables). Idempotent (on conflict do nothing). Rows keep their
WordPress status, so the existing RLS (anon: status = 'publish' only) keeps them out of the public API.
Usage: source ~/.config/gather-migrate/env && python3 -I scripts/migrate/import_nonpublic.py [--dry-run]"""
import json, os, sys, urllib.request, urllib.parse
from datetime import timezone, datetime

DB = os.path.expanduser('~/gather-migrate/_db/kcasa/tables')
STATUSES = {'draft', 'private', 'pending', 'future'}
TYPES = {'page', 'post', 'product'}

def rows(t):
    with open(os.path.join(DB, t + '.jsonl')) as f:
        for l in f:
            yield json.loads(l)

def gmt(s):
    return None if not s or s.startswith('0000') else s.replace(' ', 'T') + 'Z'

posts = [r for r in rows('wp_posts') if r['post_type'] in TYPES and r['post_status'] in STATUSES]
ids = {r['ID'] for r in posts}
meta = {}
for m in rows('wp_postmeta'):
    if m['post_id'] in ids: meta.setdefault(m['post_id'], {})[m['meta_key']] = m['meta_value']
tt = {r['term_taxonomy_id']: r for r in rows('wp_term_taxonomy')}
rels = {}
for r in rows('wp_term_relationships'):
    if r['object_id'] in ids:
        t = tt.get(r['term_taxonomy_id'])
        if t and t['taxonomy'] in ('category', 'post_tag', 'product_cat', 'product_tag'):
            rels.setdefault(r['object_id'], []).append((t['term_id'], r['term_order']))

def num(v):
    try: return float(v) if v not in (None, '') else None
    except ValueError: return None

out_posts, out_products, out_rels = [], [], []
for r in posts:
    pm = meta.get(r['ID'], {})
    slug = r['post_name'] or str(r['ID'])  # WordPress drafts may have no slug yet
    common_meta = {'wp_status': r['post_status'], 'imported_from': 'db_dump', 'wp_meta': {k: v for k, v in pm.items() if not k.startswith('_edit_')}}
    if r['post_type'] == 'product':
        gallery = [int(x) for x in (pm.get('_product_image_gallery') or '').split(',') if x.strip().isdigit()]
        price = num(pm.get('_price'))
        out_products.append(dict(id=r['ID'], slug=slug, name=r['post_title'], type='simple', status=r['post_status'],
            description_html=r['post_content'], short_description_html=r['post_excerpt'],
            regular_price=num(pm.get('_regular_price')), sale_price=num(pm.get('_sale_price')), price=price, price_min=price, price_max=price,
            tax_status=pm.get('_tax_status') or 'taxable', tax_class=pm.get('_tax_class') or '',
            manage_stock=pm.get('_manage_stock') == 'yes', stock_quantity=int(float(pm['_stock'])) if num(pm.get('_stock')) is not None else None,
            stock_status=pm.get('_stock_status') or 'instock', backorders=pm.get('_backorders') or 'no',
            sold_individually=pm.get('_sold_individually') == 'yes', purchasable=price is not None,
            featured_media_id=int(pm['_thumbnail_id']) if (pm.get('_thumbnail_id') or '').isdigit() else None, gallery_media_ids=gallery,
            reviews_allowed=r['comment_status'] == 'open', menu_order=r['menu_order'], path=None, meta=common_meta,
            published_at=gmt(r['post_date_gmt']), modified_at=gmt(r['post_modified_gmt'])))
        for tid, order in rels.get(r['ID'], []): out_rels.append(dict(object_type='product', object_id=r['ID'], term_id=tid, term_order=order))
    else:
        out_posts.append(dict(id=r['ID'], post_type=r['post_type'], slug=slug, path=None, title=r['post_title'], content_html=r['post_content'],
            excerpt_html=r['post_excerpt'], status=r['post_status'], author_id=int(r['post_author']) or None, parent_id=r['post_parent'] or None,
            menu_order=r['menu_order'], template=pm.get('_wp_page_template', '') if pm.get('_wp_page_template') != 'default' else '',
            comment_status=r['comment_status'], ping_status=r['ping_status'], password_protected=bool(r['post_password']),
            builder='elementor' if pm.get('_elementor_edit_mode') == 'builder' else 'gutenberg', meta=common_meta,
            published_at=gmt(r['post_date_gmt']), modified_at=gmt(r['post_modified_gmt'])))
        for tid, order in rels.get(r['ID'], []): out_rels.append(dict(object_type='post', object_id=r['ID'], term_id=tid, term_order=order))

payload = json.dumps({'posts': out_posts, 'products': out_products, 'rels': out_rels}, ensure_ascii=False)
assert '$kc$' not in payload
sql = f"""
with j as (select $kc${payload}$kc$::jsonb d),
ip as (insert into site_kcasa.posts (id,post_type,slug,path,title,content_html,excerpt_html,status,author_id,parent_id,menu_order,template,comment_status,ping_status,password_protected,builder,meta,published_at,modified_at)
  select x.id,x.post_type,x.slug,x.path,x.title,x.content_html,x.excerpt_html,x.status,x.author_id,x.parent_id,x.menu_order,x.template,x.comment_status,x.ping_status,x.password_protected,x.builder,x.meta,x.published_at,x.modified_at
  from j, jsonb_populate_recordset(null::site_kcasa.posts, j.d->'posts') x on conflict do nothing returning id),
pr as (insert into site_kcasa.products (id,slug,name,type,status,description_html,short_description_html,regular_price,sale_price,price,price_min,price_max,tax_status,tax_class,manage_stock,stock_quantity,stock_status,backorders,sold_individually,purchasable,featured_media_id,gallery_media_ids,reviews_allowed,menu_order,path,meta,published_at,modified_at)
  select x.id,x.slug,x.name,x.type,x.status,x.description_html,x.short_description_html,x.regular_price,x.sale_price,x.price,x.price_min,x.price_max,x.tax_status,x.tax_class,x.manage_stock,x.stock_quantity,x.stock_status,x.backorders,x.sold_individually,x.purchasable,
    (select m.id from site_kcasa.media m where m.id = x.featured_media_id), coalesce((select array_agg(g) from unnest(x.gallery_media_ids) g where exists (select 1 from site_kcasa.media m where m.id = g)), '{{}}'),
    x.reviews_allowed,x.menu_order,x.path,x.meta,x.published_at,x.modified_at
  from j, jsonb_populate_recordset(null::site_kcasa.products, j.d->'products') x on conflict do nothing returning id),
ir as (insert into site_kcasa.term_relationships (object_type,object_id,term_id,term_order)
  select x.object_type,x.object_id,x.term_id,x.term_order from j, jsonb_populate_recordset(null::site_kcasa.term_relationships, j.d->'rels') x
  where exists (select 1 from site_kcasa.terms t where t.id = x.term_id) on conflict do nothing returning object_id)
select (select count(*) from ip) posts_inserted, (select count(*) from pr) products_inserted, (select count(*) from ir) rels_inserted
"""
print('to import:', len(out_posts), 'posts/pages,', len(out_products), 'products,', len(out_rels), 'term links', file=sys.stderr)
if '--dry-run' in sys.argv: sys.exit(0)
req = urllib.request.Request('https://api.supabase.com/v1/projects/ozwftlkgqmewtadypsfi/database/query', method='POST',
    data=json.dumps({'query': sql}).encode(), headers={'Authorization': 'Bearer ' + os.environ['SUPABASE_ACCESS_TOKEN'], 'Content-Type': 'application/json', 'User-Agent': 'GatherMigrator/1.0'})
print(urllib.request.urlopen(req).read().decode())
