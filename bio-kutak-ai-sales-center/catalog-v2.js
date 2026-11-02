import * as cheerio from "cheerio";

const SITE = (process.env.SITE_URL || "https://biokutak.co.rs").replace(/\/$/, "");
const HOST = new URL(SITE).hostname;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const EXCLUDED = new Set([
  "","prodavnica","pretraga","kontakt","o-nama","blog","naslovna","kako-kupovati",
  "uslovi-koriscenja","politika-privatnosti","nacin-isporuke-i-placanja","korpa",
  "podaci","potvrda","registracija","prijava","odjava","moj-nalog","checkout"
]);
const HEADERS = {
  "user-agent":"Mozilla/5.0 (compatible; BIO-KUTAK-CatalogIndexer/2.0)",
  "accept":"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language":"sr-RS,sr;q=0.9,en;q=0.7"
};

function localUrl(raw, base = SITE) {
  try {
    const u = new URL(raw, base);
    if (u.hostname !== HOST || !/^https?:$/.test(u.protocol)) return null;
    u.hash = "";
    return u.toString();
  } catch { return null; }
}
async function get(url, timeout = 35000) {
  const response = await fetch(url, { headers:HEADERS, signal:AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error("HTTP " + response.status + " " + url);
  return { body:await response.text(), type:response.headers.get("content-type") || "" };
}
async function getRetry(url) {
  let error;
  for (let n=1;n<=3;n++) {
    try { return await get(url); }
    catch(e) { error=e; console.warn("Catalog V2 fetch retry", {url,attempt:n,error:e.message}); if(n<3) await sleep(n*1200); }
  }
  throw error;
}
function xmlLocations(xml) {
  return [...xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map(m=>m[1].trim().replaceAll("&amp;","&"));
}
function productDataFromHtml(html, url, listingText = "", categoryName = "") {
  const $ = cheerio.load(html);
  let structured = null;
  const walk = v => {
    if (!v || structured) return;
    if (Array.isArray(v)) { for(const x of v) walk(x); return; }
    if (typeof v !== "object") return;
    const t=v["@type"];
    if ((t==="Product" || (Array.isArray(t)&&t.includes("Product"))) && v.name) { structured=v; return; }
    for(const x of Object.values(v)) walk(x);
  };
  $("script[type='application/ld+json']").each((_,el)=>{try{walk(JSON.parse($(el).contents().text()));}catch{}});
  const body = $("body").text().replace(/\u00a0/g," ").replace(/\s+/g," ").trim();
  const name = $("h1").first().text().trim() || structured?.name || $("meta[property='og:title']").attr("content") || "";
  if (!name) return null;
  const offers = Array.isArray(structured?.offers) ? structured.offers[0] : structured?.offers;
  const sku = structured?.sku || structured?.mpn || structured?.gtin13 ||
    (body+" "+listingText).match(/Šifra\s*:\s*([\w./-]+)/i)?.[1] || null;
  const priceRaw = offers?.price ?? offers?.lowPrice ??
    (body+" "+listingText).match(/(?:Cena|Price)?\s*:?\s*(\d{1,7}(?:[.,]\d{1,2})?)\s*RSD\b/i)?.[1] ??
    (body+" "+listingText).match(/(\d{1,7}(?:[.,]\d{1,2})?)\s*RSD\b/i)?.[1] ?? null;
  const price = priceRaw == null ? null : Number(String(priceRaw).replace(/\./g,"").replace(",","."));
  const availabilityText = String(offers?.availability || structured?.availability || "") + " " + body + " " + listingText;
  const unavailable = /OutOfStock|Trenutno nedostupan|Nije dostupno|Nema na stanju/i.test(availabilityText);
  const available = unavailable ? false : (/InStock|Dodaj u korpu|\bKupi\b/i.test(availabilityText) ? true : null);
  const rawImage = Array.isArray(structured?.image) ? structured.image[0] : structured?.image;
  const image = rawImage || $("meta[property='og:image']").attr("content") || $("main img").first().attr("src") || $("img").first().attr("src");
  const imageUrl = image ? localUrl(image) || image : null;
  const cleanPrice = Number.isFinite(price) && price>0 && price<1000000 ? price : null;
  return {
    url, name:name.slice(0,240), sku:sku ? String(sku).slice(0,100) : null,
    category:categoryName || new URL(url).pathname.split("/").filter(Boolean)[0] || null,
    priceRsd:cleanPrice, available, imageUrl
  };
}
function getProductCards(html) {
  const $=cheerio.load(html), found=new Map();
  $("a[href]").each((_,el)=>{
    const url=localUrl($(el).attr("href"));
    if(!url) return;
    const u=new URL(url), path=u.pathname.split("/").filter(Boolean);
    if(path.length===0 || path.length>5 || path.some(x=>EXCLUDED.has(x.toLowerCase()))) return;
    let node=$(el), text=$(el).text().replace(/\s+/g," ").trim(), best=text;
    for(let depth=0;depth<8 && node.length;depth++,node=node.parent()){
      const t=node.text().replace(/\s+/g," ").trim();
      if(t.length<2200 && /Šifra\s*:/i.test(t) && /RSD/i.test(t)){best=t;break;}
    }
    if(/Šifra\s*:/i.test(best) && /RSD/i.test(best)){
      found.set(url,{url,text:best.slice(0,1800)});
    }
  });
  return [...found.values()];
}
function discoverCategoryUrls(html, baseUrl) {
  const $=cheerio.load(html), out=new Set();
  $("a[href]").each((_,el)=>{
    const href=localUrl($(el).attr("href"),baseUrl);
    if(!href) return;
    const u=new URL(href), parts=u.pathname.split("/").filter(Boolean);
    if(parts.length<1 || parts.length>3 || parts.some(p=>EXCLUDED.has(p.toLowerCase()))) return;
    if(/\.(jpg|jpeg|png|gif|pdf|webp|xml)$/i.test(u.pathname)) return;
    if(/\/(korpa|podaci|potvrda)\b/i.test(u.pathname)) return;
    out.add(u.origin+u.pathname);
  });
  return out;
}
function pageNumberMax(html) {
  const $=cheerio.load(html); let max=1;
  $("a[href]").each((_,el)=>{
    const label=$(el).text().trim();
    const href=$(el).attr("href")||"";
    const u=(()=>{try{return new URL(href,SITE)}catch{return null}})();
    if(!u) return;
    const n=Number(u.searchParams.get("strana") || u.searchParams.get("page") || u.searchParams.get("paged"));
    if(Number.isInteger(n)&&n>max) max=n;
    if(/^\d+$/.test(label)) max=Math.max(max,Number(label));
  });
  return Math.min(max,150);
}
function pageUrl(categoryUrl,n) {
  const u=new URL(categoryUrl);
  if(n===1) return u.toString();
  u.searchParams.set("strana",String(n));
  return u.toString();
}
async function mapLimit(items, limit, fn) {
  const results=new Array(items.length); let cursor=0;
  const workers=Array.from({length:Math.min(limit,items.length)},async()=>{
    while(true){const i=cursor++;if(i>=items.length)break;
      try{results[i]=await fn(items[i],i)}catch(e){results[i]=null;console.warn("Catalog V2 item failed",e.message)}
      await sleep(150);
    }
  });
  await Promise.all(workers); return results.filter(Boolean);
}

export async function syncCatalogV2(db) {
  const started=Date.now();
  console.log("CATALOG V2 START: sitemap + full category traversal");
  const sitemapQueue=[SITE+"/sitemap.xml",SITE+"/sitemap_index.xml"];
  const visitedMaps=new Set(), sitemapUrls=new Set();
  while(sitemapQueue.length && visitedMaps.size<30) {
    const mapUrl=sitemapQueue.shift();
    if(visitedMaps.has(mapUrl)) continue;
    visitedMaps.add(mapUrl);
    try {
      const {body}=await getRetry(mapUrl);
      for(const raw of xmlLocations(body)) {
        const u=localUrl(raw,mapUrl); if(!u) continue;
        if(/\.xml(?:\?|$)/i.test(u)) sitemapQueue.push(u);
        else sitemapUrls.add(u);
      }
      console.log("CATALOG V2 SITEMAP", {url:mapUrl,urls:sitemapUrls.size,queued:sitemapQueue.length});
    } catch(e) { console.log("CATALOG V2 SITEMAP unavailable", {url:mapUrl,error:e.message}); }
  }

  const seedUrls=new Set([SITE+"/",SITE+"/prodavnica"]);
  for(const u of sitemapUrls) {
    const path=new URL(u).pathname.split("/").filter(Boolean);
    if(path.length && path.length<=3 && !path.some(p=>EXCLUDED.has(p.toLowerCase()))) seedUrls.add(u);
  }
  const categoryQueue=new Set();
  for(const u of seedUrls) {
    try {
      const {body}=await getRetry(u);
      for(const c of discoverCategoryUrls(body,u)) categoryQueue.add(c);
      console.log("CATALOG V2 SEED", {url:u,categoryLinks:categoryQueue.size,productCards:getProductCards(body).length});
    } catch(e) { console.warn("CATALOG V2 seed failed",{url:u,error:e.message}); }
  }
  const categoryUrls=[...new Set([...categoryQueue,...[...sitemapUrls].filter(u=>new URL(u).pathname.split("/").filter(Boolean).length<=3)])];
  console.log("CATALOG V2 CATEGORIES", {count:categoryUrls.length, sample:categoryUrls.slice(0,12)});
  
  const listingPages=new Map();
  const firstPages=await mapLimit(categoryUrls,5,async url=>{
    const {body}=await getRetry(url);
    return {url,html:body};
  });
  for(const p of firstPages) listingPages.set(p.url,p.html);
  const paginationJobs=[];
  for(const p of firstPages) {
    const max=pageNumberMax(p.html);
    if(max>1) for(let n=2;n<=max;n++) paginationJobs.push({category:p.url,url:pageUrl(p.url,n),n});
    else {
      // Some category templates omit numeric pager links. Probe forward until two empty pages.
      paginationJobs.push({category:p.url,url:pageUrl(p.url,2),n:2,probe:true});
      paginationJobs.push({category:p.url,url:pageUrl(p.url,3),n:3,probe:true});
    }
  }
  const pageResults=await mapLimit(paginationJobs,5,async job=>{
    const {body}=await getRetry(job.url);
    const count=getProductCards(body).length;
    return {...job,html:body,count};
  });
  for(const p of pageResults) if(p.count>0) listingPages.set(p.url,p.html);
  console.log("CATALOG V2 LISTINGS", {
    categories:categoryUrls.length, listingPages:listingPages.size,
    productCards:[...listingPages.values()].reduce((n,h)=>n+getProductCards(h).length,0),
    paginationRequested:paginationJobs.length, paginationNonempty:pageResults.filter(p=>p.count>0).length
  });

  const candidates=new Map();
  for(const [listingUrl,html] of listingPages) {
    const categoryName=decodeURIComponent(new URL(listingUrl).pathname.split("/").filter(Boolean).at(-1)||"");
    for(const card of getProductCards(html)) {
      if(!candidates.has(card.url)) candidates.set(card.url,{...card,categoryName});
    }
  }
  // Sitemap URLs are treated as product candidates only when the page contains Product JSON-LD.
  const sitemapCandidates=[...sitemapUrls].filter(u=>!candidates.has(u) && new URL(u).pathname.split("/").filter(Boolean).length>=2);
  console.log("CATALOG V2 PRODUCT CANDIDATES", {listingCandidates:candidates.size,sitemapCandidates:sitemapCandidates.length});
  const sitemapProducts=await mapLimit(sitemapCandidates,4,async url=>{
    const {body}=await getRetry(url);
    const p=productDataFromHtml(body,url);
    return p ? { ...p, _isProduct:true } : null;
  });
  const products=new Map();
  for(const item of candidates.values()) {
    const {body}=await getRetry(item.url).then(x=>x).catch(()=>({body:""}));
    if(!body) continue;
    const p=productDataFromHtml(body,item.url,item.text,item.categoryName);
    if(p) products.set(p.url,p);
  }
  for(const p of sitemapProducts) if(p?._isProduct) {delete p._isProduct;products.set(p.url,p);}
  console.log("CATALOG V2 PARSED", {candidates:candidates.size,sitemapProducts:sitemapProducts.length,parsed:products.size});
  const rows=[...products.values()];
  const saved=await mapLimit(rows,4,async p=>{
    await db.query(
      "INSERT INTO products(url,name,sku,category,price_rsd,available,image_url,synced_at) VALUES($1,$2,$3,$4,$5,$6,$7,NOW()) ON CONFLICT(url) DO UPDATE SET name=EXCLUDED.name,sku=COALESCE(EXCLUDED.sku,products.sku),category=COALESCE(EXCLUDED.category,products.category),price_rsd=COALESCE(EXCLUDED.price_rsd,products.price_rsd),available=COALESCE(EXCLUDED.available,products.available),image_url=COALESCE(EXCLUDED.image_url,products.image_url),synced_at=NOW()",
      [p.url,p.name,p.sku,p.category,p.priceRsd,p.available,p.imageUrl]
    );
    return p.url;
  });
  const result={engine:"catalog-v2",sitemaps:visitedMaps.size,sitemapUrls:sitemapUrls.size,categories:categoryUrls.length,listingPages:listingPages.size,listingCandidates:candidates.size,parsed:rows.length,saved:saved.length,elapsedMs:Date.now()-started};
  console.log("CATALOG V2 COMPLETE",result);
  return result;
}
