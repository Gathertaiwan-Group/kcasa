#!/usr/bin/env python3
"""Re-sync the home page (post 688) Elementor Pro portfolio widget with the live kcasa.pro home page.
The widget queries category 'portifolio' ordered by menu_order only; every project has menu_order 0, so MySQL
returns an arbitrary 10 and the filter tabs list the tags of those 10. The REST snapshot happened to contain only
住宅空間 projects; the live page shows a 商業空間 project too. This copies the live selection/order and tabs,
rewriting links to relative paths and images to the migrated media (bucket URLs; srcset is added at render time).
Usage: source ~/.config/gather-migrate/env && python3 -I scripts/migrate/home_portfolio_live.py <saved-live-home.html> [--dry-run]"""
import json, os, re, sys, urllib.request

API = 'https://api.supabase.com/v1/projects/ozwftlkgqmewtadypsfi/database/query'
BLOCK = re.compile(r'<ul class="elementor-portfolio__filters">[\s\S]*?<div class="elementor-portfolio elementor-grid elementor-posts-container">[\s\S]*?</article>\s*</div>')

def q(sql):
    req = urllib.request.Request(API, method='POST', data=json.dumps({'query': sql}).encode(),
        headers={'Authorization': 'Bearer ' + os.environ['SUPABASE_ACCESS_TOKEN'], 'Content-Type': 'application/json', 'User-Agent': 'GatherMigrator/1.0'})
    return json.loads(urllib.request.urlopen(req).read())

live = open(sys.argv[1], encoding='utf8').read()
m = BLOCK.search(live)
assert m, 'portfolio block not found on live page'
block = m.group(0).replace('https://kcasa.pro/', '/')
ids = sorted({int(x) for x in re.findall(r'wp-image-(\d+)', block)})
media = {r['id']: r for r in q('select id,url,width,height from site_kcasa.media where id in (%s)' % ','.join(map(str, ids)))}
missing = [i for i in ids if i not in media or not media[i]['url']]
assert not missing, f'media not migrated: {missing}'

def img(mt):
    tag = mt.group(0)
    mid = int(re.search(r'wp-image-(\d+)', tag).group(1))
    md = media[mid]
    cls = re.search(r'class="([^"]*)"', tag).group(1)
    lazy = ' loading="lazy"' if 'loading="lazy"' in tag else ''
    return f'<img{lazy} decoding="async" width="{md["width"]}" height="{md["height"]}" src="{md["url"]}" class="{cls}" alt="" />'
block = re.sub(r'<img\b[^>]*>', img, block)
assert 'kcasa.pro' not in block

cur = q('select content_html from site_kcasa.posts where id = 688')[0]['content_html']
assert len(BLOCK.findall(cur)) == 1, 'expected exactly one portfolio widget in the stored home page'
new = BLOCK.sub(lambda _m: block, cur, count=1)
tabs = re.findall(r'data-filter="(\w+)">([^<]*)<', block)
posts = re.findall(r'elementor-portfolio-item elementor-post [^"]*?post-(\d+) ', block)
print('tabs:', tabs, 'posts:', posts, file=sys.stderr)
if '--dry-run' in sys.argv: sys.exit(0)
assert '$kc$' not in new
print(q(f"update site_kcasa.posts set content_html = $kc${new}$kc$, modified_at = now() where id = 688 returning id"))
