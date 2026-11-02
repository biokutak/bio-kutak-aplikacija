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
async function getRetry(url, timeout = 35000) {
  let error;
  for (let n=1;n<=3;n++) {
    try { return await get(url, timeout); }
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
    if(parts.length!==1 || parts.some(p=>EXCLUDED.has(p.toLowerCase()))) return;
    let card=$(el), cardText=card.text().replace(/\s+/g," ").trim();
    for(let depth=0;depth<7 && card.length;depth++,card=card.parent()){
      const t=card.text().replace(/\s+/g," ").trim();
      if(/Šifra\s*:/i.test(t) && /RSD/i.test(t)){cardText=t;break;}
    }
    if(/Šifra\s*:/i.test(cardText) && /RSD/i.test(cardText)) return;
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
      const {body}=await get(mapUrl,9000);
      for(const raw of xmlLocations(body)) {
        const u=localUrl(raw,mapUrl); if(!u) continue;
        if(/\.xml(?:\?|$)/i.test(u)) sitemapQueue.push(u);
        else sitemapUrls.add(u);
      }
      console.log("CATALOG V2 SITEMAP", {url:mapUrl,urls:sitemapUrls.size,queued:sitemapQueue.length});
    } catch(e) { console.log("CATALOG V2 SITEMAP unavailable", {url:mapUrl,error:e.message}); }
  }

  const seedUrls=new Set([SITE+"/",SITE+"/prodavnica"]);
  const categoryQueue=new Set();
  for(const u of seedUrls) {
    try {
      const {body}=await getRetry(u);
      for(const c of discoverCategoryUrls(body,u)) categoryQueue.add(c);
      console.log("CATALOG V2 SEED", {url:u,categoryLinks:categoryQueue.size,productCards:getProductCards(body).length});
    } catch(e) { console.warn("CATALOG V2 seed failed",{url:u,error:e.message}); }
  }
  const categoryUrls=[...new Set([SITE+"/prodavnica",...categoryQueue])];
  console.log("CATALOG V2 CATEGORY SEEDS", {count:categoryUrls.length, sample:categoryUrls.slice(0,12)});

  // Walk category/subcategory links breadth-first; product cards are excluded by SKU+price.
  const listingPages=new Map();
  let frontier=new Set(categoryUrls);
  for(let round=0;round<6 && frontier.size;round++) {
    const batch=[...frontier].filter(url=>!listingPages.has(url)).slice(0,250);
    frontier=new Set();
    if(!batch.length) break;
    const pages=await mapLimit(batch,5,async url=>{
      try { const {body}=await getRetry(url,18000); return {url,html:body}; }
      catch(e) { console.warn("CATALOG V2 category failed",{url,error:e.message}); return null; }
    });
    for(const p of pages) {
      if(!p?.html) continue;
      listingPages.set(p.url,p.html);
      for(const child of discoverCategoryUrls(p.html,p.url)) if(!listingPages.has(child)) frontier.add(child);
    }
    console.log("CATALOG V2 CATEGORY ROUND",{round:round+1,requested:batch.length,loaded:pages.length,totalCategories:listingPages.size,queuedChildren:frontier.size});
  }
  const firstPages=[...listingPages].map(([url,html])=>({url,html}));
  // Do not trust the visible pager window: walk each category sequentially until two pages add no new products.
  const categoryPagination=await mapLimit(firstPages,5,async p=>{
    const knownMax=pageNumberMax(p.html);
    const minProbe=Math.max(5,knownMax+2);
    const seen=new Set(getProductCards(p.html).map(x=>x.url));
    const extraPages=[];
    let emptyStreak=0;
    for(let n=2;n<=100;n++) {
      let body="";
      try {
        ({body}=await get(pageUrl(p.url,n),18000));
      } catch(e) {
        console.warn("CATALOG V2 pagination fetch failed",{category:p.url,page:n,error:e.message});
        emptyStreak++;
        if(n>=minProbe && emptyStreak>=2) break;
        continue;
      }
      const cards=getProductCards(body);
      const fresh=cards.filter(x=>!seen.has(x.url));
      if(fresh.length===0) emptyStreak++; else {
        emptyStreak=0;
        for(const card of fresh) seen.add(card.url);
        extraPages.push({url:pageUrl(p.url,n),html:body});
      }
      if(n%5===0) console.log("CATALOG V2 pagination progress",{category:p.url,page:n,newProducts:fresh.length,uniqueInCategory:seen.size});
      if(n>=minProbe && emptyStreak>=2) break;
      if(cards.length===0 && n>=minProbe) break;
    }
    console.log("CATALOG V2 category pagination complete",{category:p.url,knownPagerMax:knownMax,extraPages:extraPages.length,uniqueProducts:seen.size});
    return extraPages;
  });
  for(const pages of categoryPagination) for(const p of pages) listingPages.set(p.url,p.html);
  console.log("CATALOG V2 LISTINGS", {
    categories:categoryUrls.length, listingPages:listingPages.size,
    productCards:[...listingPages.values()].reduce((n,h)=>n+getProductCards(h).length,0),
    categoryPaginationJobs:categoryPagination.length
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
  const listingProducts=await mapLimit([...candidates.values()],8,async item=>{
    const {body}=await getRetry(item.url);
    return productDataFromHtml(body,item.url,item.text,item.categoryName);
  });
  for(const p of listingProducts) if(p) products.set(p.url,p);
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
