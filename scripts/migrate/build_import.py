# Build SQL import chunks for site_kcasa from export/ (public data only).
import json, re, os, html, urllib.parse as up, secrets
from html.parser import HTMLParser
HOME=os.path.expanduser('~'); EX=f'{HOME}/gather-migrate/kcasa/export'; W=f'{HOME}/gather-migrate/kcasa/work'
R=lambda f: json.load(open(f'{EX}/rest/{f}.json'))
BASE=os.environ['SUPABASE_URL'].rstrip('/')+'/storage/v1/object/public/site-kcasa/'
stats={}

# ---------- media map ----------
plan=json.load(open(f'{W}/media_plan.json'))
rest_media=R('media'); mbyid={m['id']:m for m in rest_media}
def norm_upload(path):
    """'/wp-content/uploads/2022/07/a-300x200.jpg' -> '2022/07/a.jpg' (decoded, variant-stripped)"""
    p=up.unquote(path.split('?')[0].split('#')[0])
    p=p.split('/wp-content/uploads/',1)[1]
    d,b=p.rsplit('/',1) if '/' in p else ('',p)
    stem,dot,ext=b.rpartition('.')
    if not dot: return p
    stem=re.sub(r'-\d+x\d+$','',stem); stem=re.sub(r'-scaled$','',stem)
    return f'{d}/{stem}.{ext}'
lookup={}; media_rows=[]; map_rows={}
for p in plan:
    if p.get('source')!='library' or not p.get('key'): continue
    m=mbyid[p['id']]; new=BASE+up.quote(p['key'])
    lookup[norm_upload(m['source_url'])]=(new,p['id'])
    md=m.get('media_details') or {}
    if md.get('original_image'):
        d=m['source_url'].split('/wp-content/uploads/')[1].rsplit('/',1)[0]
        lookup.setdefault(norm_upload('/wp-content/uploads/'+d+'/'+md['original_image']),(new,p['id']))
    def addmap(u,kind):
        u=up.unquote(u)
        if u not in map_rows: map_rows[u]={'old_url':u,'new_url':new,'media_id':p['id'],'kind':kind}
    addmap(m['source_url'],'scaled' if '-scaled.' in m['source_url'] else 'original')
    if md.get('original_image'):
        addmap(m['source_url'].rsplit('/',1)[0]+'/'+md['original_image'],'original')
    for s in (md.get('sizes') or {}).values():
        if s.get('source_url'): addmap(s['source_url'],'size')
    media_rows.append(dict(id=m['id'], slug=m['slug'], title=html.unescape(m['title']['rendered']), alt_text=m.get('alt_text') or '',
        caption_html=m['caption']['rendered'], description_html='', media_type=m['media_type'], mime_type=p['mime'],
        orig_mime_type=m['mime_type'], storage_path=p['key'], url=new, old_url=up.unquote(m['source_url']),
        width=p.get('width'), height=p.get('height'), filesize=p['out_bytes'], orig_width=md.get('width'), orig_height=md.get('height'),
        orig_filesize=md.get('filesize') or p.get('bytes'), sha1=p['sha1'], author_id=m['author'], parent_id=m['post'], status='inherit',
        published_at=m['date_gmt']+'Z', modified_at=m['modified_gmt']+'Z',
        meta={'old_link':m['link'],'duplicate_of_storage':bool(p.get('dup')),'original_image':md.get('original_image'),'image_meta':md.get('image_meta')}))

unresolved=set(); rewritten={'upload':0,'internal':0}
UPL=re.compile(r'''(?:https?:)?//(?:www\.)?kcasa\.pro(/wp-content/uploads/[^\s"'<>)]+?)(?=[\s"'<>)]|,\s|$)''')
INT=re.compile(r'''(?:https?:)?//(?:www\.)?kcasa\.pro(?=[/"'\s<>?#]|$)(/[^\s"'<>]*)?''')
def rw(s):
    if not s: return s
    def f(m):
        k=norm_upload(m.group(1))
        if k in lookup: rewritten['upload']+=1; return lookup[k][0]
        unresolved.add(m.group(1)); return m.group(0)
    s=UPL.sub(f,s)
    def g(m):
        rewritten['internal']+=1; return m.group(1) or '/'
    # internal links (anything left on kcasa.pro that's not an unresolved upload)
    return INT.sub(lambda m: m.group(0) if (m.group(1) or '').startswith('/wp-content/uploads/') else g(m), s)
for r in media_rows: r['caption_html']=rw(r['caption_html'])

def path_of(link):
    p=up.urlsplit(link); return p.path or '/'

# ---------- SEO from html snapshots ----------
hidx=json.load(open(f'{EX}/html/index.json')); seo={}
for h in hidx:
    if h.get('status')!=200 or not os.path.exists(f"{EX}/{h['file']}"): continue
    t=open(f"{EX}/{h['file']}",encoding='utf-8',errors='replace').read(200000)
    def meta(attr,name):
        m=re.search(r'<meta[^>]+%s=["\']%s["\'][^>]*content=["\']([^"\']*)'%(attr,re.escape(name)),t) or re.search(r'<meta[^>]+content=["\']([^"\']*)["\'][^>]*%s=["\']%s["\']'%(attr,re.escape(name)),t)
        return html.unescape(m.group(1)) if m else None
    tt=re.search(r'<title[^>]*>(.*?)</title>',t,re.S); can=re.search(r'<link[^>]+rel=["\']canonical["\'][^>]*href=["\']([^"\']+)',t)
    d={'title':html.unescape(tt.group(1).strip()) if tt else None,'description':meta('name','description'),'robots':meta('name','robots'),
       'canonical':rw(can.group(1)) if can else None,'og_title':meta('property','og:title'),'og_description':meta('property','og:description'),
       'og_image':rw(meta('property','og:image')),'og_type':meta('property','og:type')}
    seo[path_of(h['url'])]={k:v for k,v in d.items() if v}

def ts(x): return (x+'Z') if x else None

# ---------- authors ----------
authors=[dict(id=u['id'],slug=u['slug'],display_name=u['name'],description=u['description'],url=u['url'] or '',
              avatar_url=(u.get('avatar_urls') or {}).get('96')) for u in R('users')]

aids={a['id'] for a in authors}
for m in media_rows:
    if m['author_id'] not in aids: m['author_id']=None
# ---------- terms ----------
terms=[]; 
for tax in ['category','post_tag','product_cat','product_tag','product_brand']:
    for t in R('terms_'+tax):
        terms.append(dict(id=t['id'],taxonomy=tax,name=html.unescape(t['name']),slug=t['slug'],description=rw(t['description']),
            parent_id=t.get('parent') or None,count=t['count'],meta={'old_link':t['link']}))
scat={c['id']:c for c in R('store_categories')}
mediaids={m['id'] for m in media_rows}
for t in terms:
    c=scat.get(t['id'])
    if c and c.get('image') and c['image'].get('id') in mediaids: t['image_id']=c['image']['id']
    else: t['image_id']=None
attrs=R('store_attributes'); aterms=R('store_attribute_terms')
for a in attrs:
    for t in aterms.get(str(a['id']),[]):
        terms.append(dict(id=t['id'],taxonomy=a['taxonomy'],name=html.unescape(t['name']),slug=t['slug'],description=t.get('description') or '',
            parent_id=t.get('parent') or None,count=t['count'],meta={},image_id=None))
termids={t['id'] for t in terms}
for t in terms:
    if t['parent_id'] not in termids: t['parent_id']=None

# ---------- posts / pages / navigation ----------
def builder(c, cl):
    if 'elementor' in c and 'data-elementor-type' in c: return 'elementor'
    if 'stk-' in c or 'ugb-' in c: return 'stackable'
    return 'gutenberg'
posts=[]; rels=[]
for typ,f in [('post','posts'),('page','pages'),('wp_navigation','navigation')]:
    for x in R(f):
        pth=path_of(x['link']) if typ!='wp_navigation' else None
        posts.append(dict(id=x['id'],post_type=typ,slug=x['slug'],path=pth,title=html.unescape(x['title']['rendered']),
            content_html=rw(x['content']['rendered']),excerpt_html=rw((x.get('excerpt') or {}).get('rendered','')),status=x['status'],
            author_id=x.get('author') or None,featured_media_id=(x.get('featured_media') or None),parent_id=(x.get('parent') or None),
            menu_order=x.get('menu_order',0),template=x.get('template') or '',format=x.get('format') or 'standard',sticky=bool(x.get('sticky')),
            comment_status=x.get('comment_status') or 'closed',ping_status=x.get('ping_status') or 'closed',
            password_protected=bool((x['content'] or {}).get('protected')),builder=builder(x['content']['rendered'],x.get('class_list',[])) if typ!='wp_navigation' else None,
            seo=seo.get(pth,{}) if pth else {},meta={'wp_meta':x.get('meta'),'class_list':x.get('class_list'),'guid':x['guid']['rendered'],'old_link':x['link']},
            published_at=ts(x['date_gmt']),modified_at=ts(x['modified_gmt'])))
        for c in x.get('categories',[]): rels.append(dict(object_type='post',object_id=x['id'],term_id=c))
        for c in x.get('tags',[]): rels.append(dict(object_type='post',object_id=x['id'],term_id=c))
for p in posts:
    if p['featured_media_id'] not in mediaids: p['featured_media_id']=None
pids={p['id'] for p in posts}
for p in posts:
    if p['parent_id'] not in pids: p['parent_id']=None

# ---------- products ----------
wpp={x['id']:x for x in R('product')}; sp=R('store_products'); sv=R('store_variations')
def money(v): return None if v in (None,'') else float(v)
def stock(sa):
    m=re.match(r'(\d+)\s*件',sa.get('text') or '')
    st={'in-stock':'instock','out-of-stock':'outofstock','available-on-backorder':'onbackorder'}.get(sa.get('class'),'instock')
    return (True,int(m.group(1)),st) if m else (False,None,st)
products=[]; pav=[]; variations=[]
for s in sp:
    w=wpp[s['id']]; pr=dict(s['prices'])
    if not s['price_html'] and not s['is_purchasable'] and pr.get('price') in ('0',''):  # WC empty price -> '0'
        pr.update(price=None,regular_price=None,sale_price=None,price_range=None); ms,qty,st=stock(s['stock_availability'])
    imgs=[i['id'] for i in s['images'] if i['id'] in mediaids]
    feat=w.get('featured_media') if w.get('featured_media') in mediaids else (imgs[0] if imgs else None)
    rng=pr.get('price_range') or {}
    pth=path_of(w['link'])
    products.append(dict(id=s['id'],slug=w['slug'],name=html.unescape(s['name']),type=s['type'],status=w['status'],
        featured='featured' in w.get('class_list',[]),catalog_visibility='visible',sku=s['sku'] or '',
        description_html=rw(s['description']),short_description_html=rw(s['short_description']),
        regular_price=money(pr.get('regular_price')),sale_price=money(pr.get('sale_price')) if s['on_sale'] else None,price=money(pr.get('price')),
        price_min=money(rng.get('min_amount')) if rng else money(pr.get('price')),price_max=money(rng.get('max_amount')) if rng else money(pr.get('price')),
        currency=pr.get('currency_code') or 'TWD',manage_stock=ms,stock_quantity=qty,stock_status=st if s['is_in_stock'] else 'outofstock',
        backorders='notify' if s.get('is_on_backorder') else 'no',sold_individually=bool(s['sold_individually']),
        min_purchase_qty=s['add_to_cart'].get('minimum') or 1,max_purchase_qty=(s['add_to_cart'].get('maximum') if s['add_to_cart'].get('maximum') not in (None,9999) else None),
        purchasable=bool(s['is_purchasable']),featured_media_id=feat,gallery_media_ids=[i for i in imgs if i!=feat],
        average_rating=float(s['average_rating'] or 0),review_count=s['review_count'],reviews_allowed=w.get('comment_status')=='open',
        path=pth,seo=seo.get(pth,{}),meta={'old_link':w['link'],'class_list':w.get('class_list'),'wp_meta':w.get('meta'),'price_html':s.get('price_html'),
            'add_to_cart':s['add_to_cart'],'stock_text':s['stock_availability'].get('text'),'has_options':s.get('has_options'),'guid':w['guid']['rendered']},
        published_at=ts(w['date_gmt']),modified_at=ts(w['modified_gmt'])))
    for c in w.get('product_cat',[]): rels.append(dict(object_type='product',object_id=s['id'],term_id=c))
    for c in w.get('product_tag',[]): rels.append(dict(object_type='product',object_id=s['id'],term_id=c))
    for c in w.get('product_brand',[]): rels.append(dict(object_type='product',object_id=s['id'],term_id=c))
    for pos,a in enumerate(s['attributes']):
        aid=next((x['id'] for x in attrs if x['taxonomy']==a.get('taxonomy')),None) if a.get('taxonomy') else None
        pav.append(dict(product_id=s['id'],attribute_id=aid,name=a['name'],options=[html.unescape(t['name']) for t in a['terms']],
            term_ids=[t['id'] for t in a['terms'] if t['id'] and t['id'] in termids],position=pos,visible=True,used_for_variations=bool(a.get('has_variations'))))
    for mo,v in enumerate(s['variations']):
        x=sv.get(str(v['id']))
        if not x: continue
        vp=x['prices']; vms,vq,vst=stock(x['stock_availability'])
        img=x['images'][0]['id'] if x['images'] and x['images'][0]['id'] in mediaids else None
        variations.append(dict(id=x['id'],product_id=s['id'],sku=x['sku'] or '',attributes=v['attributes'],description_html=rw(x['description']),
            status='publish',regular_price=money(vp.get('regular_price')),sale_price=money(vp.get('sale_price')) if x['on_sale'] else None,price=money(vp.get('price')),
            manage_stock=vms,stock_quantity=vq,stock_status=vst if x['is_in_stock'] else 'outofstock',image_id=img,menu_order=mo,
            purchasable=bool(x['is_purchasable']),meta={'variation':x.get('variation'),'old_permalink':x['permalink'],'name':x['name'],'slug':x['slug'],'add_to_cart':x.get('add_to_cart')}))
pattrs=[dict(id=a['id'],name=a['name'],slug=a['taxonomy'][3:],taxonomy=a['taxonomy'],type=a['type'],order_by=a['order'],has_archives=a['has_archives']) for a in attrs]
rels=[r for r in rels if r['term_id'] in termids]
rels=list({(r['object_type'],r['object_id'],r['term_id']):r for r in rels}.values())

# ---------- menus (wp_navigation + live DOM header menus) ----------
class MenuP(HTMLParser):
    def __init__(s,ulid): super().__init__(); s.ulid=ulid; s.depth=0; s.on=False; s.items=[]; s.stack=[]; s.cur=None; s.inA=False
    def handle_starttag(s,tag,a):
        a=dict(a)
        if tag=='ul' and a.get('id')==s.ulid: s.on=True; s.depth=1; return
        if not s.on: return
        if tag=='ul': s.depth+=1; s.stack.append(s.items[-1]['wp_id'] if s.items else None)
        if tag=='li':
            cls=a.get('class','');m=re.search(r'menu-item-(\d+)',a.get('id','')+' '+cls)
            ot=re.search(r'menu-item-object-([\w-]+)',cls)
            s.items.append(dict(wp_id=int(m.group(1)) if m else None,parent_wp=s.stack[-1] if s.stack else None,title='',url='',object_type=ot.group(1) if ot else None,css_classes=cls,target=None))
        if tag=='a' and s.items and not s.items[-1]['url']: s.items[-1]['url']=a.get('href',''); s.items[-1]['target']=a.get('target'); s.inA=True
    def handle_endtag(s,tag):
        if not s.on: return
        if tag=='a': s.inA=False
        if tag=='ul':
            s.depth-=1
            if s.depth==0: s.on=False
            elif s.stack: s.stack.pop()
    def handle_data(s,d):
        if s.on and s.inA and s.items: s.items[-1]['title']+=d
home=open(f'{EX}/html/home.html',encoding='utf-8').read()
menus=[]; mitems=[]
nav=R('navigation')[0]
menus.append(dict(id=nav['id'],name=nav['title']['rendered'],slug=nav['slug'],location=None,source='wp_navigation'))
for i,(t,h) in enumerate(re.findall(r'<a class="wp-block-navigation-item__content"\s+href="([^"]+)".*?__label">(.*?)</span>',nav['content']['rendered'])[0:0] or [(m[1],m[0]) for m in re.findall(r'href="([^"]+)"[^>]*><span class="wp-block-navigation-item__label">(.*?)</span>',nav['content']['rendered'])]):
    mitems.append(dict(menu_id=nav['id'],wp_id=None,parent_wp=None,title=html.unescape(t),url=rw(h),object_type=None,css_classes='',target=None,position=i))
mid=-1
for ulid,name,slug,loc in [('ast-hf-menu-1','Header 主選單','primary','primary'),('ast-hf-menu-2','Header 第二選單','secondary','secondary_menu'),('ast-hf-mobile-menu','手機選單','mobile','mobile_menu')]:
    p=MenuP(ulid); p.feed(home)
    menus.append(dict(id=mid,name=name,slug=slug,location=loc,source='live_dom:html/home.html#'+ulid))
    for i,it in enumerate(p.items):
        it.update(menu_id=mid,position=i,title=html.unescape(it['title'].strip()),url=rw(it['url'])); mitems.append(it)
    mid-=1
fb=json.load(open(f'{EX}/features.json'))['floating_buttons']
menus.append(dict(id=mid,name='WP Bottom Menu（手機底部）',slug='wp-bottom-menu',location='wp_bottom_menu',source='features.json floating_buttons'))
for i,b in enumerate(fb['wp_bottom_menu']): mitems.append(dict(menu_id=mid,wp_id=None,parent_wp=None,title=b['t'],url=b['h'],object_type='custom',css_classes='',target='_blank',position=i))
# assign ids so parents can be linked
for n,it in enumerate(mitems,1): it['id']=n
for it in mitems:
    pw=it.pop('parent_wp',None); it['parent_id']=next((o['id'] for o in mitems if pw and o['menu_id']==it['menu_id'] and o['wp_id']==pw),None)

# ---------- settings ----------
root=R('root'); feat=json.load(open(f'{EX}/features.json'))
tokens=json.load(open(f'{EX}/design/tokens.json')) if os.path.exists(f'{EX}/design/tokens.json') else None
def media_url(i): return next((m['url'] for m in media_rows if m['id']==i),None)
settings=[
 ('site_name',root['name'],'rest/root.json'),('site_description',root['description'],'rest/root.json'),
 ('site_url_old',root['url'],'rest/root.json'),('gmt_offset',root['gmt_offset'],'rest/root.json'),('timezone','Asia/Taipei','rest/root.json gmt_offset=8'),
 ('language','zh-TW','features.json i18n'),('show_on_front',root['show_on_front'],'rest/root.json'),('page_on_front',root['page_on_front'],'rest/root.json'),
 ('page_for_posts',root['page_for_posts'],'rest/root.json'),('site_logo',{'media_id':root['site_logo'],'url':media_url(root['site_logo'])},'rest/root.json'),
 ('site_icon',{'media_id':root['site_icon'],'url':media_url(root['site_icon'])},'rest/root.json'),
 ('currency',{'code':'TWD','symbol':'NT$','minor_unit':0,'decimal_separator':'.','thousand_separator':',','prefix':'NT$','suffix':''},'rest/store_products.json prices'),
 ('social_links',feat['social'][:3],'features.json social'),('floating_buttons',feat['floating_buttons'],'features.json floating_buttons'),
 ('contact_phone','02-2796-8508','features.json wp_bottom_menu tel:0227968508'),
 ('tracking',{k:feat['tracking'][k] for k in ('gtm','google_tag','google_ads','adsense') if k in feat['tracking']},'features.json tracking'),
 ('theme',{'theme':feat['theme'],'builders':feat['builders']},'features.json'),
 ('shop',{'catalog_ordering':True,'reviews_enabled':True,'coupons_enabled':feat['shop']['cart'].get('coupon',True),'shipping_methods_observed':feat['shop']['cart']['shipping_methods'],
          'checkout_fields':[f['name'] for f in feat['shop']['checkout']['fields']],'account_registration':False,'cart_url':'/cart/','checkout_url':'/checkout/','myaccount_url':'/my-account/'},'features.json shop'),
 ('permalinks',{'post':'/%postname%/','page':'/%pagename%/','product':'/product/%product%/','product_cat':'/product-category/%term%/','product_tag':'/product-tag/%term%/','category':'/category/%term%/','tag':'/tag/%term%/','author':'/author/%author%/'},'urls.json observed'),
]
if tokens: settings.append(('design_tokens',tokens,'design/tokens.json'))
settings=[dict(key=k,value=json.loads(json.dumps(v)),is_public=True,source=s) for k,v,s in settings]
for s in settings:
    s['value']=json.loads(rw(json.dumps(s['value'],ensure_ascii=False)))
# private placeholders (values come from DB backup in phase 3)
for k in ['woocommerce_settings','wpforms_settings','rank_math_settings','astra_settings','elementor_settings','zapier_settings','smtp_settings','payment_gateways']:
    settings.append(dict(key=k,value={'pending':'db_import'},is_public=False,source='placeholder; needs DB export'))

# ---------- shipping (observed on live cart) ----------
zones=[dict(id=1,name='台灣',regions=[{'type':'country','code':'TW'}],zone_order=0)]
smethods=[dict(id=1,zone_id=1,method_id='local_pickup',title='新北、台北市免運',cost=0,enabled=True,method_order=0,settings={'observed':'cart radio shipping_method[0]=local_pickup:1'}),
          dict(id=2,zone_id=1,method_id='flat_rate',title='宅配',cost=160,enabled=True,method_order=1,settings={'observed':'cart radio shipping_method[0]=flat_rate:2 (NT$160)'})]

# ---------- forms ----------
cf=[f for f in feat['forms'] if f['key'].startswith('wpforms')][0]
fields=[]
for f in cf['fields']:
    m=re.match(r'wpforms\[fields\]\[(\d+)\]',f['name'] or '')
    if m: fields.append({'id':int(m.group(1)),'type':{'text':'text','email':'email','textarea':'textarea'}.get(f['type'],f['type']),'label':f['label'].rstrip(' *'),'required':f['required']})
forms=[dict(id=419,title='Contact Form',slug='contact',plugin='wpforms',page_path='/contact/',fields=fields,settings={'submit_text':'Send Message','anti_spam':'recaptcha','notifications':'pending db_import'},status='publish')]

# ---------- url inventory + redirects ----------
urls=json.load(open(f'{EX}/urls.json')); sm=set()
try:
    for s in R('sitemaps'): pass
except Exception: pass
postpath={p['path']:('post' if p['post_type']=='post' else 'page',p['id']) for p in posts if p['path']}
prodpath={p['path']:('product',p['id']) for p in products}
termpath={path_of(t['meta']['old_link']):('term',t['id']) for t in terms if t['meta'].get('old_link')}
authpath={path_of(u['link']):('author',u['id']) for u in R('users')}
inv=[]
smset=set(urls.get('sitemap_list',[])) if isinstance(urls.get('sitemap_list'),list) else set()
for u in urls['urls']:
    p=path_of(u)
    if p in postpath: o=postpath[p]
    elif p in prodpath: o=prodpath[p]
    elif p in termpath: o=termpath[p]
    elif p in authpath: o=authpath[p]
    else: o=('other',None)
    inv.append(dict(path=p,old_url=u,object_type=o[0],object_id=o[1],in_sitemap=False))
inv=list({r['path']:r for r in inv}.values())
taken=set(r['path'] for r in inv)|set(postpath)|set(prodpath)|set(termpath)
redirects=[]; skipped=0
for m in media_rows:
    p=path_of(m['meta']['old_link'])
    if p in taken or p=='/' or '?' in m['meta']['old_link']: skipped+=1; continue
    taken.add(p); redirects.append(dict(source_path=p,target=m['url'],status_code=301,kind='attachment'))
stats['attachment_redirect_skipped']=skipped

# ---------- emit ----------
tables=[('settings',settings),('authors',authors),('media',media_rows),('media_url_map',list(map_rows.values())),('terms',terms),
 ('posts',posts),('products',products),('product_attributes',pattrs),('product_attribute_values',pav),('product_variations',variations),
 ('term_relationships',rels),('menus',menus),('menu_items',mitems),('shipping_zones',zones),('shipping_methods',smethods),
 ('forms',forms),('redirects',redirects),('url_inventory',inv)]
os.makedirs(f'{W}/sql',exist_ok=True)
for f in os.listdir(f'{W}/sql'): os.remove(f'{W}/sql/{f}')
order=[t for t,_ in tables]
pre="truncate "+", ".join('site_kcasa.'+t for t in reversed(order)) +" restart identity;\n"
open(f'{W}/sql/000_truncate.sql','w').write(pre)
n=1
for t,rows in tables:
    if not rows: continue
    cols=list(rows[0].keys())
    for r in rows: assert list(r.keys())==cols or set(r)==set(cols),(t,set(r)^set(cols))
    chunk=[];size=0
    def flush():
        global n
        if not chunk: return
        tag='j'+secrets.token_hex(6)
        js=json.dumps(chunk,ensure_ascii=False)
        assert '$'+tag+'$' not in js
        ov=' overriding system value' if t in ('menu_items',) else ''
        sql=f"insert into site_kcasa.{t} ({', '.join(cols)}){ov} select {', '.join(cols)} from jsonb_populate_recordset(null::site_kcasa.{t}, ${tag}${js}${tag}$::jsonb);\n"
        open(f'{W}/sql/{n:03d}_{t}.sql','w').write(sql); n+=1
    for r in rows:
        chunk.append(r); size+=len(json.dumps(r,ensure_ascii=False))
        if size>700000: flush(); chunk=[]; size=0
    flush()
fix="select setval(pg_get_serial_sequence('site_kcasa.menu_items','id'), (select coalesce(max(id),1) from site_kcasa.menu_items));\n"
open(f'{W}/sql/{n:03d}_fix.sql','w').write(fix)
stats.update({t:len(r) for t,r in tables}); stats['rewritten']=rewritten; stats['unresolved_uploads']=sorted(unresolved)
json.dump(stats,open(f'{W}/import_stats.json','w'),ensure_ascii=False,indent=1)
print(json.dumps({k:v for k,v in stats.items()},ensure_ascii=False)[:3000])
