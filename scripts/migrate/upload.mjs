import fs from 'fs'; import path from 'path';
const W = path.join(process.env.HOME,'gather-migrate/kcasa/work');
const plan = JSON.parse(fs.readFileSync(path.join(W,'media_plan.json')));
const URL0 = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const todo = plan.filter(p=>p.key && !p.dup);
const logf = path.join(W,'upload_log.json'); const log = fs.existsSync(logf)?JSON.parse(fs.readFileSync(logf)):{};
let i=0, ok=0, fail=0;
async function worker(){ while(i<todo.length){ const p=todo[i++]; if (log[p.key]==='ok') {ok++; continue;}
  const body = fs.readFileSync(path.join(W,'out',p.key));
  for (let a=0;a<3;a++){
    const r = await fetch(`${URL0}/storage/v1/object/site-kcasa/${p.key.split('/').map(encodeURIComponent).join('/')}`,
      {method:'POST', headers:{Authorization:`Bearer ${KEY}`, apikey:KEY, 'Content-Type':p.mime, 'x-upsert':'true', 'cache-control':'max-age=31536000'}, body});
    if (r.ok){ log[p.key]='ok'; ok++; break; }
    const t = await r.text(); if (a===2){ log[p.key]='ERR '+r.status+' '+t.slice(0,200); fail++; console.log(p.key, r.status, t.slice(0,200)); }
    await new Promise(s=>setTimeout(s,1000));
  }
  if ((ok+fail)%200===0) { console.log(ok,fail); fs.writeFileSync(logf, JSON.stringify(log)); }
}}
await Promise.all([1,2,3,4].map(worker));
fs.writeFileSync(logf, JSON.stringify(log));
console.log('ok',ok,'fail',fail,'of',todo.length);
