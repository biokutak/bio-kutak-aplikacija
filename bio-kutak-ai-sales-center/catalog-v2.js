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
    // Encode literal plus signs in product slugs so servers do not interpret them as spaces.
    return u.origin + u.pathname.replace(/\+/g,"%2B") + u.search;
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
function productDataFromHtml(html, url, listingText = "", categoryName = "", listingName = "", listingImage = "") {
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
  const name = $("h1").first().text().trim() || structured?.name || $("meta[property='og:title']").attr("content") || listingName || "";
  if (!name) return null;
  const offers = Array.isArray(structured?.offers) ? structured.offers[0] : structured?.offers;
  const sourceText = body+" "+listingText;
  const slugTail = new URL(url).pathname.split("/").filter(Boolean).at(-1) || "";
  const slugSku = slugTail.match(/-(\d{1,6}(?:\.\d{1,6})?|\d{7,16})$/)?.[1] || null;
  const textSku = sourceText.match(/Šifra\s*:\s*([\w./-]+)/i)?.[1] || null;
  const rawSku = textSku || structured?.sku || structured?.mpn || structured?.gtin13 || null;
  let sku = rawSku || slugSku;
  let priceRaw = offers?.price ?? offers?.lowPrice ??
    sourceText.match(/(\d[\d\s.]*?(?:,\d{1,2})?)\s*RSD\b/i)?.[1] ??
    sourceText.match(/(\d{1,7}(?:[.,]\d{1,2})?)\s*RSD\b/i)?.[1] ?? null;
  // Some BIO KUTAK cards concatenate SKU + price (e.g. EAN13 + 500).
  // The product URL carries the real SKU, so split that suffix back into price.
  if (slugSku && rawSku) {
    let skuPrefix = rawSku.startsWith(slugSku) ? slugSku : null;
    // Some BIO KUTAK slugs drop the decimal point from short codes (524 = 5.24).
    if (!skuPrefix) {
      const normalizedSlug = slugSku.replace(/\./g,"");
      for (let end=1; end<=rawSku.length; end++) {
        const candidate = rawSku.slice(0,end);
        if (candidate.replace(/\./g,"") === normalizedSlug) { skuPrefix=candidate; break; }
      }
    }
    if (skuPrefix) {
      const suffix = rawSku.slice(skuPrefix.length);
      if (suffix === "" || /^\d{2,6}$/.test(suffix)) {
        sku = skuPrefix;
        if (suffix) priceRaw = suffix;
      }
    }
  }
  const priceToken = priceRaw == null ? null : String(priceRaw).replace(/\s/g,"");
  const normalizedPrice = priceToken == null ? null :
    (priceToken.includes(",") && priceToken.includes(".") ? priceToken.replace(/\./g,"").replace(",",".") :
     priceToken.includes(",") ? priceToken.replace(",",".") :
     /\.\d{3}$/.test(priceToken) ? priceToken.replace(/\./g,"") : priceToken);
  const price = normalizedPrice == null ? null : Number(normalizedPrice);
  const availabilityText = String(offers?.availability || structured?.availability || "") + " " + body + " " + listingText;
  const unavailable = /OutOfStock|Trenutno nedostupan|Nije dostupno|Nema na stanju/i.test(availabilityText);
  const available = unavailable ? false : (/InStock|Dodaj u korpu|\bKupi\b/i.test(availabilityText) ? true : null);
  const rawImage = Array.isArray(structured?.image) ? structured.image[0] : structured?.image;
  const image = rawImage || $("meta[property='og:image']").attr("content") || $("main img").first().attr("src") || $("img").first().attr("src") || listingImage;
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
    // Product detail URLs on BIO KUTAK have a category + product slug.
    if(path.length<2 || path.length>5 || path.some(x=>EXCLUDED.has(x.toLowerCase()))) return;
    let node=$(el), cardNode=$(el), best=$(el).text().replace(/\s+/g," ").trim();
    for(let depth=0;depth<8 && node.length;depth++,node=node.parent()){
      const t=node.text().replace(/\s+/g," ").trim();
      if(t.length<2200 && (/Šifra\s*:/i.test(t) || /\bRSD\b/i.test(t))){best=t;cardNode=node;break;}
    }
    if(/Šifra\s*:/i.test(best) || /\bRSD\b/i.test(best)){
      const img=cardNode.find("img").first();
      const rawImage=img.attr("src") || img.attr("data-src") || img.attr("data-original") || "";
      const name=$(el).attr("title") || img.attr("alt") || $(el).text().replace(/\s+/g," ").trim();
      found.set(url,{url,text:best.slice(0,1800),name,imageUrl:rawImage ? localUrl(rawImage) || rawImage : null});
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
    let card=$(el), cardText=card.text().replace(/\s+/g," ").trim();
    for(let depth=0;depth<7 && card.length;depth++,card=card.parent()){
      const t=card.text().replace(/\s+/g," ").trim();
      if(t.length<2200 && /Šifra\s*:/i.test(t) && /\bRSD\b/i.test(t)){cardText=t;break;}
    }
    // Product cards carry both a SKU and a price; category/navigation links do not.
    if(/Šifra\s*:/i.test(cardText) && /\bRSD\b/i.test(cardText)) return;
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
      try{results[i]=await fn(items[i],i)}catch(e){results[i]=null;console.warn("Catalog V2 item failed",e.stack || e.message)}
      await sleep(150);
    }
  });
  await Promise.all(workers); return results.filter(Boolean);
}

let syncInProgress = false;

export async function syncCatalogV2(db) {
  if (syncInProgress) return { engine:"catalog-v2", skipped:true, reason:"sync already running" };
  syncInProgress = true;
  const started=Date.now();
  const processedUrls=new Set();
  const categorySeen=new Set();
  let parsed=0, saved=0, failedDetails=0, pagesRead=0;
  const root=SITE+"/prodavnica";
  console.log("CATALOG V2 START: complete store pagination");

  const saveListingPage=async (html,pageNumber) => {
    const cards=getProductCards(html);
    const fresh=cards.filter(x=>!categorySeen.has(x.url));
    for(const item of cards) categorySeen.add(item.url);
    const toFetch=fresh.filter(x=>!processedUrls.has(x.url));
    for(const item of toFetch) processedUrls.add(item.url);
    const details=await mapLimit(toFetch,4,async item=>{
      try {
        const {body}=await getRetry(item.url,18000);
        const p=productDataFromHtml(body,item.url,item.text,null,item.name,item.imageUrl);
        if(!p) { failedDetails++; processedUrls.delete(item.url); return null; }
        await db.query(
          "INSERT INTO products(url,name,sku,category,price_rsd,available,image_url,synced_at) VALUES($1,$2,$3,$4,$5,$6,$7,NOW()) ON CONFLICT(url) DO UPDATE SET name=EXCLUDED.name,sku=COALESCE(EXCLUDED.sku,products.sku),category=COALESCE(EXCLUDED.category,products.category),price_rsd=COALESCE(EXCLUDED.price_rsd,products.price_rsd),available=COALESCE(EXCLUDED.available,products.available),image_url=COALESCE(EXCLUDED.image_url,products.image_url),synced_at=NOW()",
          [p.url,p.name,p.sku,p.category,p.priceRsd,p.available,p.imageUrl]
        );
        parsed++; saved++;
        return p.url;
      } catch(e) {
        // If the source listing exposes a product whose detail URL is broken, keep it
        // searchable using the card's title, SKU, price, and image instead of dropping it.
        if (/HTTP (404|403)/.test(e.message || "")) {
          const p=productDataFromHtml("",item.url,item.text,null,item.name,item.imageUrl);
          if(p?.name) {
            await db.query(
              "INSERT INTO products(url,name,sku,category,price_rsd,available,image_url,synced_at) VALUES($1,$2,$3,$4,$5,$6,$7,NOW()) ON CONFLICT(url) DO UPDATE SET name=EXCLUDED.name,sku=COALESCE(EXCLUDED.sku,products.sku),category=COALESCE(EXCLUDED.category,products.category),price_rsd=COALESCE(EXCLUDED.price_rsd,products.price_rsd),available=COALESCE(EXCLUDED.available,products.available),image_url=COALESCE(EXCLUDED.image_url,products.image_url),synced_at=NOW()",
              [p.url,p.name,p.sku,p.category,p.priceRsd,p.available,p.imageUrl]
            );
            parsed++; saved++;
            console.warn("CATALOG V2 listing-only fallback used",{url:item.url});
            return p.url;
          }
        }
        failedDetails++;
        processedUrls.delete(item.url);
        console.warn("CATALOG V2 product detail failed",{url:item.url,error:e.stack || e.message});
        return null;
      }
    });
    pagesRead++;
    console.log("CATALOG V2 PAGE SAVED",{page:pageNumber,cards:cards.length,newCandidates:toFetch.length,saved:details.filter(Boolean).length,totalSaved:saved});
    return {cards:cards.length,fresh:toFetch.length,saved:details.filter(Boolean).length};
  };

  try {
    const {body:firstHtml}=await getRetry(root,20000);
    const knownMax=pageNumberMax(firstHtml);
    console.log("CATALOG V2 STORE PAGINATION",{root,knownPages:knownMax,productsOnFirstPage:getProductCards(firstHtml).length});
    await saveListingPage(firstHtml,1);

    let emptyStreak=0;
    const maxPage=knownMax>1 ? Math.min(100,knownMax+2) : 100;
    for(let n=2;n<=maxPage;n++) {
      const url=pageUrl(root,n);
      let body="";
      try {
        ({body}=await get(url,18000));
      } catch(firstError) {
        try { ({body}=await get(url,18000)); }
        catch(secondError) {
          console.warn("CATALOG V2 page fetch failed",{page:n,error:secondError.message});
          emptyStreak++;
          if(knownMax>1 && n>=knownMax && emptyStreak>=2) break;
          continue;
        }
      }
      const result=await saveListingPage(body,n);
      if(result.fresh===0) emptyStreak++; else emptyStreak=0;
      if(n%10===0) console.log("CATALOG V2 STORE PROGRESS",{page:n,knownPages:knownMax,uniqueProducts:categorySeen.size,totalSaved:saved});
      if(knownMax>1 && n>=knownMax && emptyStreak>=2) break;
      if(result.cards===0 && n>=5) break;
    }

    const count=await db.query("SELECT COUNT(*)::int AS total FROM products");
    const result={engine:"catalog-v2",source:"/prodavnica",knownPages:knownMax,pagesRead,uniqueCandidates:categorySeen.size,parsed,saved,failedDetails,totalProducts:count.rows[0]?.total||0,elapsedMs:Date.now()-started};
    console.log("CATALOG V2 COMPLETE",result);
    return result;
  } finally {
    syncInProgress = false;
  }
}
