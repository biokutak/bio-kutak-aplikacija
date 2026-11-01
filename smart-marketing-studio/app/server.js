import express from 'express';
import pg from 'pg';
import * as cheerio from 'cheerio';
import sharp from 'sharp';
const app=express(),{Pool}=pg;
app.use(express.json());
app.use(express.static('public'));
const db=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
const BASE='https://biokutak.co.rs';
const auth=(q,s,n)=>{if(!process.env.PANEL_PASSWORD)return s.status(503).json({error:'Panel password is not configured'});if(q.get('x-panel-password')!==process.env.PANEL_PASSWORD)return s.status(401).json({error:'Wrong password'});n()};
app.get('/api/health',async(q,s)=>{try{await db.query('select 1');s.json({ok:true})}catch(e){s.status(503).json({ok:false})}});
app.post('/api/auth',(q,s)=>s.status(q.body?.password===process.env.PANEL_PASSWORD?200:401).json({ok:q.body?.password===process.env.PANEL_PASSWORD}));
app.get('/api/templates',auth,async(q,s)=>s.json((await db.query('select * from creative_templates where enabled order by sort_order')).rows));
app.get('/api/products',auth,async(q,s)=>{const term=String(q.query.q||''),cat=String(q.query.category||''),lim=Math.min(Number(q.query.limit)||100,300),off=Math.max(Number(q.query.offset)||0,0);const rows=await db.query("select * from products where active and product_url<>$5 and ($1='' or name ilike '%'||$1||'%' or coalesce(sku,'') ilike '%'||$1||'%') and ($2='' or category=$2) order by name limit $3 offset $4",[term,cat,lim,off,BASE]);const count=await db.query("select count(*)::int n from products where active and product_url<>$3 and ($1='' or name ilike '%'||$1||'%' or coalesce(sku,'') ilike '%'||$1||'%') and ($2='' or category=$2)",[term,cat,BASE]);s.json({products:rows.rows,total:count.rows[0].n})});
app.get('/api/categories',auth,async(q,s)=>s.json((await db.query("select distinct category from products where active and category is not null order by category")).rows.map(x=>x.category)));
app.get('/api/stats',auth,async(q,s)=>s.json((await db.query("select (select count(*) from products where active and product_url<>$1)::int products,(select count(*) from creative_requests where status='selected')::int selected,(select count(*) from generated_assets)::int assets,(select max(finished_at) from catalog_sync_runs where status='completed') last_sync",[BASE])).rows[0]));
app.post('/api/selections',auth,async(q,s)=>{const {product_id,codes=[],instructions=''}=q.body||{};const c=await db.connect();try{await c.query('begin');await c.query("update creative_requests set status='cancelled' where product_id=$1 and status='selected'",[product_id]);for(const code of codes)await c.query("insert into creative_requests(product_id,template_id,instructions,status) select $1,id,$3,'selected' from creative_templates where code=$2 and enabled",[product_id,code,instructions]);await c.query('commit');s.json({ok:true})}catch(e){await c.query('rollback');s.status(500).json({error:e.message})}finally{c.release()}});

const FORMATS={
 facebook:{label:'Facebook portret',width:1080,height:1920,apiWidth:1072,apiHeight:1920},
 tv:{label:'Bio Kutak TV 4K',width:3840,height:2160,apiWidth:3840,apiHeight:2160},
 strapi:{label:'Strapi kvadrat',width:2160,height:2160,apiWidth:2160,apiHeight:2160},
 strapi_no_packaging:{label:'Strapi bez ambalaže',width:2160,height:2160,apiWidth:2160,apiHeight:2160}
};
app.post('/api/generate',auth,async(q,s)=>{
 if(!process.env.OPENAI_API_KEY)return s.status(503).json({error:'OPENAI_API_KEY nije podešen u Render Environment.'});
 const {product_id,codes=[],instructions=''}=q.body||{};
 if(!product_id||!Array.isArray(codes)||!codes.length)return s.status(400).json({error:'Izaberi artikal i najmanje jedan format.'});
 const productResult=await db.query('select id,name,image_url,product_url from products where id=$1 and active=true',[product_id]);
 if(!productResult.rowCount)return s.status(404).json({error:'Artikal nije pronađen.'});
 const product=productResult.rows[0];
 if(!product.image_url)return s.status(400).json({error:'Ovaj artikal nema originalnu fotografiju. Prvo ispravi fotografiju artikla u katalogu.'});
 const chosen=[...new Set(codes)].filter(code=>FORMATS[code]);
 if(!chosen.length)return s.status(400).json({error:'Nijedan izabrani format nije prepoznat.'});
 try{
  const source=await fetch(product.image_url,{headers:{'user-agent':'Mozilla/5.0'}});
  if(!source.ok)throw Error('Ne mogu da preuzmem originalnu fotografiju proizvoda (HTTP '+source.status+').');
  const sourceBuffer=Buffer.from(await source.arrayBuffer());
  if(sourceBuffer.length>18*1024*1024)throw Error('Originalna fotografija je prevelika za obradu (maksimalno 18 MB).');
  const mime=source.headers.get('content-type')?.split(';')[0]||'image/jpeg';
  if(!mime.startsWith('image/'))throw Error('Adresa fotografije ne vraća validnu sliku.');
  const sourceData='data:'+mime+';base64,'+sourceBuffer.toString('base64');
  const outputs=[];
  for(const code of chosen){
   const f=FORMATS[code];
   const special=code==='strapi_no_packaging'?'If the product is normally sold in packaging, show the actual product contents outside the packaging while using the supplied photo as reference. Do not invent a different product.':'';
   const prompt=`Create a premium, photorealistic commercial product advertisement using the supplied product photograph as the exact visual reference. PRODUCT: "${product.name}". CRITICAL PRODUCT FIDELITY: keep the product itself, its packaging, label, brand, printed words, logo, colors, proportions and shape unchanged and legible. Do not redesign, redraw, replace, simplify, misspell or invent any packaging details. Preserve the product as faithfully as possible; creatively change ONLY the surrounding environment, background, lighting, shadows, surface and composition. Do not add any extra text, prices, badges, watermarks, logos or other products. ${special} Format: ${f.label}, aspect ratio ${f.apiWidth}:${f.apiHeight}. Composition should be elegant, striking, premium retail advertising, with the full product clearly visible and enough breathing room. Additional direction: ${String(instructions).slice(0,1500)||'Choose a fresh creative scene that suits the product; avoid generic stock backgrounds.'}`;
   const apiResponse=await fetch('https://api.openai.com/v1/images/edits',{method:'POST',headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:'gpt-image-2.5-sunburst',images:[{image_url:sourceData}],prompt,quality:'high',size:f.apiWidth+'x'+f.apiHeight,output_format:'png',n:1})});
   const data=await apiResponse.json();
   if(!apiResponse.ok)throw Error(data.error?.message||'OpenAI API greška ('+apiResponse.status+').');
   if(!data.data?.[0]?.b64_json)throw Error('AI nije vratio gotovu sliku za format '+f.label+'.');
   const raw=Buffer.from(data.data[0].b64_json,'base64');
   const final=await sharp(raw).resize(f.width,f.height,{fit:'cover',position:'centre'}).png().toBuffer();
   const safeName=product.name.normalize('NFKD').replace(/[\\u0300-\\u036f]/g,'').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,70)||'bio-kutak-proizvod';
   const fileName=safeName+'-'+code+'-'+f.width+'x'+f.height+'.png';
   await db.query('insert into generated_assets(product_id,template_code,file_name,width,height) values($1,$2,$3,$4,$5)',[product.id,code,fileName,f.width,f.height]);
   outputs.push({code,label:f.label,width:f.width,height:f.height,fileName,mime:'image/png',dataUrl:'data:image/png;base64,'+final.toString('base64')});
  }
  s.json({ok:true,product:product.name,images:outputs});
 }catch(e){console.error('Image generation failed:',e.message);s.status(502).json({error:e.message})}
});

app.post('/api/sync',auth,async(q,s)=>{
 const run=(await db.query("insert into catalog_sync_runs(status) values('running') returning id")).rows[0].id;
 try{
  const get=async u=>{const r=await fetch(u,{headers:{'user-agent':'Mozilla/5.0'}});if(!r.ok)throw Error('HTTP '+r.status);return r.text()};
  const queue=[BASE+'/prodavnica'],visited=new Set(),urls=new Set();
  const ignored=new Set(['/','/prodavnica','/pretraga','/o-nama','/blog','/kontakt','/korpa','/prijava','/registracija','/uslovi-kupovine','/kako-kupovati','/podaci','/isporuka']);
  const addLinks=(markup,sourceUrl)=>{
   const $=cheerio.load(markup);
   $('a[href]').each((i,e)=>{
    const href=$(e).attr('href');if(!href)return;
    let u;try{u=new URL(href,sourceUrl)}catch{return}
    if(u.origin!==BASE)return;
    u.hash='';
    const path=u.pathname.replace(/\/$/,'')||'/';
    const last=path.split('/').pop();
    if(/-[0-9]+(?:[.,][0-9]+)?$/.test(last)){urls.add(u.href);return}
    const label=$(e).text().trim();
    const hasPaging=[...u.searchParams.keys()].some(k=>/page|strana|offset|start|limit|p$/i.test(k));
    if(hasPaging||(/^\d+$/.test(label)&&path!=='/')){if(!visited.has(u.href)&&queue.length<800)queue.push(u.href);return}
    if(!ignored.has(path)&&!path.includes('.')){if(!visited.has(u.href)&&queue.length<800)queue.push(u.href)}
   });
  };
  while(queue.length&&visited.size<800){
   const page=queue.shift();if(visited.has(page))continue;visited.add(page);
   try{addLinks(await get(page),page)}catch(e){console.log('Catalog page skipped',page,e.message)}
  }
  let seen=0,inserted=0,updated=0,failed=0;
  for(const url of urls){
   try{
    const h=cheerio.load(await get(url));
    const name=h('h1').first().text().trim()||h('meta[property="og:title"]').attr('content');
    if(!name)continue;
    const body=h('body').text().replace(/\s+/g,' ').trim();
    const skuMatch=body.match(/Šifra\s*:\s*([0-9]+(?:[.,][0-9]+)?)/i);
    const sku=skuMatch?.[1]?.replace(',','.')||null;
    const priceMatch=body.match(/(?:^|\s)([0-9][0-9.,]*)\s*RSD\b/i);
    const price=priceMatch?Number(priceMatch[1].replace(/[.,]/g,''))||null:null;
    const image=h('meta[property="og:image"]').attr('content')||h('img[alt]').filter((i,e)=>((h(e).attr('alt')||'').toLowerCase().includes(name.toLowerCase().slice(0,18)))).first().attr('src')||null;
    const categoryPath=new URL(url).pathname.split('/').filter(Boolean)[0]||null;
    const category=categoryPath?categoryPath.replace(/[-_]/g,' ').replace(/\b\w/g,c=>c.toUpperCase()):null;
    const r=await db.query("insert into products(product_url,name,sku,category,price,image_url,active,synced_at,updated_at) values($1,$2,$3,$4,$5,$6,true,now(),now()) on conflict(product_url) do update set name=excluded.name,sku=excluded.sku,category=excluded.category,price=excluded.price,image_url=excluded.image_url,active=true,synced_at=now(),updated_at=now() returning (xmax=0) fresh",[url,name,sku,category,price,image]);
    seen++;if(r.rows[0].fresh)inserted++;else updated++;
   }catch(e){failed++;console.log('Product skipped',url,e.message)}
  }
  await db.query("update catalog_sync_runs set status='completed',products_seen=$1,products_inserted=$2,products_updated=$3,finished_at=now() where id=$4",[seen,inserted,updated,run]);
  s.json({ok:true,products_seen:seen,inserted,updated,discovered:urls.size,pages_scanned:visited.size,failed});
 }catch(e){await db.query("update catalog_sync_runs set status='failed',error_text=$1,finished_at=now() where id=$2",[e.message,run]);s.status(500).json({ok:false,error:e.message})}
});
app.listen(process.env.PORT||3000,()=>console.log('Smart Marketing Studio running'));
