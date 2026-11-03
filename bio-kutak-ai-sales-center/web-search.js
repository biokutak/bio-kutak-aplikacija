const HEALTH_DOMAINS = [
  "medlineplus.gov", "nhs.uk", "mayoclinic.org",
  "clevelandclinic.org", "nccih.nih.gov", "ema.europa.eu",
  "who.int", "cdc.gov"
];

export async function searchWeb(query, { health = false, limit = 3 } = {}) {
  const clean = String(query || "").trim().slice(0, 300);
  if (!clean) return [];
  const domainFilter = health
    ? " (" + HEALTH_DOMAINS.map(domain => "site:" + domain).join(" OR ") + ")"
    : "";
  const url = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(clean + domainFilter);
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; BioKutakPametnica/1.0)",
      "accept": "text/html"
    },
    signal: AbortSignal.timeout(9000)
  });
  if (!response.ok) throw new Error("Web pretraga nije dostupna: HTTP " + response.status);
  const html = await response.text();
  const results = [];
  const blocks = html.split('class="result ');
  for (const block of blocks.slice(1)) {
    if (results.length >= limit) break;
    const linkMatch = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/div>/i);
    if (!linkMatch || !snippetMatch) continue;
    const decode = value => String(value || "")
      .replace(/<[^>]*>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#x27;|&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim();
    const title = decode(linkMatch[2]);
    const snippet = decode(snippetMatch[1]);
    let href = linkMatch[1].replace(/&amp;/g, "&");
    if (href.startsWith("//")) href = "https:" + href;
    try {
      const parsed = new URL(href);
      const redirected = parsed.searchParams.get("uddg");
      if (redirected) href = redirected;
    } catch { continue; }
    let parsed;
    try { parsed = new URL(href); } catch { continue; }
    if (!["http:", "https:"].includes(parsed.protocol) || !title || !snippet) continue;
    const host = parsed.hostname.startsWith("www.") ? parsed.hostname.slice(4) : parsed.hostname;
    if (health && !HEALTH_DOMAINS.some(domain => host === domain || host.endsWith("." + domain))) continue;
    // Never surface another retailer's product listing as a recommendation when Pametnica cannot answer.
    const commercialPath = /\\/(product|products|shop|store|cart|checkout|kupovina|proizvod|proizvodi)(\\/|$)/i.test(parsed.pathname);
    const salesLanguage = /buy now|add to cart|shop now|order now|kupi odmah|dodaj u korpu|poru[cč]i odmah|cena proizvoda|price:/i.test(title + " " + snippet);
    const commerceHost = /(^|\\.)(amazon|ebay|aliexpress|temu|etsy|walmart|shopify)\\./i.test(host);
    if (!host.endsWith("biokutak.co.rs") && (commercialPath || salesLanguage || commerceHost)) continue;
    results.push({ title: title.slice(0, 180), snippet: snippet.slice(0, 320), url: parsed.href });
  }
  return results;
}
