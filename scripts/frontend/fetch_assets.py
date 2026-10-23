#!/usr/bin/env python3
"""Fetch the theme/plugin CSS + JS (GPL code) that the old kcasa.pro pages load, plus the
fonts/images those stylesheets reference, into public/legacy/.  Read-only, polite crawling:
sequential, >=200ms between requests, UA GatherMigrator/1.0.

Usage: python3 -I scripts/frontend/fetch_assets.py <export_dir> <repo_dir>
Images under /wp-content/uploads/ are NOT downloaded (they live in the Supabase bucket);
those url() references are rewritten through media_url_map.json (work dir) at extract time.
"""
import glob, os, re, sys, time, urllib.request, urllib.parse, hashlib

EXPORT, REPO = sys.argv[1], sys.argv[2]
OUT = os.path.join(REPO, 'public', 'legacy')
UA = 'GatherMigrator/1.0'
SKIP_HOSTS = ('googletagmanager.com', 'googlesyndication.com', 'connect.facebook.net', 'cdnjs.cloudflare.com')
_last = [0.0]


def get(url):
    wait = 0.2 - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    _last[0] = time.time()
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def local_path(url):
    """https://kcasa.pro/wp-content/x/y.css?ver=1 -> wp-content/x/y.css (fonts.googleapis -> gfonts/...)"""
    p = urllib.parse.urlparse(url)
    path = urllib.parse.unquote(p.path).lstrip('/')
    if p.netloc != 'kcasa.pro':
        path = p.netloc + '/' + path
        if p.netloc == 'fonts.googleapis.com':
            path += '-' + hashlib.md5(p.query.encode()).hexdigest()[:8] + '.css'
    return path


def save(url, data):
    lp = os.path.join(OUT, local_path(url))
    os.makedirs(os.path.dirname(lp), exist_ok=True)
    with open(lp, 'wb') as f:
        f.write(data)
    return lp


def main():
    urls = set()
    for f in glob.glob(os.path.join(EXPORT, 'html', '*.html')):
        h = open(f, encoding='utf-8', errors='ignore').read()
        for m in re.finditer(r"<link[^>]+rel=['\"]stylesheet['\"][^>]*>", h):
            hr = re.search(r"href=['\"]([^'\"]+)", m.group(0))
            if hr:
                urls.add(hr.group(1).replace('&#038;', '&').replace('&amp;', '&'))
        for m in re.finditer(r"<script[^>]+src=['\"]([^'\"]+)", h):
            urls.add(m.group(1).replace('&#038;', '&').replace('&amp;', '&'))
    urls = sorted(u for u in urls if not any(s in u for s in SKIP_HOSTS))
    done = set()
    queue = list(urls)
    n_ok = n_fail = 0
    while queue:
        u = queue.pop(0)
        key = u.split('#')[0]
        if key in done:
            continue
        done.add(key)
        if '/wp-content/uploads/' in key and not re.search(r'\.(css|js)(\?|$)', key):
            continue  # media -> bucket
        lp = os.path.join(OUT, local_path(key))
        try:
            if os.path.exists(lp) and os.path.getsize(lp) > 0:
                data = open(lp, 'rb').read()
            else:
                data = get(key)
                save(key, data)
            n_ok += 1
        except Exception as e:  # noqa
            n_fail += 1
            print('FAIL', key, e)
            continue
        if re.search(r'\.css(\?|$)', key) or 'fonts.googleapis.com' in key:
            css = data.decode('utf-8', 'ignore')
            for m in re.finditer(r"url\(\s*['\"]?([^'\")]+)['\"]?\s*\)", css):
                ref = m.group(1).strip()
                if ref.startswith('data:') or ref.startswith('#'):
                    continue
                absu = urllib.parse.urljoin(key, ref).split('#')[0]
                if any(s in absu for s in SKIP_HOSTS):
                    continue
                if absu not in done:
                    queue.append(absu)
    print('ok', n_ok, 'fail', n_fail)


if __name__ == '__main__':
    main()
