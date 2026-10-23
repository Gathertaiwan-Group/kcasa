// Convert kcasa media originals -> WebP (max side 2000, q80), dedup by sha1, build key plan.
import fs from 'fs'; import path from 'path'; import crypto from 'crypto';
import { createRequire } from 'module';
const require = createRequire(path.join(process.env.HOME,'gather-migrate/_tools/package.json'));
const sharp = require('sharp');
const EX = path.join(process.env.HOME,'gather-migrate/kcasa/export');
const OUT = path.join(process.env.HOME,'gather-migrate/kcasa/work/out');
const idx = JSON.parse(fs.readFileSync(path.join(EX,'media/index.json')));
const rest = JSON.parse(fs.readFileSync(path.join(EX,'rest/media.json')));
const byId = new Map(rest.map(m=>[m.id,m]));
const plan = []; const shaKey = new Map(); const used = new Set();
const safe = s => s.replace(/[^A-Za-z0-9._-]+/g,'-').replace(/-+/g,'-').replace(/^[-.]+|[-.]+$/g,'');
for (const it of idx) {
  if (it.status!==200 || it.source!=='library') { plan.push({...it, skipped:'not downloaded'}); continue; }
  const rel = it.url.split('/wp-content/uploads/')[1];            // YYYY/MM/name.ext (raw unicode)
  const dir = path.posix.dirname(decodeURIComponent(rel));
  let base = path.posix.basename(decodeURIComponent(rel));
  let ext = path.extname(base).toLowerCase(); let stem = base.slice(0,-ext.length).replace(/-scaled$/,'');
  const isImg = ['.jpg','.jpeg','.png','.webp'].includes(ext);
  const outExt = isImg ? '.webp' : ext;
  if (shaKey.has(it.sha1)) { plan.push({...it, key: shaKey.get(it.sha1), dup:true}); continue; }
  let s = safe(stem); if (s!==stem || !s) s = (s||'file')+'-'+it.id;
  let key = `uploads/${dir}/${s}${outExt}`;
  if (used.has(key)) key = `uploads/${dir}/${s}-${it.id}${outExt}`;
  used.add(key); shaKey.set(it.sha1,key);
  plan.push({...it, key, isImg, src: path.join(EX,it.path)});
}
// convert with limited concurrency
const todo = plan.filter(p=>p.key && !p.dup);
let i=0, done=0;
async function worker(){ while(i<todo.length){ const p=todo[i++]; const dst=path.join(OUT,p.key);
  fs.mkdirSync(path.dirname(dst),{recursive:true});
  if (!fs.existsSync(dst)) {
    if (p.isImg) {
      let buf = await sharp(p.src,{failOn:'none'}).rotate().resize({width:2000,height:2000,fit:'inside',withoutEnlargement:true}).webp({quality:80}).toBuffer();
      // keep original webp if re-encode is bigger and already within 2000px
      if (p.src.toLowerCase().endsWith('.webp')) { const m=await sharp(p.src).metadata(); const o=fs.readFileSync(p.src);
        if (Math.max(m.width,m.height)<=2000 && o.length<buf.length) buf=o; }
      fs.writeFileSync(dst,buf);
    } else fs.copyFileSync(p.src,dst);
  }
  const m = p.isImg ? await sharp(dst).metadata() : {};
  p.out_bytes = fs.statSync(dst).size; p.width=m.width||null; p.height=m.height||null;
  p.mime = p.isImg ? 'image/webp' : (p.key.endsWith('.ttf')?'font/ttf':p.key.endsWith('.gif')?'image/gif':'application/octet-stream');
  if(++done%200===0) console.log(done,'/',todo.length);
}}
await Promise.all([1,2,3,4,5,6].map(worker));
for (const p of plan.filter(p=>p.dup)) { const o=plan.find(q=>q.key===p.key && !q.dup); Object.assign(p,{width:o.width,height:o.height,out_bytes:o.out_bytes,mime:o.mime}); }
fs.writeFileSync(path.join(process.env.HOME,'gather-migrate/kcasa/work/media_plan.json'), JSON.stringify(plan,null,1));
const tot = todo.reduce((a,p)=>a+p.out_bytes,0);
console.log('unique files', todo.length, 'dups', plan.filter(p=>p.dup).length, 'skipped', plan.filter(p=>p.skipped).length, 'total MB', (tot/1048576).toFixed(1));
