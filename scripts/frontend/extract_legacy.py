#!/usr/bin/env python3
"""Turn the exported kcasa.pro HTML snapshots into the reusable "legacy shell" the Next.js
front end renders around Supabase content:

  public/legacy/inline/*.css|js   unique inline <style>/<script> blocks (theme config, dynamic CSS)
  src/generated/legacy.json       per-path head/tail asset lists, body classes, shell HTML
                                  (header/footer/drawers with menus as placeholders)
  <work>/seo.json                 per-path SEO tags from the snapshots (applied to DB by apply_fixes.py)
  <work>/product_tabs.json        YIKES custom product tabs scraped from public product pages

Usage: python3 -I scripts/frontend/extract_legacy.py <export_dir> <repo_dir> <work_dir>
Only theme/plugin markup, CSS and JS go into the repo; no private data is read.
"""
import glob, hashlib, html as htmllib, json, os, re, sys, urllib.parse

EXPORT, REPO, WORK = sys.argv[1:4]
OLD = 'https://kcasa.pro'
INLINE_DIR = os.path.join(REPO, 'public', 'legacy', 'inline')
os.makedirs(INLINE_DIR, exist_ok=True)
os.makedirs(os.path.join(REPO, 'src', 'generated'), exist_ok=True)

# ----------------------------------------------------------------------------- url rewriting
MAP = {}
for r in json.load(open(os.path.join(WORK, 'media_url_map.json'))):
    MAP[urllib.parse.unquote(r['old_url'])] = r['new_url']
unresolved = set()


def map_upload(u):
    base = urllib.parse.unquote(u.split('?')[0])
    if '\\u' in base:
        try:
            base = json.loads('"' + base + '"')
        except Exception:
            pass
    if base in MAP:
        return MAP[base]
    if re.search(r'\.(css|js)$', base):
        return '/legacy' + urllib.parse.urlparse(u).path + (('?' + u.split('?', 1)[1]) if '?' in u else '')
    # try without size suffix / -scaled
    b2 = re.sub(r'-\d+x\d+(\.\w+)$', r'\1', base)
    b2 = re.sub(r'-scaled(\.\w+)$', r'\1', b2)
    if b2 in MAP:
        return MAP[b2]
    unresolved.add(base)
    return u


UP_RE = re.compile(r'https?:(?:\\?/){2}kcasa\.pro(?:\\?/)wp-content(?:\\?/)uploads(?:\\?/)[^"\'\s)<>,]+')


def rewrite(s):
    def up(m):
        raw = m.group(0)
        escaped = '\\/' in raw
        u = raw.replace('\\/', '/')
        # srcset entries end at whitespace; strip trailing punctuation that is not part of url
        new = map_upload(u)
        return new.replace('/', '\\/') if escaped else new
    s = UP_RE.sub(up, s)
    for a, b in [
        ('https://kcasa.pro/wp-admin/admin-ajax.php', '/api/wp/admin-ajax/'),
        ('https:\\/\\/kcasa.pro\\/wp-admin\\/admin-ajax.php', '\\/api\\/wp\\/admin-ajax\\/'),
        ('\\/?wc-ajax=%%endpoint%%', '\\/api\\/wc\\/%%endpoint%%\\/'),
        ('/?wc-ajax=%%endpoint%%', '/api/wc/%%endpoint%%/'),
        ('https://kcasa.pro/wp-content/', '/legacy/wp-content/'),
        ('https://kcasa.pro/wp-includes/', '/legacy/wp-includes/'),
        ('https:\\/\\/kcasa.pro\\/wp-content\\/', '\\/legacy\\/wp-content\\/'),
        ('https:\\/\\/kcasa.pro\\/wp-includes\\/', '\\/legacy\\/wp-includes\\/'),
        ('https://kcasa.pro/wp-json/', '/wp-json/'),
        ('https:\\/\\/kcasa.pro\\/', '\\/'),
        ('https://kcasa.pro/', '/'),
        ('https://kcasa.pro', '/'),
        ('http://kcasa.pro/', '/'),
    ]:
        s = s.replace(a, b)
    return s


# ----------------------------------------------------------------------------- helpers
def h8(s):
    return hashlib.md5(s.encode()).hexdigest()[:10]


SAVED = {}


def save_inline(kind, ident, body):
    body = rewrite(body)
    key = f'{ident}.{h8(body)}.{kind}'
    key = re.sub(r'[^A-Za-z0-9._-]', '_', key)
    if key not in SAVED:
        with open(os.path.join(INLINE_DIR, key), 'w', encoding='utf-8') as f:
            f.write(body)
        SAVED[key] = True
    return '/legacy/inline/' + key


DROP_SCRIPT_SRC = ('sourcebuster', 'order-attribution', 'payuni/assets/card.js', 'imask', 'speculationrules')
DROP_INLINE_SCRIPT_IDS = ('wc-order-attribution-js-extra', 'card-js-extra')
SEO_META = re.compile(r'^(description|robots|og:|twitter:|article:|product:|fb:)')


def tokenize(seg, collect_seo=None):
    """Split an HTML segment into ordered items. Styles/scripts become file refs, everything
    else stays HTML. SEO tags are removed (collected into collect_seo)."""
    items = []
    pos = 0
    pat = re.compile(r'<(style|script)([^>]*)>(.*?)</\1>|<link([^>]*)/?>|<meta([^>]*)/?>|<title>(.*?)</title>|<!--.*?-->', re.S | re.I)
    for m in pat.finditer(seg):
        pre = seg[pos:m.start()]
        if pre.strip():
            items.append({'t': 'html', 'v': rewrite(pre)})
        pos = m.end()
        full = m.group(0)
        if full.startswith('<!--'):
            continue
        if m.group(6) is not None:  # title
            if collect_seo is not None:
                collect_seo['title'] = htmllib.unescape(m.group(6).strip())
            continue
        if m.group(5) is not None:  # meta
            attrs = dict(re.findall(r'([\w:-]+)=["\']([^"\']*)["\']', m.group(5)))
            nm = attrs.get('name') or attrs.get('property')
            if nm and SEO_META.match(nm):
                if collect_seo is not None:
                    collect_seo.setdefault('meta', []).append({'k': 'property' if 'property' in attrs else 'name', 'n': nm, 'c': rewrite(attrs.get('content', ''))})
                continue
            if nm == 'generator' or attrs.get('name') == 'msapplication-TileImage' and False:
                continue
            if nm == 'generator':
                continue
            items.append({'t': 'html', 'v': rewrite(full)})
            continue
        if m.group(4) is not None:  # link
            attrs = dict(re.findall(r'([\w:-]+)=["\']([^"\']*)["\']', m.group(4)))
            rel = attrs.get('rel', '')
            if rel in ('canonical', 'next', 'prev'):
                if collect_seo is not None:
                    collect_seo[rel] = rewrite(attrs.get('href', ''))
                continue
            if rel in ('shortlink', 'alternate', 'EditURI', 'https://api.w.org/', 'pingback', 'dns-prefetch', 'profile'):
                continue
            if rel == 'stylesheet':
                items.append({'t': 'css', 'id': attrs.get('id', ''), 'href': rewrite(attrs.get('href', '').replace('&#038;', '&')), 'media': attrs.get('media', 'all')})
                continue
            items.append({'t': 'html', 'v': rewrite(full)})
            continue
        tag, attrs_s, body = m.group(1).lower(), m.group(2), m.group(3)
        attrs = dict(re.findall(r'([\w:-]+)=["\']([^"\']*)["\']', attrs_s))
        ident = attrs.get('id', '')
        if tag == 'style':
            if len(body) < 400:
                items.append({'t': 'html', 'v': rewrite(full)})
            else:
                items.append({'t': 'style', 'id': ident, 'href': save_inline('css', ident or 'style', body), 'media': attrs.get('media', '')})
            continue
        # script
        typ = attrs.get('type', '')
        if 'ld+json' in typ:
            if collect_seo is not None:
                collect_seo.setdefault('jsonld', []).append(rewrite(body.strip()))
            continue
        if typ == 'speculationrules':
            continue
        src = attrs.get('src')
        if src:
            src = src.replace('&#038;', '&').replace('&amp;', '&')
            if any(d in src for d in DROP_SCRIPT_SRC):
                continue
            items.append({'t': 'js', 'id': ident, 'src': rewrite(src), 'attrs': {k: v for k, v in attrs.items() if k in ('async', 'defer', 'crossorigin', 'type', 'nonce') or k.startswith('data-')}, 'raw_attrs': ' async' if re.search(r'\sasync(\s|$|=)', attrs_s) else ''})
            continue
        if ident in DROP_INLINE_SCRIPT_IDS:
            continue
        if ident == 'wcpf-plugin-script-js-extra':
            body = re.sub(r'"pageUrl":"[^"]*"', '"pageUrl":"\\/"', body) + '\nWCPFData.pageUrl = location.pathname;'
        if typ.startswith('text/template'):
            items.append({'t': 'html', 'v': rewrite(full)})
            continue
        if len(body) < 300 and 'kcasa.pro' not in body:
            items.append({'t': 'html', 'v': full})
        else:
            items.append({'t': 'jsinline', 'id': ident, 'src': save_inline('js', ident or 'script', body), 'type': typ})
    rest = seg[pos:]
    if rest.strip():
        items.append({'t': 'html', 'v': rewrite(rest)})
    # merge adjacent html
    out = []
    for it in items:
        if it['t'] == 'html' and out and out[-1]['t'] == 'html':
            out[-1]['v'] += '\n' + it['v']
        else:
            out.append(it)
    return out


def norm_menu_classes(s):
    s = re.sub(r'\s(current-menu-item|current_page_item|current-menu-ancestor|current-menu-parent|current_page_parent|current_page_ancestor)', '', s)
    s = re.sub(r'\s+page_item page-item-\d+\s+', ' ', s)
    s = s.replace(' aria-current="page"', '')
    return s


def path_of(url):
    p = urllib.parse.urlparse(url)
    path = urllib.parse.unquote(p.path)
    if p.query:
        path += '?' + urllib.parse.unquote(p.query)
    return path


# ----------------------------------------------------------------------------- main
index = json.load(open(os.path.join(EXPORT, 'html', 'index.json')))
pages = {}
heads, tails, shells = {}, {}, {}
seo = {}
tabs = {}
bodies = {}


def store(bucket, items):
    k = h8(json.dumps(items, ensure_ascii=False))
    bucket[k] = items
    return k


for ent in index:
    f = os.path.join(EXPORT, ent['file'])
    if not os.path.exists(f) or ent.get('status') not in (200, 404):
        continue
    h = open(f, encoding='utf-8', errors='ignore').read()
    if '<body' not in h:
        continue
    path = path_of(ent['url'])
    hi = h.index('<head>') + 6 if '<head>' in h else h.index('<head')
    he = h.index('</head>')
    s = {}
    head_items = tokenize(h[hi:he], s)
    bm = re.search(r'<body([^>]*)>', h)
    body_attrs = bm.group(1)
    bc = re.search(r'class="([^"]*)"', body_attrs).group(1)
    ci = h.find('<div id="content"')
    ce = h.find('</div><!-- #content -->')
    if ci < 0 or ce < 0:
        continue
    prefix = norm_menu_classes(h[bm.end():ci])
    # menus -> placeholders
    for mid, key in [('ast-hf-menu-1', 'primary'), ('ast-hf-menu-2', 'secondary'), ('ast-hf-mobile-menu', 'mobile')]:
        prefix = re.sub(r'(<ul id="%s"[^>]*>).*?(</ul>)' % mid, r'\1[[KC:MENU:%s]]\2' % key, prefix, flags=re.S)
    # header cart -> placeholder
    prefix = re.sub(r'<a href="https://kcasa\.pro/cart/" class="cart-container.*?</a>', '[[KC:CARTLINK]]', prefix, flags=re.S)
    prefix = prefix.replace('<div class="widget_shopping_cart_content"></div>', '<div class="widget_shopping_cart_content">[[KC:MINICART]]</div>')
    suffix = h[ce:h.rindex('</body>')]
    suffix = suffix.replace('<div class="widget_shopping_cart_content"></div>', '<div class="widget_shopping_cart_content">[[KC:MINICART]]</div>')
    suffix = re.sub(r'(fetchpriority="high"|loading="lazy")\s', '', suffix)
    pre_items = tokenize(prefix)
    suf_items = tokenize(suffix)
    pages[path] = {
        'bodyClass': bc,
        'bodyAttrs': re.sub(r'\s*class="[^"]*"', '', body_attrs).strip(),
        'head': store(heads, head_items),
        'pre': store(shells, pre_items),
        'suf': store(tails, suf_items),
        'status': ent.get('status'),
    }
    seo[path] = s
    # main-content wrapper bits that the renderer needs per path (archive headings etc.)
    main = h[ci:ce]
    bodies[path] = len(main)
    # product custom tabs (YIKES)
    if '/product/' in path:
        tlist = []
        starts = list(re.finditer(r'<div class="woocommerce-Tabs-panel woocommerce-Tabs-panel--([^"\s]+) panel entry-content wc-tab"[^>]*>', main))
        for k, tm in enumerate(starts):
            slug = urllib.parse.unquote(tm.group(1))
            end = starts[k + 1].start() if k + 1 < len(starts) else main.find('</div>', tm.end())
            body = main[tm.end():end].rstrip()
            if k + 1 < len(starts) and body.endswith('</div>'):
                body = body[:-6].rstrip()
            if slug in ('reviews', 'description', 'additional_information'):
                continue
            tt = re.search(r'<h2 class="yikes-custom-woo-tab-title[^"]*">(.*?)</h2>', body, re.S)
            title = htmllib.unescape(tt.group(1).strip()) if tt else slug
            content = body[tt.end():] if tt else body
            tlist.append({'id': slug, 'title': title, 'content_html': rewrite(content.strip())})
        tabs[path] = tlist

json.dump({'pages': pages, 'heads': heads, 'shells': shells, 'tails': tails},
          open(os.path.join(REPO, 'src', 'generated', 'legacy.json'), 'w'), ensure_ascii=False)
json.dump(seo, open(os.path.join(WORK, 'seo.json'), 'w'), ensure_ascii=False, indent=0)
json.dump(tabs, open(os.path.join(WORK, 'product_tabs.json'), 'w'), ensure_ascii=False, indent=0)
print('pages', len(pages), 'heads', len(heads), 'shells', len(shells), 'tails', len(tails), 'inline files', len(SAVED))
print('product tab sets', sum(1 for v in tabs.values() if v), 'unresolved uploads', len(unresolved))
for u in sorted(unresolved)[:20]:
    print('  unresolved', u)
