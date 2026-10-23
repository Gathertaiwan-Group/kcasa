#!/usr/bin/env python3
"""Fill the per-object presentation data the storefront needs, from the public HTML snapshots:

  * seo jsonb (Rank Math <title>, meta list, canonical, JSON-LD) on posts / products, terms.meta.seo,
    settings.seo_paths (author archives)          <- <work>/seo.json (extract_legacy.py)
  * posts.meta.ast_title  ('hidden'|'shown')     <- Astra "disable title" per page/post
  * products.meta.custom_tabs                     <- <work>/product_tabs.json (YIKES custom product tabs)
  * menu_items.wp_id / css_classes                <- header / mobile menu <li> ids and classes

Only public markup is read; writes go to schema site_kcasa only (Supabase Management API, token from env).
Usage: python3 -I scripts/frontend/apply_frontend_data.py <export_dir> <work_dir> [--dry-run]
"""
import json, os, re, sys, urllib.parse, urllib.request

EXPORT, WORK = sys.argv[1], sys.argv[2]
DRY = '--dry-run' in sys.argv
PROJECT = 'ozwftlkgqmewtadypsfi'


def sql(q):
    if DRY:
        print(q[:300])
        return []
    req = urllib.request.Request(f'https://api.supabase.com/v1/projects/{PROJECT}/database/query', data=json.dumps({'query': q}).encode(),
                                 headers={'Authorization': 'Bearer ' + os.environ['SUPABASE_ACCESS_TOKEN'], 'Content-Type': 'application/json', 'User-Agent': 'GatherMigrator/1.0'})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode() or '[]')


def lit(v):
    return "'" + json.dumps(v, ensure_ascii=False).replace("'", "''") + "'::jsonb"


def norm(p):
    return urllib.parse.unquote(p).lower()


seo = {norm(k): v for k, v in json.load(open(os.path.join(WORK, 'seo.json'))).items()}
tabs = {norm(k): v for k, v in json.load(open(os.path.join(WORK, 'product_tabs.json'))).items()}
index = json.load(open(os.path.join(EXPORT, 'html', 'index.json')))


def seo_obj(s):
    meta = s.get('meta', [])
    o = {'title': s.get('title'), 'canonical': s.get('canonical'), 'meta': meta, 'jsonld': s.get('jsonld', [])}
    for m in meta:
        if m['n'] == 'description':
            o['description'] = m['c']
        if m['n'] == 'robots':
            o['robots'] = m['c']
        if m['n'] == 'og:type':
            o['og_type'] = m['c']
        if m['n'] == 'og:image':
            o['og_image'] = m['c']
    return {k: v for k, v in o.items() if v is not None}


posts = sql("select id, post_type, path from site_kcasa.posts where path is not null")
products = sql("select id, slug from site_kcasa.products")
terms = sql("select id, taxonomy, slug from site_kcasa.terms")
stmts = []

# ---- SEO
for p in posts:
    s = seo.get(norm(p['path']))
    if s:
        stmts.append(f"update site_kcasa.posts set seo = seo || {lit(seo_obj(s))} where id = {p['id']};")
for p in products:
    s = seo.get(norm(f"/product/{p['slug']}/"))
    if s:
        stmts.append(f"update site_kcasa.products set seo = seo || {lit(seo_obj(s))} where id = {p['id']};")
base = {'category': '/category/', 'post_tag': '/tag/', 'product_cat': '/product-category/', 'product_tag': '/product-tag/'}
for t in terms:
    if t['taxonomy'] not in base:
        continue
    s = seo.get(norm(base[t['taxonomy']] + t['slug'] + '/'))
    if s:
        stmts.append(f"update site_kcasa.terms set meta = meta || jsonb_build_object('seo', {lit(seo_obj(s))}) where id = {t['id']};")
paths = {k: seo_obj(v) for k, v in seo.items() if k.startswith('/author/')}
stmts.append(f"insert into site_kcasa.settings (key, value) values ('seo_paths', {lit(paths)}) on conflict (key) do update set value = excluded.value;")

# ---- Astra title visibility + menus (from snapshots)
menu_ids = {}
for ent in index:
    if ent.get('status') != 200:
        continue
    h = open(os.path.join(EXPORT, ent['file']), encoding='utf-8', errors='ignore').read()
    path = norm(urllib.parse.urlparse(ent['url']).path)
    ci = h.find('<div id="content"')
    if ci < 0:
        continue
    main = h[ci:ci + 8000]
    m = re.search(r'<article\s+class="post-(\d+) (page|post) ', main)
    if m and '?' not in ent['url']:
        hidden = 'ast-no-title' in main[:main.find('entry-content') if 'entry-content' in main else 3000]
        stmts.append(f"update site_kcasa.posts set meta = meta || jsonb_build_object('ast_title', '{'hidden' if hidden else 'shown'}') where id = {m.group(1)};")
    if not menu_ids:
        for mid, loc in [('ast-hf-menu-1', 'primary'), ('ast-hf-menu-2', 'secondary_menu'), ('ast-hf-mobile-menu', 'mobile_menu')]:
            um = re.search(r'<ul id="%s"[^>]*>(.*?)</ul>' % mid, h, re.S)
            if um:
                lis = re.findall(r'<li id="menu-item-(\d+)" class="([^"]*)"', um.group(1))
                menu_ids[loc] = [(int(i), re.sub(r'\s*(current[-_]\S+|page_item|page-item-\d+|menu-item-\d+)', '', c).strip()) for i, c in lis]

for path, tl in tabs.items():
    if not tl:
        continue
    slug = path.rstrip('/').split('/')[-1]
    stmts.append(f"update site_kcasa.products set meta = meta || jsonb_build_object('custom_tabs', {lit(tl)}) where lower(slug) = lower('{urllib.parse.quote(slug, safe='').lower().replace(chr(39), '')}') or slug = '{slug.replace(chr(39), '')}';")

menus = {r['location']: r['id'] for r in sql("select id, location from site_kcasa.menus where location is not null")}
for loc, items in menu_ids.items():
    mid = menus.get(loc)
    if mid is None:
        continue
    for pos, (wp, cls) in enumerate(items):
        stmts.append(f"update site_kcasa.menu_items set wp_id = {wp}, css_classes = '{cls}', object_type = 'page' where menu_id = {mid} and position = {pos};")

# ---- product menu_order (REST did not expose it): reconstruct the catalogue order shown on the shop /
# category / tag archive snapshots (default sorting), topologically merged; shop page 1 comes first.
from collections import defaultdict
import glob
seqs = []
for f in ['shop.html'] + sorted(glob.glob(os.path.join(EXPORT, 'html', 'product-category_*.html'))) + sorted(glob.glob(os.path.join(EXPORT, 'html', 'product-tag_*.html'))):
    h = open(os.path.join(EXPORT, 'html', f) if not f.startswith('/') else f, encoding='utf-8', errors='ignore').read()
    i = h.find('<ul class="products')
    if i >= 0:
        seqs.append([int(x) for x in re.findall(r'<li class="[^"]*\bpost-(\d+)\b', h[i:h.find('</ul>', i)])])
if seqs:
    edges, nodes = defaultdict(set), set()
    for sq in seqs:
        nodes |= set(sq)
        for k, a in enumerate(sq):
            edges[a] |= set(sq[k + 1:])
    for n in nodes - set(seqs[0]):
        edges[seqs[0][-1]].add(n)
    indeg = {n: 0 for n in nodes}
    for a in edges:
        for b in edges[a]:
            indeg[b] += 1
    order, avail = [], sorted([n for n in nodes if indeg[n] == 0], reverse=True)
    while avail:
        n = avail.pop(0)
        order.append(n)
        for b in edges[n]:
            indeg[b] -= 1
            if indeg[b] == 0:
                avail.append(b)
        avail.sort(reverse=True)
    for k, pid in enumerate(order):
        stmts.append(f"update site_kcasa.products set menu_order = {k} where id = {pid};")

print('statements', len(stmts))
for i in range(0, len(stmts), 40):
    sql('\n'.join(stmts[i:i + 40]))
print('done' if not DRY else 'dry-run')
