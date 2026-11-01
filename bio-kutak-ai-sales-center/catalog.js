import * as cheerio from "cheerio";

const SITE = (process.env.SITE_URL || "https://biokutak.co.rs").replace(/\/$/, "");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function absoluteUrl(href) {
  try {
    const u = new URL(href, SITE);
    if (u.hostname !== new URL(SITE).hostname) return null;
    u.hash = "";
    return u.toString();
  } catch { return null; }
}

function productCandidates(html) {
  const $ = cheerio.load(html);
  const found = new Map();
  $("a[href]").each((_, el) => {
    const href = absoluteUrl($(el).attr("href"));
    if (!href) return;
    const parts = new URL(href).pathname.split("/").filter(Boolean);
    let node = $(el);
    let cardText = $(el).text().replace(/\s+/g, " ").trim();
    for (let depth = 0; depth < 7 && node.length; depth++) {
      const candidateText = node.text().replace(/\s+/g, " ").trim();
      if (/Šifra\s*:/i.test(candidateText) && /RSD/i.test(candidateText) && candidateText.length < 1600) {
        cardText = candidateText;
        break;
      }
      node = node.parent();
    }
    const looksLikeProduct = /Šifra\s*:/i.test(cardText) || /RSD/i.test(cardText) || /Kupi|Trenutno nedostupan/i.test(cardText);
    const excluded = /^(prodavnica|pretraga|kontakt|o-nama|blog|naslovna|kako-kupovati|uslovi-koriscenja)$/i;
    if (parts.length >= 2 && parts.length <= 3 && !parts.some((p) => excluded.test(p)) && looksLikeProduct) {
      found.set(href, { url: href, listText: cardText.slice(0,1500), context: cardText.slice(0,1500) });
    }
  });
  return [...found.values()];
}
async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "BIO-KUTAK-AI-SalesCenter/0.1 (+https://biokutak.co.rs)" },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.text();
}

function findStructuredProduct($) {
  let found = null;
  const visit = (value) => {
    if (!value || found) return;
    if (Array.isArray(value)) { for (const item of value) visit(item); return; }
    if (typeof value !== "object") return;
    const type = value["@type"];
    if ((type === "Product" || (Array.isArray(type) && type.includes("Product"))) && value.name) {
      found = value;
      return;
    }
    if (value["@graph"]) visit(value["@graph"]);
    for (const [key, child] of Object.entries(value)) if (key !== "@graph") visit(child);
  };
  $("script[type='application/ld+json']").each((_, el) => {
    try { visit(JSON.parse($(el).contents().text())); } catch {}
  });
  return found;
}

function parseProduct(url, html, listText = "", context = "") {
  const $ = cheerio.load(html);
  const text = $("body").text().replace(/\u00a0/g, " ").replace(/\s+/g, " ");
  const structured = findStructuredProduct($);
  const name = $("h1").first().text().trim() || structured?.name || $("meta[property='og:title']").attr("content") || "";
  if (!name) return null;

  const slugCode = new URL(url).pathname.split("/").filter(Boolean).at(-1)?.match(/-([0-9]+(?:\.[0-9]+)?)$/)?.[1] || null;
  const skuText = (listText + " " + context + " " + text).match(/Šifra\s*:\s*([\w./-]+)/i)?.[1] || null;
  const sku = structured?.sku || structured?.mpn || structured?.gtin13 || slugCode || skuText;

  const offers = Array.isArray(structured?.offers) ? structured.offers[0] : structured?.offers;
  const structuredPrice = offers?.price ?? offers?.lowPrice ?? structured?.priceSpecification?.price ?? null;
  let price = structuredPrice != null ? Number(String(structuredPrice).replace(",", ".")) : null;

  if (!Number.isFinite(price) || price <= 0 || price >= 10000000) {
    let priceText = text + " " + listText;
    if (sku) {
      const escapedSku = String(sku).replace(/[.*+?^\u0024{}()|[\]\\]/g, "\\$&");
      priceText = priceText.replace(new RegExp("Šifra\\s*:\\s*" + escapedSku, "i"), "Šifra:");
    }
    const priceMatch = priceText.match(/(\d{1,7}(?:[.,]\d{1,2})?)\s*RSD\b/i);
    const parsed = priceMatch ? Number(priceMatch[1].replace(/\./g, "").replace(",", ".")) : null;
    price = Number.isFinite(parsed) && parsed > 0 && parsed < 10000000 ? parsed : null;
  }

  const combined = listText + " " + text;
  const availability = String(offers?.availability || structured?.availability || "");
  const unavailable = /OutOfStock|Trenutno nedostupan|Nije dostupno|Nema na stanju/i.test(availability + " " + combined);
  const buyAvailable = /InStock|Kupi|Dodaj u korpu/i.test(availability + " " + combined);
  const structuredImage = Array.isArray(structured?.image) ? structured.image[0] : structured?.image;
  const image = structuredImage || $("meta[property='og:image']").attr("content")
    || $("main img").first().attr("src")
    || $("img").filter((_, el) => /product|proizvod/i.test($(el).attr("alt") || "")).first().attr("src");
  const category = new URL(url).pathname.split("/").filter(Boolean)[0] || null;

  return {
    url, name: name.slice(0, 240), sku: sku || null,
    category, priceRsd: price,
    available: unavailable ? false : (buyAvailable ? true : null),
    imageUrl: image ? absoluteUrl(image) || image : null
  };
}
async function mapLimit(items, limit, fn) {
  const results = [];
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index++];
      try { results.push(await fn(current)); } catch { /* one broken product must not stop sync */ }
      await sleep(120);
    }
  });
  await Promise.all(workers);
  return results.filter(Boolean);
}

export async function syncCatalog(db) {
  const startUrl = `${SITE}/pretraga`;
  const firstHtml = await fetchText(startUrl);
  const $ = cheerio.load(firstHtml);
  const pages = new Set([startUrl]);
  $("a[href]").each((_, el) => {
    const href = absoluteUrl($(el).attr("href"));
    if (!href) return;
    const u = new URL(href);
    if (u.pathname.replace(/\/$/, "") === "/pretraga" && href !== startUrl) pages.add(href);
  });

  const pageUrls = [...pages].slice(0, 10);
  const allCandidates = new Map();
  for (const pageUrl of pageUrls) {
    const html = pageUrl === startUrl ? firstHtml : await fetchText(pageUrl).catch(() => "");
    for (const item of productCandidates(html)) allCandidates.set(item.url, item);
  }

  const candidates = [...allCandidates.values()].slice(0, 180);
  const products = await mapLimit(candidates, 5, async (item) => {
    const html = await fetchText(item.url);
    return parseProduct(item.url, html, item.listText, item.context);
  });
  for (const p of products) {
    await db.query(
      `INSERT INTO products(url,name,sku,category,price_rsd,available,image_url,synced_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,NOW())
       ON CONFLICT(url) DO UPDATE SET name=EXCLUDED.name,sku=EXCLUDED.sku,
       category=EXCLUDED.category,price_rsd=EXCLUDED.price_rsd,
       available=EXCLUDED.available,image_url=EXCLUDED.image_url,synced_at=NOW()`,
      [p.url,p.name,p.sku,p.category,p.priceRsd,p.available,p.imageUrl]
    );
  }
  return { pages: pageUrls.length, found: candidates.length, saved: products.length };
}

export async function searchProducts(db, query, limit = 5) {
  const clean = String(query || "").trim().slice(0, 120);
  if (!clean) return [];
  const stopWords = new Set(["imate","ima","li","mi","moze","može","molim","vas","za","sa","u","na","od","do","je","su","da","koji","koja","koje","koliko","cena","cijena","proizvod","proizvoda","treba","zelim","želim","neki","neku"]);
  const terms = clean.toLocaleLowerCase("sr").split(/\s+/).map(x => x.replace(/[^\p{L}\p{N}.-]/gu,"")).filter((x) => x.length > 2 && !stopWords.has(x)).slice(0, 5);
  const pattern = `%${clean}%`;
  const result = await db.query(
    `SELECT name,sku,category,price_rsd,available,image_url,url
     FROM products
     WHERE name ILIKE $1 OR COALESCE(category,'') ILIKE $1 OR COALESCE(sku,'') ILIKE $1
        OR (${terms.map((_,i)=>`name ILIKE $${i+2}`).join(" AND ") || "FALSE"})
     ORDER BY CASE WHEN name ILIKE $1 THEN 0 ELSE 1 END, name
     LIMIT ${Number(limit) || 5}`,
    [pattern, ...terms.map((t) => `%${t}%`)]
  );
  return result.rows;
}
