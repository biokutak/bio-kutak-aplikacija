import * as cheerio from "cheerio";

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
  const $ = cheerio.load(html);
  const results = [];
  $(".result").each((_, element) => {
    if (results.length >= limit) return;
    const item = $(element);
    const anchor = item.find(".result__a").first();
    const title = anchor.text().trim();
    let href = anchor.attr("href") || "";
    if (href.startsWith("//")) href = "https:" + href;
    try {
      const parsed = new URL(href);
      const redirected = parsed.searchParams.get("uddg");
      if (redirected) href = decodeURIComponent(redirected);
    } catch {}
    const snippet = item.find(".result__snippet").first().text().replace(/\\s+/g, " ").trim();
    if (!title || !snippet || !/^https?:\\/\\//i.test(href)) return;
    let host = "";
    try { host = new URL(href).hostname.replace(/^www\\./, ""); } catch { return; }
    if (health && !HEALTH_DOMAINS.some(domain => host === domain || host.endsWith("." + domain))) return;
    results.push({ title: title.slice(0, 180), snippet: snippet.slice(0, 260), url: href });
  });
  return results;
}
