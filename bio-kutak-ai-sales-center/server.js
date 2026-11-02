import "dotenv/config";
import express from "express";
import pg from "pg";
import crypto from "node:crypto";
import { searchProducts } from "./catalog.js";
import { syncCatalogV2 } from "./catalog-v2.js";
import { adviseCustomer } from "./advisor.js";

const { Pool } = pg;
const app = express();
app.set("trust proxy", 1);
const PORT = Number(process.env.PORT || 10000);
const SITE_URL = (process.env.SITE_URL || "https://biokutak.co.rs").replace(/\/$/, "");
const allowedOrigins = new Set([SITE_URL, "https://www.biokutak.co.rs"]);
app.use((req,res,next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Admin-Key");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: "1mb", verify: (req,res,buf) => { req.rawBody = Buffer.from(buf); } }));
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined,
  max: 5
});

let schemaReady = false;
let botPaused = false;
const telegram = (method, body) => fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
}).then(async r => {
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.ok) throw new Error(data.description || `Telegram HTTP ${r.status}`);
  return data.result;
});

const adminIds = () => (process.env.TELEGRAM_ADMIN_CHAT_ID || "").split(",").map(x => x.trim()).filter(Boolean);
const safeEqual = (a, b) => {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
};
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const makeId = (channel) => `BK-${channel.slice(0,2).toUpperCase()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

async function ensureSchema() {
  if (schemaReady) return;
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const fs = await import("node:fs/promises");
  const sql = await fs.readFile(new URL("./schema.sql", import.meta.url), "utf8");
  await pool.query(sql);
  schemaReady = true;
}

async function saveMessage(conversationId, direction, sender, body, metadata = {}) {
  await pool.query(
    "INSERT INTO messages(conversation_id,direction,sender,body,metadata) VALUES($1,$2,$3,$4,$5)",
    [conversationId, direction, sender, String(body).slice(0,8000), metadata]
  );
  await pool.query("UPDATE conversations SET last_message_at=NOW(),updated_at=NOW() WHERE id=$1", [conversationId]);
}

async function getConversation(publicId) {
  const r = await pool.query("SELECT * FROM conversations WHERE public_id=$1", [publicId]);
  return r.rows[0] || null;
}

async function getOrCreateConversation({ channel, externalUserId, customerName, sessionToken }) {
  if (channel === "website" && sessionToken) {
    const tokenHash = hash(sessionToken);
    const existing = await pool.query("SELECT * FROM conversations WHERE session_token_hash=$1 AND status <> 'closed' ORDER BY id DESC LIMIT 1", [tokenHash]);
    if (existing.rows[0]) return existing.rows[0];
  }
  if (externalUserId) {
    const existing = await pool.query(
      "SELECT * FROM conversations WHERE channel=$1 AND external_user_id=$2 AND status <> 'closed' ORDER BY id DESC LIMIT 1",
      [channel, String(externalUserId)]
    );
    if (existing.rows[0]) return existing.rows[0];
  }
  const publicId = makeId(channel);
  const token = channel === "website" ? (sessionToken || crypto.randomBytes(24).toString("hex")) : null;
  const result = await pool.query(
    "INSERT INTO conversations(public_id,channel,external_user_id,customer_name,session_token_hash) VALUES($1,$2,$3,$4,$5) RETURNING *",
    [publicId, channel, externalUserId ? String(externalUserId) : null, customerName || null, token ? hash(token) : null]
  );
  return { ...result.rows[0], session_token: token };
}

async function sendMetaMessage(conversation, text) {
  if (!process.env.META_PAGE_ACCESS_TOKEN || !conversation.external_user_id) throw new Error("Facebook Page access is not configured");
  const version = process.env.META_GRAPH_VERSION;
  if (!version) throw new Error("META_GRAPH_VERSION is not configured");
  const response = await fetch(`https://graph.facebook.com/${version}/me/messages?access_token=${encodeURIComponent(process.env.META_PAGE_ACCESS_TOKEN)}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ recipient: { id: conversation.external_user_id }, messaging_type: "RESPONSE", message: { text } })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || `Meta HTTP ${response.status}`);
}

async function deliverToCustomer(conversation, text) {
  if (conversation.channel === "facebook") return sendMetaMessage(conversation, text);
  if (conversation.channel === "website") return;
  throw new Error(`Sending to channel ${conversation.channel} is not configured`);
}

async function notifyAdmins(conversation, incoming, suggestion, { autoSent = false } = {}) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !adminIds().length) return;
  const buttons = autoSent
    ? [[{ text: "🙋 Preuzmi razgovor", callback_data: `take:${conversation.public_id}` }, { text: "Zatvori", callback_data: `close:${conversation.public_id}` }]]
    : [[
        { text: "✅ Odobri predlog", callback_data: `approve:${conversation.public_id}` },
        { text: "🙋 Preuzmi razgovor", callback_data: `take:${conversation.public_id}` }
      ],[
        { text: "Zatvori", callback_data: `close:${conversation.public_id}` }
      ]];
  const keyboard = { inline_keyboard: buttons };
  const message = [
    autoSent ? `🤖 AUTOMATSKI ODGOVOR POSLAT – ${conversation.public_id}` : `📩 ZAHTEV ZA ODGOVOR – ${conversation.public_id}`,
    `Kanal: ${conversation.channel}`,
    `Kupac: ${conversation.customer_name || conversation.external_user_id || "Posetilac sajta"}`,
    "",
    `Poruka kupca: ${incoming}`,
    "",
    `${autoSent ? "Poslati odgovor" : "Predlog odgovora"}: ${suggestion}`,
    "",
    "Odgovori direktno na ovu Telegram poruku da preuzmeš razgovor i odgovoriš kupcu."
  ].join("\n");
  for (const chatId of adminIds()) {
    const sent = await telegram("sendMessage", { chat_id: chatId, text: message, reply_markup: keyboard });
    await pool.query("UPDATE conversations SET telegram_message_id=$1 WHERE id=$2", [sent.message_id, conversation.id]);
  }
}

function formatProducts(products) {
  return products.slice(0,5).map((p) => {
    const price = p.price_rsd == null ? "Cena nije prikazana na sajtu" : Number(p.price_rsd).toLocaleString("sr-RS") + " RSD";
    const availability = p.available === false ? "Trenutno nedostupan" : p.available === true ? "Dostupnost prikazana na sajtu" : "Proveriti dostupnost";
    const details = [p.description, p.ingredients ? "Sastav: " + p.ingredients : "", p.usage ? "Način upotrebe: " + p.usage : "", p.warnings ? "Upozorenje: " + p.warnings : ""].filter(Boolean).join("\n");
    return "• " + p.name + " – " + price + " (" + availability + ")" + (details ? "\n" + details.slice(0,900) : "") + "\n" + p.url;
  }).join("\n\n");
}

async function classifyAndReply(conversation, message) {
  if (botPaused) return { type: "handoff", text: "Hvala na poruci! Proslediću vaše pitanje kolegama iz BIO KUTAK-a." };
  const lower = message.toLocaleLowerCase("sr").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "dj");
  if (/zdravo|dobar dan|dobro jutro|dobro veče|cao|ćao/.test(lower) && message.trim().split(/\s+/).length < 7) {
    return { type: "auto", text: "Zdravo i dobro došli u BIO KUTAK! 🌿 Napišite koji proizvod tražite ili šta vas zanima, pa ću pokušati da pomognem." };
  }
  if (/radno vreme|kada radite|adresa|gde se nalazite|telefon|kontakt/.test(lower)) {
    return { type: "auto", text: "BIO KUTAK, Dimitrija Tucovića 2, Subotica. Telefon: 024/552-953. Radno vreme: ponedeljak–petak 08–19h, subota 08–13h, nedelja ne radimo. 🌿" };
  }
  // Product-aware follow-ups: use the previous conversation and verified catalogue fields.
  const isFollowUp = /\b(oboje|oba|i jedno i drugo|cemu sluzi|za sta sluzi|za sta je|kakva je korist|sta radi|razlika|razlikuju|uporedi|poredi|koji je bolji|koji da uzmem|sastav|sta sadrzi|kako se koristi|nacin upotrebe|doziranje|koliko se uzima|ima li|da li ima|najskuplji|najskuplje|najskuplji proizvodi|najjeftiniji|najjeftinije|najpovoljniji|najpovoljnije|najvisa cena|najveca cena|najmanja cena|najjeftiniji proizvodi|koliko kosta|koja je cena|cena|na stanju|dostupan|dostupnost|povoljniji|jeftiniji|ima li jos|jos proizvoda|slicni proizvodi|link|gde mogu da kupim)\b/i.test(lower);
  if (isFollowUp) {
    // Broad catalogue ranking questions do not require a product to have been mentioned earlier.
    const asksMostExpensive = /\b(najskuplji|najskuplje|najvisa cena|najveca cena)\b/i.test(lower);
    const asksCheapest = /\b(najjeftiniji|najjeftinije|najpovoljniji|najpovoljnije|najmanja cena)\b/i.test(lower);
    if (asksMostExpensive || asksCheapest) {
      const ranked = await pool.query(
        "SELECT name,price_rsd,available,url FROM products WHERE url IS NOT NULL AND price_rsd IS NOT NULL AND price_rsd > 0 ORDER BY price_rsd " + (asksMostExpensive ? "DESC" : "ASC") + ", name ASC LIMIT 5"
      );
      if (ranked.rows.length) {
        const lines = ranked.rows.map((p, i) =>
          (i + 1) + ". " + p.name + " — " + Number(p.price_rsd).toLocaleString("sr-RS") + " RSD" +
          (p.available === true ? " (dostupan prema sajtu)" : p.available === false ? " (trenutno nedostupan prema sajtu)" : " (stanje nije potvrđeno)") +
          "\n" + p.url
        );
        return { type: "auto", text: (asksMostExpensive ? "Pet najskupljih proizvoda" : "Pet najpovoljnijih proizvoda") +
          " prema cenama koje su trenutno zabeležene u BIO KUTAK katalogu: 🌿\n\n" + lines.join("\n\n") +
          "\n\nCene i dostupnost mogu da se promene; proverite stranicu proizvoda za konačnu potvrdu." };
      }
      return { type: "auto", text: "Trenutno nemam dovoljno potvrđenih cena u katalogu da bih pouzdano izdvojila proizvode po ceni. 🌿" };
    }
    const recent = await pool.query(
      "SELECT direction,body FROM messages WHERE conversation_id=$1 ORDER BY id DESC LIMIT 10",
      [conversation.id]
    );
    const normalizeText = (value) => String(value || "").toLocaleLowerCase("sr").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "dj").replace(/[^a-z0-9]+/g, " ").trim();
    const recentContext = normalizeText(recent.rows.map(row => row.body || "").join(" "));
    const lastBotReply = recent.rows.find(row => row.direction === "out")?.body || "";
    const lastBotContext = normalizeText(lastBotReply);
    // Resolve short price/availability questions directly against the product family in the latest bot reply.
    // This is intentionally independent of exact full-name matching in the rendered catalogue text.
    const latestReplyMentionsShilajit = lastBotContext.includes("shilajit") || lastBotContext.includes("mumio");
    const asksShilajitPrice = /\\b(cena|koliko kosta|koja je cena)\\b/i.test(lower);
    const asksShilajitStock = /\\b(na stanju|dostupan|dostupnost)\\b/i.test(lower);
    if (latestReplyMentionsShilajit && (asksShilajitPrice || asksShilajitStock)) {
      const shilajitProducts = await pool.query(
        "SELECT name,price_rsd,available,url FROM products WHERE url IS NOT NULL AND (name ILIKE '%shilajit%' OR name ILIKE '%mumio%') ORDER BY CASE WHEN available IS TRUE THEN 0 ELSE 1 END, price_rsd ASC NULLS LAST, name ASC"
      );
      if (shilajitProducts.rows.length) {
        const lines = shilajitProducts.rows.map(p =>
          "• " + p.name + " — " + (p.price_rsd == null ? "cena nije navedena" : Number(p.price_rsd).toLocaleString("sr-RS") + " RSD") +
          " — " + (p.available === true ? "dostupan prema sajtu" : p.available === false ? "trenutno nedostupan prema sajtu" : "dostupnost nije potvrđena") +
          (p.url ? "\\n" + p.url : "")
        );
        return { type: "auto", text: (asksShilajitPrice ? "Cene Shilajit/Mumio proizvoda u BIO KUTAK katalogu: 🌿" : "Dostupnost Shilajit/Mumio proizvoda prema katalogu: 🌿") +
          "\\n\\n" + lines.join("\\n\\n") +
          "\\n\\nCene i stanje mogu da se promene; konačnu potvrdu proverite na stranici proizvoda ili u prodavnici." };
      }
    }
    if (/\\b(oboje|oba|i jedno i drugo)\\b/i.test(lower) && /potencija|libido|erekcija/.test(recentContext)) {
      const potencyAdvice = await adviseCustomer(pool, "potencija libido");
      if (potencyAdvice?.products?.length) {
        return { type: "auto", text: potencyAdvice.reply + "\\n\\n" + formatProducts(potencyAdvice.products.map(p => ({ ...p, description: "" }))) + "\\n\\nPrikazani su prvo proizvodi sa višom cenom; cena ne znači da je preparat efikasniji. Cene i dostupnost proverite na stranici proizvoda." };
      }
      if (potencyAdvice?.autoReply) return { type: "auto", text: potencyAdvice.reply };
      return { type: "auto", text: "Razumem — mislite i na potenciju i na libido. 🌿 Proveriću katalog i prikazati samo proizvode čiji opis ili sastav izričito navodi ovu namenu." };
    }
    const wantsComparison = /\b(razlika|razlikuju|uporedi|poredi|koji je bolji|koji da uzmem)\b/i.test(lower);
    const catalogue = await pool.query(
      "SELECT name,category,price_rsd,available,url,description,ingredients,usage,warnings FROM products WHERE url IS NOT NULL ORDER BY name"
    );
    const mentionedProducts = catalogue.rows.filter(product => {
      const productName = normalizeText(product.name);
      return productName.length > 5 && lastBotContext.includes(productName);
    }).slice(0, 5);
    const latestBotMentionsShilajit = lastBotContext.includes("shilajit") || lastBotContext.includes("mumio");

    const asksPriceOrStock = /\b(cena|koliko kosta|koja je cena|na stanju|dostupan|dostupnost|link|gde mogu da kupim)\b/i.test(lower);
    const asksAlternatives = /\b(ima li jos|jos proizvoda|slicni proizvodi|povoljniji|jeftiniji|alternativ)\b/i.test(lower);
    if (mentionedProducts.length && asksPriceOrStock) {
      const product = mentionedProducts[0];
      const price = product.price_rsd == null ? "Cena trenutno nije potvrđena u katalogu." : "Cena: " + Number(product.price_rsd).toLocaleString("sr-RS") + " RSD.";
      const stock = product.available === true ? "Na sajtu je označen kao dostupan." : product.available === false ? "Na sajtu je označen kao trenutno nedostupan." : "Dostupnost nije potvrđena u katalogu.";
      return { type: "auto", text: product.name + "\n" + price + " " + stock + "\n" + product.url + "\n\nCene i stanje mogu da se promene; konačnu potvrdu dobijate na stranici proizvoda ili u prodavnici." };
    }

    if (mentionedProducts.length && asksAlternatives) {
      const base = mentionedProducts[0];
      let alternatives = [];
      if (base.category) {
        const result = await pool.query(
          "SELECT name,price_rsd,available,url FROM products WHERE url IS NOT NULL AND category=$1 AND name<>$2 ORDER BY CASE WHEN available IS TRUE THEN 0 ELSE 1 END, price_rsd ASC NULLS LAST, name LIMIT 6",
          [base.category, base.name]
        );
        alternatives = result.rows;
      }
      if (alternatives.length) {
        const lines = alternatives.map(p => "• " + p.name + " — " + (p.price_rsd == null ? "cena nije navedena" : Number(p.price_rsd).toLocaleString("sr-RS") + " RSD") + " — " + (p.available === true ? "dostupan prema sajtu" : p.available === false ? "trenutno nedostupan prema sajtu" : "stanje nije potvrđeno") + "\n" + p.url);
        return { type: "auto", text: "Evo još proizvoda iz iste kategorije kao " + base.name + ":\n\n" + lines.join("\n\n") + "\n\nPoređao sam ih po ceni, ali niža cena ne znači da je proizvod bolji ili odgovarajući za svaku osobu." };
      }
    }

    if (wantsComparison && mentionedProducts.length >= 2) {
      const comparison = mentionedProducts.slice(0, 4).map(product => {
        const facts = [
          product.description ? "Opis: " + product.description : "",
          product.ingredients ? "Sastav: " + product.ingredients : "Sastav nije naveden u trenutno dostupnim podacima.",
          product.usage ? "Način upotrebe: " + product.usage : "Način upotrebe nije potvrđen u trenutno dostupnim podacima.",
          product.warnings ? "Upozorenje: " + product.warnings : "",
          product.price_rsd == null ? "Cena nije prikazana." : "Cena: " + Number(product.price_rsd).toLocaleString("sr-RS") + " RSD"
        ].filter(Boolean).join("\n");
        return "• " + product.name + "\n" + facts.slice(0, 1100) + "\n" + product.url;
      }).join("\n\n");
      return { type: "auto", text: "Mogu da uporedim proizvode na osnovu podataka koji su trenutno dostupni u BIO KUTAK katalogu. 🌿\n\n" + comparison + "\n\nPoređenje se zasniva na deklaracijama i opisima koji su dostupni na sajtu. Ako neki podatak nedostaje, neću pretpostavljati da su proizvodi isti niti da je jedan bolji. Za konačan izbor proverite deklaraciju i posavetujte se sa farmaceutom ako imate zdravstveno stanje ili koristite terapiju." };
    }

    if (mentionedProducts.length && /\b(cemu sluzi|za sta sluzi|za sta je|kakva je korist|sta radi|sastav|sta sadrzi|kako se koristi|nacin upotrebe|doziranje|koliko se uzima)\b/i.test(lower)) {
      const product = mentionedProducts[0];
      if (latestBotMentionsShilajit) {
        return { type: "auto", text: "Shilajit (poznat i kao Mumio) je mineralna smolasta supstanca koja se prodaje kao dodatak ishrani. Tradicionalno se koristi za energiju i vitalnost, ali dokazi o zdravstvenim koristima su ograničeni. Nije lek i ne treba ga koristiti kao zamenu za terapiju. Važno je proveriti laboratorijsku čistoću proizvoda, posebno zbog mogućih teških metala i drugih zagađivača. Ako koristite lekove ili imate hronično oboljenje, posavetujte se sa lekarom ili farmaceutom. 🌿\\n\\nPitanje se odnosi na Shilajit/Mumio proizvode koje smo upravo prikazali. Mogu da navedem cenu, dostupnost, sastav ili način upotrebe prema deklaraciji." };
      }
      const details = [
        product.description ? "Opis proizvoda na sajtu: " + product.description : "Opis namene nije naveden u katalogu.",
        product.ingredients ? "Sastav: " + product.ingredients : "Sastav nije naveden u trenutno dostupnim podacima.",
        product.usage ? "Način upotrebe: " + product.usage : "Način upotrebe nije potvrđen u trenutno dostupnim podacima.",
        product.warnings ? "Upozorenje: " + product.warnings : ""
      ].filter(Boolean).join("\n\n");
      return { type: "auto", text: "Za **" + product.name + "** mogu da navedem sledeće podatke iz BIO KUTAK kataloga: 🌿\n\n" + details.slice(0, 2400) + "\n\nOpis sa sajta nije zamena za medicinski savet. Ako želite, mogu da uporedim ovaj proizvod sa drugim artiklom iz ponude." };
    }

    if (/magnezij|magnesium/.test(recentContext) && /\b(cemu sluzi|za sta sluzi|za sta je|kakva je korist|sta radi)\b/i.test(lower)) {
      return { type: "auto", text: "Magnezijum je mineral koji doprinosi normalnom radu mišića i nervnog sistema, ravnoteži elektrolita, normalnom metabolizmu stvaranja energije i održavanju normalnih kostiju. Suplement nije lek za grčeve, nesanicu ili umor. 🌿\n\nU ponudi su oralni oblici (citrat i glicinat) i gelovi za spoljašnju upotrebu. Gel se ne može smatrati zamenom za suplement koji se pije. Za izbor oralnog proizvoda važno je proveriti količinu elementarnog magnezijuma po dnevnoj dozi. Ako imate bolest bubrega, trudni ste, dojite ili koristite terapiju, posavetujte se sa lekarom ili farmaceutom." };
    }
  }
  // First let the product adviser handle supported everyday complaints with safe, catalog-grounded replies.
  const advice = await adviseCustomer(pool, message);
  if (advice) {
    if (advice.urgent) return { type: "handoff", text: advice.reply };
    if (advice.autoReply) return { type: "auto", text: advice.reply };
    if (advice.products.length) return { type: "auto", text: advice.reply + "\n\n" + formatProducts(advice.products) + "\n\nCene i dostupnost proverite na stranici proizvoda." };
    return { type: "handoff", text: advice.reply };
  }
  // Topics outside the adviser's supported scope remain with a human; no medical diagnosis or treatment advice.
  if (/bolest|simptom|terapij|lekov|lekove|trudn|dojen|dijabet|pritisak|holesterol|tumor|rak|alergij|interakcij|nuspojav|dete|beba|lečenje|lecenje|izleči|izleci/.test(lower)) {
    return { type: "handoff", text: "Hvala na pitanju. 🌿 Pošto se radi o zdravstvenoj temi koju naš savetnik ne može pouzdano da obradi, proslediću pitanje našem timu. Za zdravstvene odluke obratite se lekaru ili farmaceutu." };
  }
  const products = await searchProducts(pool, message, 5);
  if (products.length) {
    return { type: "auto", text: `Pronašao sam sledeće proizvode u BIO KUTAK katalogu:\n\n${formatProducts(products)}\n\nŽelite li da proverim još neki proizvod? Cene i dostupnost proverite i na stranici proizvoda.` };
  }
  const suggestion = "Hvala na pitanju! 🌿 Proslediću ga našem timu kako bismo proverili tačne informacije i javili vam se.";
  return { type: "handoff", text: suggestion };
}

async function handleIncoming({ channel, externalUserId, customerName, message, sessionToken }) {
  const conversation = await getOrCreateConversation({ channel, externalUserId, customerName, sessionToken });
  await saveMessage(conversation.id, "in", "customer", message, { channel });
  const operatorConnected = Boolean(process.env.TELEGRAM_BOT_TOKEN && adminIds().length);
  if (conversation.status === "human") {
    const acknowledgement = operatorConnected
      ? "Hvala na dodatnoj poruci. Kolega iz BIO KUTAK-a je preuzeo razgovor i odgovoriće vam čim bude moguće."
      : "Hvala na poruci. Za direktnu pomoć trenutno pozovite BIO KUTAK na 024/552-953 ili pišite na prodavnica.biokutak.subotica@gmail.com.";
    await deliverToCustomer(conversation, acknowledgement);
    await saveMessage(conversation.id, "out", "bot", acknowledgement);
    await notifyAdmins(conversation, message, acknowledgement).catch((e) => console.error("Telegram notify failed:", e.message));
    return { conversation, reply: acknowledgement, handoff: true };
  }
  const result = await classifyAndReply(conversation, message);
  if (result.type === "auto") {
    await deliverToCustomer(conversation, result.text);
    await saveMessage(conversation.id, "out", "bot", result.text);
    await notifyAdmins(conversation, message, result.text, { autoSent: true }).catch((e) => console.error("Telegram notify failed:", e.message));
    return { conversation, reply: result.text, handoff: false };
  }
  if (!operatorConnected) {
    const fallback = "Hvala na pitanju. 🌿 Za direktnu pomoć trenutno pozovite BIO KUTAK na 024/552-953 ili pišite na prodavnica.biokutak.subotica@gmail.com.";
    await deliverToCustomer(conversation, fallback);
    await saveMessage(conversation.id, "out", "bot", fallback);
    return { conversation, reply: fallback, handoff: true };
  }
  await pool.query("UPDATE conversations SET status='awaiting_approval',suggested_reply=$1 WHERE id=$2", [result.text, conversation.id]);
  await notifyAdmins(conversation, message, result.text).catch((e) => console.error("Telegram notify failed:", e.message));
  return { conversation, reply: result.text, handoff: true };
}

app.get("/", (_req,res) => res.sendFile(new URL("./public/test.html", import.meta.url).pathname));
app.get("/pametnica", (_req,res) => res.sendFile(new URL("./public/pametnica.html", import.meta.url).pathname));

app.get("/health", async (_req,res) => {
  try {
    await ensureSchema();
    await pool.query("SELECT 1");
    res.json({ ok:true, service:"BIO KUTAK AI Sales Center", database:"connected", version:"0.1.0" });
  } catch (e) { res.status(503).json({ ok:false, error:e.message }); }
});

app.get("/api/catalog/search", async (req,res) => {
  try { await ensureSchema(); res.json({ products: await searchProducts(pool, req.query.q, 10) }); }
  catch (e) { res.status(503).json({ error:"Katalog trenutno nije dostupan." }); }
});

app.post("/api/catalog/sync", async (req,res) => {
  if (!process.env.ADMIN_API_KEY || !safeEqual(req.headers["x-admin-key"], process.env.ADMIN_API_KEY)) return res.sendStatus(401);
  try { await ensureSchema(); res.json(await syncCatalogV2(pool)); }
  catch (e) { res.status(500).json({ error:e.message }); }
});

app.post("/api/chat", async (req,res) => {
  try {
    await ensureSchema();
    const message = String(req.body?.message || "").trim().slice(0,2000);
    if (!message) return res.status(400).json({ error:"Unesite poruku." });
    const sessionToken = String(req.body?.sessionToken || crypto.randomBytes(24).toString("hex"));
    const result = await handleIncoming({ channel:"website", message, sessionToken, customerName:String(req.body?.name || "").slice(0,100) });
    res.json({ conversationId:result.conversation.public_id, sessionToken, reply:result.reply, handoff:result.handoff });
  } catch (e) { console.error(e); res.status(500).json({ error:"Poruka trenutno nije mogla biti poslata." }); }
});

app.get("/api/chat/:id/messages", async (req,res) => {
  try {
    await ensureSchema();
    const token = String(req.query.token || "");
    const c = await getConversation(req.params.id);
    if (!c || !token || !safeEqual(c.session_token_hash, hash(token))) return res.sendStatus(404);
    const r = await pool.query("SELECT direction,sender,body,created_at FROM messages WHERE conversation_id=$1 ORDER BY id DESC LIMIT 30", [c.id]);
    res.json({ messages:r.rows.reverse() });
  } catch { res.sendStatus(500); }
});

app.get("/widget.js", (_req,res) => {
  res.type("application/javascript").sendFile(new URL("./public/widget.js", import.meta.url).pathname);
});

app.get("/webhooks/telegram", (_req,res) => res.status(405).send("POST only"));
app.post("/webhooks/telegram", async (req,res) => {
  if (process.env.TELEGRAM_WEBHOOK_SECRET && !safeEqual(req.headers["x-telegram-bot-api-secret-token"], process.env.TELEGRAM_WEBHOOK_SECRET)) return res.sendStatus(401);
  try {
    await ensureSchema();
    const update = req.body;
    if (update.callback_query) {
      const cb = update.callback_query;
      const chatId = String(cb.message?.chat?.id || "");
      if (!adminIds().includes(chatId)) return res.sendStatus(200);
      const [action, publicId] = String(cb.data || "").split(":");
      const conversation = await getConversation(publicId);
      if (!conversation) return res.sendStatus(200);
      if (action === "take") await pool.query("UPDATE conversations SET status='human' WHERE id=$1",[conversation.id]);
      if (action === "close") await pool.query("UPDATE conversations SET status='closed' WHERE id=$1",[conversation.id]);
      if (action === "approve" && conversation.suggested_reply) {
        try {
          await deliverToCustomer(conversation, conversation.suggested_reply);
          await saveMessage(conversation.id,"out","human-approved",conversation.suggested_reply);
          await pool.query("UPDATE conversations SET status='bot',suggested_reply=NULL WHERE id=$1",[conversation.id]);
        } catch (e) { await telegram("sendMessage",{chat_id:chatId,text:`Slanje nije uspelo: ${e.message}`}); }
      }
      await telegram("answerCallbackQuery",{callback_query_id:cb.id,text:"Sačuvano"});
      return res.sendStatus(200);
    }

    const message = update.message;
    if (!message?.text) return res.sendStatus(200);
    const chatId = String(message.chat.id);
    if (message.text.trim() === "/id") {
      await telegram("sendMessage",{chat_id:chatId,text:`Telegram chat ID: ${chatId}\nDodajte ovaj broj u Render promenljivu TELEGRAM_ADMIN_CHAT_ID, pa ponovo pokrenite servis.`});
      return res.sendStatus(200);
    }
    if (!adminIds().includes(chatId)) {
      await telegram("sendMessage",{chat_id:chatId,text:"BIO KUTAK kontrolni bot. Ovaj nalog nije ovlašćen za upravljanje sistemom."});
      return res.sendStatus(200);
    }
    const text = message.text.trim();
    if (text === "/start" || text === "/help") {
      await telegram("sendMessage",{chat_id:chatId,text:"BIO KUTAK AI Sales Center je povezan. Komande: /status, /sync, /inbox, /pause, /resume, /reply BK-ID tekst, /take BK-ID, /close BK-ID"});
      return res.sendStatus(200);
    }
    if (text === "/status") {
      const counts = await pool.query("SELECT status,COUNT(*)::int AS n FROM conversations GROUP BY status");
      const products = await pool.query("SELECT COUNT(*)::int AS n FROM products");
      await telegram("sendMessage",{chat_id:chatId,text:`Sistem radi.\nKatalog: ${products.rows[0]?.n || 0} proizvoda\nRazgovori: ${JSON.stringify(counts.rows)}\nAI pauziran: ${botPaused ? "DA" : "NE"}`});
      return res.sendStatus(200);
    }
    const resumeConversation = text.match(/^\/resume\s+(BK-[A-Z]+-[A-F0-9]+)$/i);
    if (resumeConversation) {
      const c = await getConversation(resumeConversation[1].toUpperCase());
      if (c) await pool.query("UPDATE conversations SET status='bot',suggested_reply=NULL WHERE id=$1",[c.id]);
      await telegram("sendMessage",{chat_id:chatId,text:c ? `AI ponovo preuzima razgovor ${c.public_id}.` : "Razgovor nije pronađen."});
      return res.sendStatus(200);
    }
    if (text === "/pause" || text === "/resume") {
      botPaused = text === "/pause";
      await telegram("sendMessage",{chat_id:chatId,text:botPaused ? "Automatski odgovori su pauzirani." : "Automatski odgovori su ponovo aktivni."});
      return res.sendStatus(200);
    }
    if (text === "/sync") {
      const result = await syncCatalogV2(pool);
      await telegram("sendMessage",{chat_id:chatId,text:`Sinhronizacija završena: ${result.saved} proizvoda.`});
      return res.sendStatus(200);
    }
    if (text === "/inbox") {
      const r = await pool.query("SELECT public_id,channel,status,customer_name,last_message_at FROM conversations WHERE status IN ('awaiting_approval','human') ORDER BY last_message_at DESC LIMIT 15");
      const lines = r.rows.map(x => `${x.public_id} | ${x.channel} | ${x.status} | ${x.customer_name || "Kupac"}`);
      await telegram("sendMessage",{chat_id:chatId,text:lines.length ? lines.join("\n") : "Nema otvorenih razgovora."});
      return res.sendStatus(200);
    }
    let match = text.match(/^\/(reply|take|close)\s+(BK-[A-Z]+-[A-F0-9]+)(?:\s+([\s\S]+))?$/i);
    let conversation = null, replyText = null, action = null;
    if (match) { action = match[1].toLowerCase(); conversation = await getConversation(match[2].toUpperCase()); replyText = match[3]; }
    else if (message.reply_to_message) {
      const r = await pool.query("SELECT * FROM conversations WHERE telegram_message_id=$1 ORDER BY id DESC LIMIT 1",[message.reply_to_message.message_id]);
      conversation = r.rows[0] || null;
      replyText = text;
      action = "reply";
    }
    if (conversation && action === "take") {
      await pool.query("UPDATE conversations SET status='human' WHERE id=$1",[conversation.id]);
      await telegram("sendMessage",{chat_id:chatId,text:`Preuzeo si razgovor ${conversation.public_id}. Odgovori na poruku obaveštenja da pošalješ odgovor.`});
    } else if (conversation && action === "close") {
      await pool.query("UPDATE conversations SET status='closed' WHERE id=$1",[conversation.id]);
      await telegram("sendMessage",{chat_id:chatId,text:`Razgovor ${conversation.public_id} je zatvoren.`});
    } else if (conversation && action === "reply" && replyText) {
      await deliverToCustomer(conversation, replyText);
      await saveMessage(conversation.id,"out","human",replyText);
      await pool.query("UPDATE conversations SET status='human',suggested_reply=NULL WHERE id=$1",[conversation.id]);
      await telegram("sendMessage",{chat_id:chatId,text:`Odgovor poslat kupcu. Razgovor ${conversation.public_id} ostaje preuzet. Za vraćanje AI-ju pošalji /resume ${conversation.public_id}.`});
    } else {
      await telegram("sendMessage",{chat_id:chatId,text:"Komanda nije prepoznata. Koristi /help ili odgovori na Telegram obaveštenje o razgovoru."});
    }
    return res.sendStatus(200);
  } catch (e) {
    console.error("Telegram webhook error:",e);
    return res.sendStatus(200);
  }
});

app.get("/webhooks/meta", (req,res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && process.env.META_VERIFY_TOKEN && safeEqual(token,process.env.META_VERIFY_TOKEN)) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

app.post("/webhooks/meta", async (req,res) => {
  const signature = req.headers["x-hub-signature-256"];
  if (process.env.META_APP_SECRET) {
    const expected = "sha256=" + crypto.createHmac("sha256",process.env.META_APP_SECRET).update(req.rawBody || Buffer.from(JSON.stringify(req.body))).digest("hex");
    if (!safeEqual(signature,expected)) return res.sendStatus(401);
  }
  res.sendStatus(200);
  try {
    await ensureSchema();
    for (const entry of req.body?.entry || []) {
      for (const event of entry.messaging || []) {
        if (event.message?.is_echo || !event.message?.text) continue;
        await handleIncoming({
          channel:"facebook",
          externalUserId:event.sender?.id,
          customerName:"Facebook kupac",
          message:event.message.text
        });
      }
    }
  } catch (e) { console.error("Meta webhook processing error:",e); }
});

app.listen(PORT, async () => {
  console.log(`BIO KUTAK AI Sales Center listening on ${PORT}`);
  try {
    await ensureSchema();
    console.log("Database schema ready");
    syncCatalogV2(pool).then(result => console.log("Startup catalog sync:",result)).catch(e => console.error("Startup catalog sync failed:",e.message));
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.RENDER_EXTERNAL_URL) {
      await telegram("setWebhook", {
        url: process.env.RENDER_EXTERNAL_URL.replace(/\/$/, "") + "/webhooks/telegram",
        secret_token: process.env.TELEGRAM_WEBHOOK_SECRET || undefined,
        allowed_updates: ["message","callback_query"]
      });
      console.log("Telegram webhook registered");
    }
  } catch (e) { console.error("Startup initialization:",e.message); }
  setInterval(() => syncCatalogV2(pool).then(r => console.log("Scheduled catalog sync:",r)).catch(e => console.error("Scheduled catalog sync failed:",e.message)), 6 * 60 * 60 * 1000);
});
