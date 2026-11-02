import "dotenv/config";
import express from "express";
import pg from "pg";
import crypto from "node:crypto";
import { searchProducts } from "./catalog.js";
import { syncCatalogV2 } from "./catalog-v2.js";
import { adviseCustomer } from "./advisor.js";
import { rebuildKnowledgeBase, ensureKnowledgeSchema, answerProductFollowUp, searchKnowledge, answerFromKnowledge } from "./knowledge.js";

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

async function recordUnansweredQuestion(conversation, question, draftReply) {
  const clean = String(question || "").trim().slice(0,2000);
  if (!clean) return;
  const normalized = clean.toLocaleLowerCase("sr").normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").replace(/đ/g,"dj").replace(/[^a-z0-9\\s]/g," ").replace(/\\s+/g," ").trim();
  const questionHash = hash(normalized);
  const context = await pool.query(
    "SELECT direction,sender,body,created_at FROM messages WHERE conversation_id=$1 ORDER BY id DESC LIMIT 8",
    [conversation.id]
  );
  await pool.query(
    `INSERT INTO unanswered_questions(conversation_id,channel,customer_name,question,question_hash,draft_reply,context)
     VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)
     ON CONFLICT(question_hash) DO UPDATE SET
       occurrences=unanswered_questions.occurrences+1,
       last_seen_at=NOW(),
       context=EXCLUDED.context,
       draft_reply=EXCLUDED.draft_reply
     WHERE unanswered_questions.status='open'`,
    [conversation.id,conversation.channel,conversation.customer_name,clean,questionHash,String(draftReply||"").slice(0,4000),JSON.stringify(context.rows.reverse())]
  );
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
    `Poruka kupca: ${String(incoming || "").slice(0,1000)}`,
    "",
    `${autoSent ? "Poslati odgovor" : "Predlog odgovora"}: ${String(suggestion || "").slice(0,1800)}`,
    "",
    "Odgovori direktno na ovu Telegram poruku da preuzmeš razgovor i odgovoriš kupcu."
  ].join("\n").slice(0,3900);
  for (const chatId of adminIds()) {
    const sent = await telegram("sendMessage", { chat_id: chatId, text: message, reply_markup: keyboard });
    await pool.query("UPDATE conversations SET telegram_message_id=$1 WHERE id=$2", [sent.message_id, conversation.id]);
  }
}

function formatProducts(products) {
  return products.slice(0,5).map((p) => {
    const price = p.price_rsd == null ? "Cena nije prikazana na sajtu" : Number(p.price_rsd).toLocaleString("sr-RS") + " RSD";
    const availability = p.available === false ? "Trenutno nedostupan" : p.available === true ? "Dostupnost prikazana na sajtu" : "Proveriti dostupnost";
    const claimText = [p.description, p.usage].filter(Boolean).join(" ");
    const containsUnverifiedHealthClaims = /le[cč]i|izle[cč]|terapij|antiparazit|antibakter|antivirus|antifungal|antimikrob|antisept|protivgljiv|kandida|parazit|holesterol|triglicerid|hipertenz|krvni pritisak|reguli[sš]e hormone|hormonalni balans|hormonski disbalans|fitoestrogen|estrogen|valunz|menopauz|menstrualn|poma[zž]e kod|ubla[zž]ava|sni[zž]ava|normalizuje nivo|preporu[cč]uje se.*zbog|povoljno deluje|antioksidativn.*svojstv|preventivn.*dejstv|smanjuje rizik|smanjuje zgr[u]?savanje|protiv (raka|tumora|dijabet|astme|depresij|aritmij)|napredovanje raka|sr[cč]anog udara/i.test(claimText);
    const details = [
      !containsUnverifiedHealthClaims && p.description ? p.description : "",
      p.ingredients ? "Sastav: " + p.ingredients : "",
      !containsUnverifiedHealthClaims && p.usage ? "Način upotrebe: " + p.usage : "",
      p.warnings ? "Upozorenje: " + p.warnings : ""
    ].filter(Boolean).join("\n");
    const claimNote = containsUnverifiedHealthClaims ? "\nNapomena: opis sadrži zdravstvene tvrdnje koje nisu potvrda medicinskog dejstva; ne prikazujem ih kao preporuku." : "";
    return "• " + p.name + " – " + price + " (" + availability + ")" + (details ? "\n" + details.slice(0,900) : "") + claimNote + "\n" + p.url;
  }).join("\n\n");
}

async function classifyAndReply(conversation, message) {
  if (botPaused) return { type: "auto", text: "Pametnica trenutno ne može da obradi novi upit. 🌿 Pokušajte ponovo za koji trenutak ili napišite naziv proizvoda koji tražite." };
  const lower = message.toLocaleLowerCase("sr").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "dj");
  if (/zdravo|dobar dan|dobro jutro|dobro veče|cao|ćao/.test(lower) && message.trim().split(/\s+/).length < 7) {
    return { type: "auto", text: "Zdravo i dobro došli u BIO KUTAK! 🌿 Napišite koji proizvod tražite ili šta vas zanima, pa ću pokušati da pomognem." };
  }
  if (/\bpametna pametnic(a|e)\b|\bpametna si pametnic(a|e)\b/.test(lower)) {
    return { type:"auto", text:"Trudim se! 🌿 Najvažnije mi je da vam pronađem tačan artikal, cenu i dostupnost iz BIO KUTAK kataloga — bez nagađanja. Slobodno me testirajte." };
  }
  // Keep ordinary conversation natural; casual messages are not customer-service handoffs.
  const casual = lower.trim().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  if (/^(h+a+h+a+h*a*|he+h*|lol+|:d+|xd+|okej|ok|u redu|dogovoreno|hvala|hvala ti|super|odlicno|vazi|kiss|cmok|cao|vidimo se|laku noc|dobar smeh i sex|umirem od smeha|na ucenju je draga|neka uci|samo neka uci|neka nauci|samo neka nauci|neka douci|samo neka douci|odoh sad)$/.test(casual)) {
    const reply = /hvala/.test(casual) ? "Nema na čemu! 🌿 Tu sam ako vam zatreba pomoć oko proizvoda ili ponude." :
      /kiss|cmok/.test(casual) ? "🌿 Šaljem pozdrav iz BIO KUTAK-a! Tu sam kad zatreba." :
      /cao|vidimo se|odoh|laku noc/.test(casual) ? "Prijatno i svratite nam ponovo! 🌿" :
      "Baš lepo! 😊 Tu sam ako želite da nastavimo razgovor ili da potražimo neki proizvod.";
    return { type: "auto", text: reply };
  }
  if (/^(ups nije dobro|nije dobro|pogresno|pogrešno|sta\??|шта\??|kako\??|koji\??|koja\??|koje\??|a\??)$/i.test(casual)) {
    return { type: "auto", text: "Izvinite ako prethodni odgovor nije bio jasan. 🌿 Na šta tačno mislite — na proizvod koji smo pomenuli ili na nešto drugo? Napišite mi još jednu reč i nastavljamo." };
  }
  if (/^(popij zeno|pa da se otrujem|onda nemoj cukati palac|kad nemam naocare|pa nemam na ocima|imas godina a lazes|pa to da koristi je)$/.test(casual)) {
    return { type: "auto", text: "😊 Izgleda da smo se malo zapetljali u razgovoru! Samo da razjasnimo: ako govorimo o magnezijum gelu, on je namenjen za spoljašnju upotrebu — ne pije se. Recite mi koji proizvod imate i pomoći ću oko deklaracije." };
  }
  // Direct sweetener recommendation: a shopping/nutrition question, never a symptom or medical handoff.
  if (/zamena za secer|zamenu za secer|zamena secera|umesto secera|cime da zamenim secer|zasladjivac|zasladjivace|zasladjivaci/.test(lower)) {
    const sweeteners = (await pool.query(
      "SELECT name,price_rsd,available,url,ingredients,usage FROM products WHERE url IS NOT NULL AND (" +
      "translate(lower(name),'čćžšđ','cczsd') LIKE ANY(ARRAY['%eritritol%','%stevija%','%ksilitol%','%brezin secer%']) " +
      "OR translate(lower(ingredients),'čćžšđ','cczsd') LIKE ANY(ARRAY['%eritritol%','%steviol glikozid%','%ksilitol%'])) " +
      "ORDER BY CASE WHEN translate(lower(name),'čćžšđ','cczsd') LIKE '%stevija eritritol%' THEN 0 WHEN translate(lower(name),'čćžšđ','cczsd') LIKE '%eritritol%' THEN 1 WHEN translate(lower(name),'čćžšđ','cczsd') LIKE '%stevija%' THEN 2 WHEN translate(lower(name),'čćžšđ','cczsd') LIKE '%ksilitol%' THEN 3 ELSE 4 END, name LIMIT 10"
    )).rows;
    const lines = sweeteners.map(p => {
      const price = p.price_rsd == null ? "cena nije navedena" : Number(p.price_rsd).toLocaleString("sr-RS") + " RSD";
      const availability = p.available === false ? "trenutno nedostupan" : p.available === true ? "dostupnost prikazana na sajtu" : "proveriti dostupnost";
      return "• " + p.name + " — " + price + " (" + availability + ")" +
        (p.ingredients ? "\\nSastav: " + p.ingredients.slice(0,220) : "") +
        (p.usage ? "\\nUpotreba: " + p.usage.slice(0,250) : "") + "\\n" + p.url;
    });
    return { type:"auto", text:"Ako želite da zamenite običan beli šećer, najpraktičnije opcije iz naše ponude su: 🌿\\n\\n" +
      (lines.length ? lines.join("\\n\\n") : "Trenutno nisam pronašla zaslađivače u katalogu.") +
      "\\n\\n**Kako da izaberete:**\\n• Eritritol — kristalna zamena za šećer; može imati blago rashlađujući ukus.\\n• Stevija + eritritol — praktična mešavina za napitke i recepte; proverite odnos zamene na deklaraciji jer se proizvodi razlikuju.\\n• Stevija — veoma je slatka, pa se koristi u maloj količini; tečna, tabletirana i praškasta nisu međusobno zamenljive kašičicu za kašičicu.\\n• Ksilitol (brezin šećer) — po slatkoći i upotrebi je sličniji običnom šećeru, ali sadrži kalorije.\\n\\n**Važno:** veće količine eritritola i ksilitola kod nekih ljudi izazivaju nadutost ili proliv; ksilitol je veoma otrovan za pse. Ako zamenu birate zbog dijabetesa ili insulinske rezistencije, nemojte se oslanjati samo na GI tabelu ili marketinške tvrdnje — proverite deklaraciju i dogovorite izbor sa lekarom/dijetetičarem.\\n\\nDa li vam treba za kafu i čaj ili za kolače i kuvanje?" };
  }
  // Plant-based milk alternatives are ordinary food searches, not symptom/medical handoffs.
  if (/zamena za (kravlje )?mleko|zamenu za (kravlje )?mleko|umesto (kravljeg )?mleka|biljno mleko|biljni napitak|biljne napitke|mleko bez laktoze/.test(lower)) {
    const milkProducts = (await pool.query(
      "SELECT name,price_rsd,available,url,ingredients,description FROM products WHERE url IS NOT NULL AND translate(lower(concat_ws(' ',name,category,ingredients,description)),'čćžšđ','cczsd') LIKE ANY(ARRAY['%sojino mleko%','%sojin napitak%','%bademovo mleko%','%bademov napitak%','%ovseno mleko%','%ovseni napitak%','%pirincano mleko%','%pirincani napitak%','%kokosovo mleko%','%kokosov napitak%','%biljni napitak%','%napitak od soje%','%napitak od badema%','%napitak od ovsa%']) ORDER BY CASE WHEN translate(lower(name),'čćžšđ','cczsd') LIKE '%soj%' THEN 0 WHEN translate(lower(name),'čćžšđ','cczsd') LIKE '%ovs%' THEN 1 WHEN translate(lower(name),'čćžšđ','cczsd') LIKE '%badem%' THEN 2 ELSE 3 END, name LIMIT 10"
    )).rows;
    return { type:"auto", text:"Ako tražite zamenu za kravlje mleko, najčešće opcije su sojin, ovseni, bademov ili pirinčani napitak. Izbor zavisi od ukusa, alergija i načina upotrebe. Sojin napitak obično ima više proteina od većine drugih biljnih napitaka; proverite deklaraciju, posebno dodat šećer, kalcijum i vitamin B12. 🌿\\n\\n" +
      (milkProducts.length ? formatProducts(milkProducts) : "Trenutno nisam pronašla biljne napitke u našem katalogu. Mogu da proverim sa kolegama da li ih imamo u prodavnici.") +
      "\\n\\nDa li vam treba za kafu, kuvanje ili svakodnevno umesto mleka? Ako izbegavate mleko zbog alergije na proteine kravljeg mleka, napitak bez laktoze nije odgovarajuća zamena." };
  }
  // Food and dietary searches must not be mistaken for medical symptoms (e.g. "bez šećera").
  const dietaryQuery = /bez glutena|bezglut|gluten|bez secera|bezsecer|bez dodatog secera|bez laktoze|posn|vegansk|vegan|biljni zelatin|agar|tofu|cokolad|keks|kolac|kolace/.test(lower);
  if (dietaryQuery) {
    let foodResults;
    if (/bez glutena|bezglut|gluten/.test(lower)) {
      const wanted = /keks|kolac|cokolad/.test(lower) ? " AND translate(lower(name),'čćžšđ','cczsd') LIKE ANY(ARRAY['%keks%','%kolac%','%cokolad%'])" :
        /brasn/.test(lower) ? " AND translate(lower(name),'čćžšđ','cczsd') LIKE '%brasn%'" :
        /testenin/.test(lower) ? " AND translate(lower(name),'čćžšđ','cczsd') LIKE '%testenin%'" : "";
      foodResults = (await pool.query(
        "SELECT name,sku,category,price_rsd,available,image_url,url,description,ingredients,usage,warnings FROM products WHERE url IS NOT NULL AND translate(lower(concat_ws(' ',name,description,ingredients)),'čćžšđ','cczsd') LIKE ANY(ARRAY['%bez gluten%','%bezgluten%','%gluten free%','%bez glutena%'])" + wanted + " ORDER BY name LIMIT 12"
      )).rows;
    } else if (/bez secera|bezsecer|bez dodatog secera/.test(lower)) {
      const wanted = /cokolad/.test(lower) ? " AND translate(lower(name),'čćžšđ','cczsd') LIKE '%cokolad%'" :
        /keks/.test(lower) ? " AND translate(lower(name),'čćžšđ','cczsd') LIKE '%keks%'" : "";
      foodResults = (await pool.query(
        "SELECT name,sku,category,price_rsd,available,image_url,url,description,ingredients,usage,warnings FROM products WHERE url IS NOT NULL AND translate(lower(concat_ws(' ',name,description,ingredients)),'čćžšđ','cczsd') LIKE ANY(ARRAY['%bez secera%','%bez dodatog secera%','%bez dodatka secera%'])" + wanted + " ORDER BY name LIMIT 12"
      )).rows;
    } else if (/posn/.test(lower)) {
      foodResults = (await pool.query(
        "SELECT name,sku,category,price_rsd,available,image_url,url,description,ingredients,usage,warnings FROM products WHERE url IS NOT NULL AND (name ILIKE '%posn%' OR COALESCE(description,'') ILIKE '%posn%') ORDER BY name LIMIT 8"
      )).rows;
    } else {
      foodResults = await searchProducts(pool, message, 8);
    }
    if (foodResults.length) {
      return { type: "auto", text: "Evo proizvoda iz BIO KUTAK ponude koji odgovaraju vašoj pretrazi: 🌿\n\n" + formatProducts(foodResults) + "\n\nZa posebnu ishranu obavezno proverite kompletnu deklaraciju i alergene; naziv proizvoda sam po sebi nije garancija da odgovara vašim potrebama." };
    }
    if (/bez glutena|bezglut|gluten/.test(lower)) {
      return { type: "auto", text: "Mogu da proverim bezglutenske proizvode, ali trenutno nisam pronašla pouzdan rezultat za ovaj upit u katalogu. Da li tražite keks, brašno, testeninu ili sve bezglutenske proizvode?" };
    }
    if (/bez secera|bezsecer|bez dodatog secera/.test(lower)) {
      return { type: "auto", text: "Trenutno nisam pronašla pouzdano potvrđen proizvod za ovaj upit. Da li tražite čokoladu, keks ili sve proizvode bez dodatog šećera?" };
    }
    if (/posn/.test(lower)) {
      return { type: "auto", text: "Da li tražite posni keks, sastojke za posne kolače ili sve posne proizvode iz ponude? 🌿" };
    }
  }
  // Weight-management catalogue search: show real matching foods/products, without promising weight loss.
  if (/mrsav|smrs|kilogram|kontrola tezine|dijeta/.test(lower)) {
    const weightProducts = (await pool.query(
      "SELECT name,price_rsd,available,url,description,ingredients,usage FROM products WHERE url IS NOT NULL AND (" +
      "translate(lower(name),'čćžšđ','cczsd') LIKE ANY(ARRAY['%garcinia%','%mct%','%bosiljak seme%','%cia seme%','%chia%','%laneno seme%','%mekinje ovsene%','%inulin%','%psilijum%','%fiber z%']) " +
      "OR (translate(lower(name),'čćžšđ','cczsd') LIKE '%caj%' AND translate(lower(concat_ws(' ',description,usage)),'čćžšđ','cczsd') LIKE '%mrsav%')) " +
      "ORDER BY CASE WHEN translate(lower(name),'čćžšđ','cczsd') LIKE '%garcinia%' THEN 0 WHEN translate(lower(name),'čćžšđ','cczsd') LIKE '%mct%' THEN 1 WHEN translate(lower(name),'čćžšđ','cczsd') LIKE '%bosiljak seme%' THEN 2 WHEN translate(lower(name),'čćžšđ','cczsd') LIKE ANY(ARRAY['%cia seme%','%chia%']) THEN 3 ELSE 4 END, name LIMIT 12"
    )).rows;
    return { type:"auto", text:"U BIO KUTAK katalogu sam pronašla proizvode koji se mogu uklopiti u raznovrsnu ishranu i plan kontrole telesne težine. 🌿 Važno: nijedan od njih sam po sebi ne garantuje mršavljenje; MCT ulje/prah je kaloričan, a garcinia i čajevi za mršavljenje nisu zamena za uravnoteženu ishranu i stručni savet." +
      (weightProducts.length ? "\\n\\n" + formatProducts(weightProducts.map(p=>({...p,description:"",ingredients:"",usage:""}))) : "\\n\\nTrenutno nisam pronašla dovoljno pouzdanih podataka za posebne čajeve za mršavljenje ili slim čokoladu. Mogu da proverim i namirnice poput čija semena, semena bosiljka i ovsa.") };
  }
  if (/radno vreme|kada radite|adresa|gde se nalazite|telefon|kontakt/.test(lower)) {
    return { type: "auto", text: "BIO KUTAK, Dimitrija Tucovića 2, Subotica. Telefon: 024/552-953. Radno vreme: ponedeljak–petak 08–19h, subota 08–13h, nedelja ne radimo. 🌿" };
  }
  // Protein questions are catalogue-shopping intents, not medical knowledge questions.
  if (/\b(protein|proteina|proteine|proteinima|proteinski|proteinska|proteinsko|proteini|proteinskim|proteinskih|belancevin|belan[cč]evin)\b/i.test(lower)) {
    const plantOnly = /\b(biljn|biljne|biljni|vegansk|vegan|bez mleka|bez mlecnih|bez laktoze)\b/i.test(lower);
    const sql = "SELECT name,price_rsd,available,url,description,ingredients,usage,warnings FROM products WHERE url IS NOT NULL AND category IN ('osnovne-namirnice','posebna-ishrana','dodaci-ishrani') AND (translate(lower(name),'čćžšđ','cczsd') LIKE ANY(ARRAY['%proteinske plocice%','%protein kokos%','%cookie%','%badem sirovi%','%badem peceni%','%indijski orah%','%kikiriki%','%socivo%','%pasulj%','%grasak%','%bundevino brasno%','%golica%','%semenka%','%seme bundeve%','%pecena neslana soja%','%sojina kobasica%','%tempeh%','%naut%','%leblebija%','%brasno od crvenog sociva%','%brasno od zelenog sociva%','%brasno od pasulja%','%brasno od nauta%','%humus natural%','%humus sa povrcem%','%kikiriki puter%','%badem sirovi%','%badem peceni%','%pasulj crni%']) OR translate(lower(coalesce(ingredients,'')),'čćžšđ','cczsd') LIKE ANY(ARRAY['%protein gras%','%biljni protein%','%protein soje%','%protein bundev%'])) AND (NOT $1 OR (translate(lower(name||' '||coalesce(ingredients,'')),'čćžšđ','cczsd') NOT LIKE '%surutk%' AND translate(lower(name||' '||coalesce(ingredients,'')),'čćžšđ','cczsd') NOT LIKE '%mlecni protein%' AND translate(lower(name||' '||coalesce(ingredients,'')),'čćžšđ','cczsd') NOT LIKE '%kazein%')) AND translate(lower(name),'čćžšđ','cczsd') NOT LIKE '%biljni namaz%' AND translate(lower(name),'čćžšđ','cczsd') NOT LIKE '%biljna pasteta%' AND translate(lower(name),'čćžšđ','cczsd') NOT LIKE '%cookie%' AND translate(lower(name),'čćžšđ','cczsd') NOT LIKE '%keks%' ORDER BY CASE WHEN translate(lower(name),'čćžšđ','cczsd') LIKE '%tempeh%' THEN 0 WHEN translate(lower(name),'čćžšđ','cczsd') LIKE '%pecena neslana soja%' OR translate(lower(name),'čćžšđ','cczsd') LIKE '%sojina kobasica%' THEN 1 WHEN translate(lower(name),'čćžšđ','cczsd') LIKE '%naut%' OR translate(lower(name),'čćžšđ','cczsd') LIKE '%leblebija%' OR translate(lower(name),'čćžšđ','cczsd') LIKE '%sociva%' OR translate(lower(name),'čćžšđ','cczsd') LIKE '%pasulj%' OR translate(lower(name),'čćžšđ','cczsd') LIKE '%grasak%' THEN 2 WHEN translate(lower(name),'čćžšđ','cczsd') LIKE '%bundevino brasno%' OR translate(lower(name),'čćžšđ','cczsd') LIKE '%golica%' THEN 3 WHEN translate(lower(name),'čćžšđ','cczsd') LIKE '%kikiriki puter%' OR translate(lower(name),'čćžšđ','cczsd') LIKE '%badem%' OR translate(lower(name),'čćžšđ','cczsd') LIKE '%indijski orah%' THEN 4 WHEN translate(lower(name),'čćžšđ','cczsd') LIKE '%proteinske plocice%' THEN 5 ELSE 6 END, CASE WHEN available IS TRUE THEN 0 WHEN available IS NULL THEN 1 ELSE 2 END,name LIMIT 12";
    const rows = (await pool.query(sql,[plantOnly])).rows;
    const intro = plantOnly ? "U BIO KUTAK ponudi sam pronašla nekoliko biljnih izvora proteina. 🌿" : "U BIO KUTAK ponudi ima namirnica koje mogu doprineti unosu proteina. 🌿";
    const note = plantOnly ? "Izdvojila sam proizvode biljnog porekla i izostavila artikle sa surutkom, mlečnim proteinima i kazeinom prema dostupnim deklaracijama." : "Predlozi su namirnice i proizvodi iz kataloga, a ne svi su proteinski praškovi. Za tačan sadržaj proteina po porciji proverite nutritivnu tabelu na pakovanju.";
    return { type:"auto", text: rows.length ? intro + "\n\n" + formatProducts(rows) + "\n\n" + note + "\n\nMogu da izdvojim samo veganske namirnice ili proizvode sa najvećim sadržajem proteina." : "Trenutno nisam pronašla dovoljno pouzdanih proizvoda za ovaj upit u katalogu. Mogu da proverim sa prodavnicom." };
  }
  // Direct catalogue intents must win over fuzzy product search and educational knowledge.
  // Flour requests search actual flour products, never snacks that merely contain flour.
  if (/\b(koja|koje|koji|imate li|imate)\b.*\b(brasna|brasno)\b|\b(brasna|brasno)\b.*\b(imate|ponuda)\b/i.test(lower)) {
    const flour = (await pool.query(
      "SELECT name,price_rsd,available,url,description,ingredients,usage,warnings FROM products WHERE url IS NOT NULL AND translate(lower(name),'čćžšđ','cczsd') LIKE '%brasno%' AND translate(lower(name),'čćžšđ','cczsd') NOT LIKE '%bez brasna%' AND name NOT ILIKE '%kreker%' AND name NOT ILIKE 'Brašno, mekinje%' ORDER BY CASE WHEN available IS TRUE THEN 0 WHEN available IS NULL THEN 1 ELSE 2 END, name LIMIT 20"
    )).rows;
    return { type:"auto", text: flour.length
      ? "Evo brašna koja sam pronašla u BIO KUTAK katalogu: 🌿\n\n" + formatProducts(flour) + "\n\nPrikazala sam artikle koji se zaista prodaju kao brašno, a ne krekere ili druge proizvode koji samo sadrže brašno. Ako tražite bezglutenska brašna, mogu da izdvojim samo njih."
      : "Trenutno nisam pronašla brašna u katalogu. Mogu da proverim sa prodavnicom." };
  }
  // The unqualified word oil defaults to edible oils; cosmetic and essential oils are separate.
  if (/\b(koja|koje|koji|imate li|imate)\b.*\bulja\b|\bulja\b.*\b(imate|ponuda)\b/i.test(lower)) {
    const oils = (await pool.query(
      "SELECT name,price_rsd,available,url,description,ingredients,usage,warnings FROM products WHERE url IS NOT NULL AND name ILIKE '%ulje%' AND category IN ('osnovne-namirnice','organski-proizvodi') AND name NOT ILIKE '%MCT%' ORDER BY CASE WHEN available IS TRUE THEN 0 WHEN available IS NULL THEN 1 ELSE 2 END, name LIMIT 25"
    )).rows;
    return { type:"auto", text: oils.length
      ? "Evo jestivih ulja iz BIO KUTAK ponude: 🌿\n\n" + formatProducts(oils) + "\n\nAko ste mislili na ulja za negu kože i kose ili eterična ulja, recite mi — to je posebna kategorija."
      : "Trenutno nisam pronašla jestiva ulja u katalogu. Mogu da proverim sa prodavnicom." };
  }
  // A vitamin name alone is a shopping query first; show the actual matching store item.
  if (/\bvitamin\s*c\b|\bc\s*vitamin\b/i.test(lower) && !/sta je|cemu sluzi|kako deluje|objasni|uloga|izvori|nedostatak/i.test(lower)) {
    const rows = (await pool.query(
      "SELECT name,price_rsd,available,url,description,ingredients,usage,warnings FROM products WHERE url IS NOT NULL AND (translate(lower(name),'čćžšđ','cczsd') LIKE '%vitamin c%' OR translate(lower(name),'čćžšđ','cczsd') LIKE '%c vitamin%') ORDER BY CASE WHEN available IS TRUE THEN 0 WHEN available IS NULL THEN 1 ELSE 2 END, price_rsd ASC NULLS LAST LIMIT 10"
    )).rows;
    return { type:"auto", text: rows.length
      ? "Ovo je vitamin C koji sam pronašla u BIO KUTAK katalogu: 🌿\n\n" + formatProducts(rows) + "\n\nŽelite li cenu, sastav ili opšte informacije o vitaminu C?"
      : "Trenutno nisam pronašla proizvod sa vitaminom C u katalogu. To ne znači da ga nema u prodavnici — mogu da proverim sa kolegama." };
  }
  if (/\bvitamin\s*d\b|\bd\s*vitamin\b/i.test(lower) && !/sta je|cemu sluzi|kako deluje|objasni|uloga|izvori|nedostatak|analiza|25.?oh/i.test(lower)) {
    const rows = (await pool.query(
      "SELECT name,price_rsd,available,url,description,ingredients,usage,warnings FROM products WHERE url IS NOT NULL AND translate(lower(name),'čćžšđ','cczsd') LIKE '%vitamin d%' ORDER BY CASE WHEN available IS TRUE THEN 0 WHEN available IS NULL THEN 1 ELSE 2 END, price_rsd ASC NULLS LAST LIMIT 10"
    )).rows;
    return { type:"auto", text: rows.length
      ? "Ovo su proizvodi sa vitaminom D koje sam pronašla u BIO KUTAK katalogu: 🌿\n\n" + formatProducts(rows) + "\n\nŽelite li cenu, sastav ili opšte informacije o vitaminu D?"
      : "Trenutno nisam pronašla proizvod sa vitaminom D u katalogu. Mogu da proverim sa prodavnicom." };
  }
  // Product-aware follow-ups: use the previous conversation and verified catalogue fields.
  const isFollowUp = /\b(med za varenje|med kod varenja|oboje|oba|i jedno i drugo|cemu sluzi|za sta sluzi|za sta je|kakva je korist|sta radi|razlika|razlikuju|uporedi|poredi|koji je bolji|koji da uzmem|sastav|sta sadrzi|kako se koristi|nacin upotrebe|doziranje|koliko se uzima|ima li|da li ima|najskuplji|najskuplje|najskuplji proizvodi|najjeftiniji|najjeftinije|najpovoljniji|najpovoljnije|najvisa cena|najveca cena|najmanja cena|najjeftiniji proizvodi|koliko kosta|koja je cena|cena|na stanju|dostupan|dostupnost|povoljniji|jeftiniji|ima li jos|jos proizvoda|slicni proizvodi|link|gde mogu da kupim)\b/i.test(lower);
  if (isFollowUp) {
    // Broad catalogue ranking questions do not require a product to have been mentioned earlier.
    const asksMostExpensive = /\b(najskuplji|najskuplje|najvisa cena|najveca cena)\b/i.test(lower);
    const asksCheapest = /\b(najjeftiniji|najjeftinije|najpovoljniji|najpovoljnije|najmanja cena)\b/i.test(lower);
    if (asksMostExpensive || asksCheapest) {
      // A short follow-up such as "a nešto jeftinije" inherits the category from the preceding answer.
      const rankingContextRows = await pool.query(
        "SELECT direction,body FROM messages WHERE conversation_id=$1 ORDER BY id DESC LIMIT 12",
        [conversation.id]
      );
      const rankingContext = normalizeText(rankingContextRows.rows.map(row => row.body || "").join(" "));
      let contextualFilter = "";
      let contextualLabel = "";
      if (/imunitet|immunity|propolis|vitamin c|cink|ehinacea|amla/.test(rankingContext)) {
        contextualFilter = " AND category IN ('osnovne-namirnice','dodaci-ishrani') AND translate(lower(name),'čćžšđ','cczsd') LIKE ANY(ARRAY['%vitamin c%','%c vitamin%','%propolis%','%cink%','%ehinacea%','%amla%','%djumbir%'])";
        contextualLabel = "povoljniji proizvodi povezani sa prethodnim pitanjem o imunitetu";
      } else if (/spavanje|spavam|nesanic|lavanda|valerijan|maticnjak|melisa/.test(rankingContext)) {
        contextualFilter = " AND category IN ('osnovne-namirnice','dodaci-ishrani') AND translate(lower(name),'čćžšđ','cczsd') LIKE ANY(ARRAY['%valerijan%','%lavanda caj%','%maticnjak caj%','%kamilica caj%','%hmelj caj%'])";
        contextualLabel = "povoljniji čajevi i proizvodi iz prethodne pretrage za večernju rutinu";
      }
      const ranked = await pool.query(
        "SELECT name,price_rsd,available,url FROM products WHERE url IS NOT NULL AND price_rsd IS NOT NULL AND price_rsd > 0" + contextualFilter + " ORDER BY price_rsd " + (asksMostExpensive ? "DESC" : "ASC") + ", name ASC LIMIT 5"
      );
      if (ranked.rows.length) {
        const lines = ranked.rows.map((p, i) =>
          (i + 1) + ". " + p.name + " — " + Number(p.price_rsd).toLocaleString("sr-RS") + " RSD" +
          (p.available === true ? " (dostupan prema sajtu)" : p.available === false ? " (trenutno nedostupan prema sajtu)" : " (stanje nije potvrđeno)") +
          "\n" + p.url
        );
        return { type: "auto", text: (contextualLabel ? "Pet " + contextualLabel : asksMostExpensive ? "Pet najskupljih proizvoda" : "Pet najpovoljnijih proizvoda") +
          " prema cenama koje su trenutno zabeležene u BIO KUTAK katalogu: 🌿\n\n" + lines.join("\n\n") +
          "\n\nCene i dostupnost mogu da se promene; proverite stranicu proizvoda za konačnu potvrdu." };
      }
      return { type: "auto", text: contextualLabel ? "Trenutno nisam pronašla jeftiniji odgovarajući artikal u istoj grupi proizvoda. Neću prikazivati nepovezane proizvode samo zato što su jeftini. 🌿" : "Trenutno nemam dovoljno potvrđenih cena u katalogu da bih pouzdano izdvojila proizvode po ceni. 🌿" };
    }
    const recent = await pool.query(
      "SELECT direction,body FROM messages WHERE conversation_id=$1 ORDER BY id DESC LIMIT 10",
      [conversation.id]
    );
    const latestBotMessage = recent.rows.find(row => row.direction === "out")?.body || "";
    if (!/magnezij|magnesium/.test(lower) && /magnezij|magnesium/.test(latestBotMessage) && /kako se koristi|upotreba|doziranje/.test(lower)) {
      return { type:"auto", text:"Naravno. Samo da ne dam pogrešno uputstvo: da li mislite na magnezijum gel za spoljašnju upotrebu ili na oralni magnezijum (citrat/glicinat u kapsulama ili tabletama)? Gel se ne pije, a oralni preparati se koriste prema deklaraciji." };
    }
    if (/med za varenje|med kod varenja/.test(lower)) {
      return { type:"auto", text:"Da li tražite med kao prehrambeni proizvod ili pitate šta može pomoći kod tegoba sa varenjem? 🌿 Ako je u pitanju tegoba, napišite da li imate nadutost, gorušicu, zatvor, proliv ili bol." };
    }
    if (/magnezij|magnesium/.test(lower) && /kako se koristi|upotreba|doziranje/.test(lower) && !/gel/.test(lower)) {
      const options = (await pool.query(
        "SELECT name,price_rsd,available,url FROM products WHERE url IS NOT NULL AND (name ILIKE '%magnezij%' OR name ILIKE '%magnesium%') ORDER BY CASE WHEN name ILIKE '%citrat%' THEN 0 WHEN name ILIKE '%glycinat%' THEN 1 WHEN name ILIKE '%gel%' THEN 2 ELSE 3 END, name LIMIT 8"
      )).rows;
      const lines = options.map(p => "• " + p.name + " — " + (p.price_rsd == null ? "cena nije navedena" : Number(p.price_rsd).toLocaleString("sr-RS")+" RSD") + "\\n" + p.url);
      return { type:"auto", text:"Magnezijum se ne koristi isto u svim oblicima. 🌿 Oralni preparati (npr. citrat ili glicinat) uzimaju se prema deklaraciji i količini elementarnog magnezijuma, dok je magnezijum hlorid gel namenjen spoljašnjoj upotrebi i ne pije se.\\n\\nU ponudi imamo:" + (lines.length ? "\\n\\n"+lines.join("\\n\\n") : "") + "\\n\\nDa li pitate za gel ili za kapsule/tablete? Ako napišete tačan naziv, preneću način upotrebe sa deklaracije." };
    }
    if (/magnezij|magnesium/.test(lower) && /gel|kako se koristi|upotreba/.test(lower)) {
      const gels = (await pool.query(
        "SELECT name,price_rsd,available,url,usage,warnings FROM products WHERE url IS NOT NULL AND (name ILIKE '%magnezijum hlorid gel%' OR name ILIKE '%magnesium gel%') ORDER BY name"
      )).rows;
      if (gels.length) {
        const lines = gels.map(p => "• " + p.name + " — " + (p.price_rsd == null ? "cena nije navedena" : Number(p.price_rsd).toLocaleString("sr-RS")+" RSD") +
          "\\nNačin upotrebe prema katalogu: " + (p.usage || "nije naveden; proverite deklaraciju") +
          (p.warnings ? "\\nUpozorenje: " + p.warnings : "") + "\\n" + p.url);
        return { type:"auto", text:"Magnezijum hlorid gel je proizvod za spoljašnju upotrebu, ne pije se. Prema deklaracijama u našem katalogu: 🌿\\n\\n" + lines.join("\\n\\n") +
          "\\n\\nPratite uputstvo na konkretnom pakovanju. Prekinite upotrebu ako nastane jaka iritacija; ne nanositi na oštećenu kožu ili sluzokožu." };
      }
    }
    const knowledgeReply = await answerProductFollowUp(pool, recent.rows, message);
    if (knowledgeReply) return knowledgeReply;
    const normalizeText = (value) => String(value || "").toLocaleLowerCase("sr").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "dj").replace(/[^a-z0-9]+/g, " ").trim();
    const recentContext = normalizeText(recent.rows.map(row => row.body || "").join(" "));
    const lastBotReply = recent.rows.find(row => row.direction === "out")?.body || "";
    const lastBotContext = normalizeText(lastBotReply);
    const asksAnyPrice = /\b(cena|koliko kosta|koja je cena)\b/i.test(lower);
    if (asksAnyPrice && /\bvitamin d\b/.test(recentContext)) {
      const rows = (await pool.query("SELECT name,price_rsd,available,url FROM products WHERE url IS NOT NULL AND translate(lower(name),'čćžšđ','cczsd') LIKE '%vitamin d%' ORDER BY CASE WHEN available IS TRUE THEN 0 WHEN available IS NULL THEN 1 ELSE 2 END, price_rsd ASC NULLS LAST")).rows;
      if (rows.length) return { type:"auto", text:"Cene proizvoda sa vitaminom D u BIO KUTAK katalogu: 🌿\n\n" + rows.map(p => "• " + p.name + " — " + (p.price_rsd == null ? "cena nije potvrđena" : Number(p.price_rsd).toLocaleString("sr-RS") + " RSD") + " — " + (p.available === true ? "dostupno prema sajtu" : p.available === false ? "trenutno nedostupno prema sajtu" : "dostupnost nije potvrđena") + "\n" + p.url).join("\n\n") };
    }
    if (asksAnyPrice && /\bvitamin c\b/.test(recentContext)) {
      const rows = (await pool.query("SELECT name,price_rsd,available,url FROM products WHERE url IS NOT NULL AND (translate(lower(name),'čćžšđ','cczsd') LIKE '%vitamin c%' OR translate(lower(name),'čćžšđ','cczsd') LIKE '%c vitamin%') ORDER BY CASE WHEN available IS TRUE THEN 0 WHEN available IS NULL THEN 1 ELSE 2 END, price_rsd ASC NULLS LAST")).rows;
      if (rows.length) return { type:"auto", text:"Cena proizvoda sa vitaminom C u BIO KUTAK katalogu: 🌿\n\n" + rows.map(p => "• " + p.name + " — " + (p.price_rsd == null ? "cena nije potvrđena" : Number(p.price_rsd).toLocaleString("sr-RS") + " RSD") + " — " + (p.available === true ? "dostupno prema sajtu" : p.available === false ? "trenutno nedostupno prema sajtu" : "dostupnost nije potvrđena") + "\n" + p.url).join("\n\n") };
    }
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
    if (asksPriceOrStock && !mentionedProducts.length && asksAnyPrice) {
      return { type:"auto", text:"Naravno. 🌿 Na koji proizvod mislite? Napišite naziv ili grupu proizvoda (na primer vitamin D, čaj ili ulje), pa ću proveriti cenu u katalogu." };
    }
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
  // Dedicated, catalogue-grounded answers for common herb and wellness-program questions.
  if (/\b(holesterol|holesterola|holesterolu|ldl|trigliceridi|masnoce u krvi)\b/i.test(lower)) {
    const foods = await pool.query(
      "SELECT name,price_rsd,available,url FROM products WHERE url IS NOT NULL AND (name ILIKE '%mekinje ovsene%' OR name ILIKE '%mleveni lan%' OR name ILIKE '%laneno brasno%' OR name ILIKE '%leblebija%') ORDER BY CASE WHEN name ILIKE '%mekinje ovsene%' THEN 0 WHEN name ILIKE '%mleveni lan%' THEN 1 ELSE 2 END, name LIMIT 5"
    );
    const lines = foods.rows.map(p => "• " + p.name + (p.price_rsd == null ? "" : " — " + Number(p.price_rsd).toLocaleString("sr-RS") + " RSD") + "\n" + p.url);
    return { type:"auto", text:"Kod povišenog holesterola najvažniji su ukupna procena rizika i laboratorijski nalazi, posebno LDL i trigliceridi. Kao deo uravnotežene ishrane mogu se razmotriti namirnice sa rastvorljivim vlaknima, poput ovsa i lana. To nije terapija niti zamena za lekove koje je propisao lekar. 🌿\n\nU BIO KUTAK katalogu sam pronašla ove prehrambene proizvode:" + (lines.length ? "\n\n" + lines.join("\n\n") : "\nTrenutno nemam potvrđene artikle za ovaj upit.") + "\n\nNemojte prekidati ili menjati terapiju zbog suplementa. Ako mi kažete da li je povišen LDL, trigliceridi ili oba, mogu preciznije da usmerim pretragu." };
  }
  if (/\bvirak\b|alchemilla/.test(lower)) {
    const result = await pool.query("SELECT name,price_rsd,available,url,ingredients,usage FROM products WHERE url IS NOT NULL AND (name ILIKE '%virak%' OR COALESCE(ingredients,'') ILIKE '%Alchemilla vulgaris%') ORDER BY name LIMIT 5");
    const p = result.rows[0];
    return { type:"auto", text:"Virak (Alchemilla vulgaris) je biljka koja se u tradicionalnoj upotrebi najčešće povezuje sa menstrualnim i drugim ženskim tegobama. Važno je razlikovati tradicionalnu upotrebu od dokazanog dejstva: nema dovoljno pouzdanih dokaza da virak reguliše hormone, leči policistične jajnike ili rešava poremećaje ciklusa. 🌿" + (p ? "\n\nU BIO KUTAK ponudi imamo: **" + p.name + "**" + (p.price_rsd == null ? "" : " — " + Number(p.price_rsd).toLocaleString("sr-RS") + " RSD") + "\nSastav: " + (p.ingredients || "pogledajte deklaraciju") + "\n" + p.url : "\nTrenutno nisam pronašla proizvod sa virkom u katalogu.") + "\n\nAko ste trudni, dojite, koristite terapiju ili imate hormonsko oboljenje, proverite upotrebu sa lekarom ili farmaceutom. Ne bih ga predstavljala kao terapiju za PCOS ili hormonski disbalans." };
  }
  if (/antiparazit|protiv parazita|crevni parazit|paraziti|parazitar/.test(lower)) {
    const result = await pool.query("SELECT name,price_rsd,available,url,usage FROM products WHERE url IS NOT NULL AND (name ILIKE '%detox naturalis%' OR name ILIKE '%tinktura crnog oraha%' OR name ILIKE '%tinktura pelina%' OR name ILIKE '%tinktura karanfilica%' OR name ILIKE '%biljne kapi protiv kandide%') ORDER BY CASE WHEN name ILIKE '%detox naturalis%' THEN 0 ELSE 1 END, name LIMIT 8");
    const lines = result.rows.map(p => "• **" + p.name + "**" + (p.price_rsd == null ? "" : " — " + Number(p.price_rsd).toLocaleString("sr-RS") + " RSD") + "\n" + p.url);
    return { type:"auto", text:"Razumem — pitate za antiparazitni program. 🌿 U katalogu sam pronašla sledeće proizvode koji se opisuju u vezi sa ovom temom:" + (lines.length ? "\n\n" + lines.join("\n\n") : "\nTrenutno nemam potvrđen poseban antiparazitni program kao komplet u katalogu.") + "\n\nVažno: biljni preparati i suplementi nisu dokazano lečenje crevnih parazita i ne treba ih koristiti umesto dijagnostike i terapije. Ako sumnjate na parazite, lekar može odrediti odgovarajuću analizu stolice i lečenje prema uzročniku. Neću sastavljati režim niti doziranje kombinovanjem tinktura. Poseban oprez je potreban u trudnoći i dojenju, kod dece, epilepsije i uz lekove." };
  }
  // First let the product adviser handle supported everyday complaints with safe, catalog-grounded replies.
  const advice = await adviseCustomer(pool, message);
  if (advice) {
    if (advice.urgent) return { type: "auto", text: advice.reply };
    if (advice.autoReply) return { type: "auto", learningNeeded: Boolean(advice.learningNeeded), text: advice.reply };
    if (advice.products.length) return { type: "auto", text: advice.reply + "\n\n" + formatProducts(advice.products) + "\n\nCene i dostupnost proverite na stranici proizvoda." };
    return { type: "auto", learningNeeded: Boolean(advice.learningNeeded), text: advice.reply || "Mogu da pomognem opštim informacijama. Recite mi malo preciznije šta vas zanima." };
  }
  // Use the knowledge base before the generic medical-topic handoff so known topics get an answer.
  const knowledgeAnswer = await answerFromKnowledge(pool, message);
  if (knowledgeAnswer) return knowledgeAnswer;
  // When the knowledge base has no exact match, still answer helpfully instead of routing routine questions to staff.
  // Never diagnose or prescribe; explain the limit and ask one useful follow-up question.
  if (/bolest|simptom|terapij|lekov|lekove|trudn|dojen|dijabet|pritisak|holesterol|tumor|rak|alergij|interakcij|nuspojav|dete|beba|lečenje|lecenje|izleči|izleci/.test(lower)) {
    return { type: "auto", learningNeeded: true, text: "Mogu da objasnim opšte informacije i da proverim sastav proizvoda iz BIO KUTAK ponude, ali ne mogu da postavim dijagnozu niti da odredim terapiju. 🌿 Zabeležila sam pitanje da dopunimo bazu znanja. Napišite mi šta tačno želite da saznate — koji simptom ili stanje, koliko dugo traje i da li pitate za odraslu osobu ili dete. Ako su simptomi jaki, nagli ili se pogoršavaju, obratite se lekaru; kod otežanog disanja, bola u grudima, gubitka svesti ili otoka jezika/grla odmah pozovite hitnu pomoć." };
  }
  const products = await searchProducts(pool, message, 5);
  if (products.length) {
    return { type: "auto", text: `Pronašao sam sledeće proizvode u BIO KUTAK katalogu:\n\n${formatProducts(products)}\n\nŽelite li da proverim još neki proizvod? Cene i dostupnost proverite i na stranici proizvoda.` };
  }
  return { type: "auto", learningNeeded: true, text: "Nisam pronašla dovoljno pouzdan podatak ili tačan artikal za ovo pitanje u katalogu, pa neću da nagađam. 🌿 Zabeležila sam pitanje kako bi BIO KUTAK mogao da dopuni moje znanje. Možete mi reći još neki detalj, a ja ću pokušati da pronađem odgovarajući artikal." };
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
  if (result.learningNeeded) {
    await recordUnansweredQuestion(conversation, message, result.text).catch(e => console.error("Could not save unanswered question:", e.message));
  }
  if (result.type === "auto") {
    await deliverToCustomer(conversation, result.text);
    await saveMessage(conversation.id, "out", "bot", result.text);
    // Routine questions answered by Pametnica stay in the bot conversation.
    // Do not forward every customer message to the team via Telegram.
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

app.get("/api/knowledge/status", async (_req,res) => {
  try {
    await ensureSchema();
    await ensureKnowledgeSchema(pool);
    const counts = await pool.query("SELECT entry_type,COUNT(*)::int AS total FROM knowledge_entries GROUP BY entry_type");
    const products = await pool.query("SELECT COUNT(*)::int AS total FROM products");
    res.json({ ok:true, entries:counts.rows, catalogProducts:products.rows[0]?.total || 0 });
  } catch (e) { res.status(503).json({ ok:false, error:"Baza znanja trenutno nije dostupna." }); }
});

app.get("/api/admin/unanswered", async (req,res) => {
  if (!process.env.ADMIN_API_KEY || !safeEqual(req.headers["x-admin-key"], process.env.ADMIN_API_KEY)) return res.sendStatus(401);
  try {
    await ensureSchema();
    const status = String(req.query.status || "open");
    const limit = Math.max(1,Math.min(100,Number(req.query.limit)||50));
    const result = await pool.query(
      "SELECT id,channel,customer_name,question,occurrences,first_seen_at,last_seen_at,draft_reply,context FROM unanswered_questions WHERE status=$1 ORDER BY last_seen_at DESC LIMIT $2",
      [status,limit]
    );
    const counts = await pool.query("SELECT status,COUNT(*)::int AS total FROM unanswered_questions GROUP BY status");
    res.json({ ok:true, questions:result.rows, counts:counts.rows });
  } catch(e) { res.status(500).json({ ok:false,error:e.message }); }
});

app.post("/api/admin/unanswered/:id/resolve", async (req,res) => {
  if (!process.env.ADMIN_API_KEY || !safeEqual(req.headers["x-admin-key"], process.env.ADMIN_API_KEY)) return res.sendStatus(401);
  try {
    await ensureSchema();
    await ensureKnowledgeSchema(pool);
    const answer = String(req.body?.answer || "").trim().slice(0,8000);
    const title = String(req.body?.title || "").trim().slice(0,200);
    const keywords = String(req.body?.keywords || "").trim().slice(0,1000);
    if (!answer || !title) return res.status(400).json({ ok:false,error:"Potrebni su title i answer." });
    const item = await pool.query("SELECT * FROM unanswered_questions WHERE id=$1 AND status='open'",[req.params.id]);
    if (!item.rows[0]) return res.status(404).json({ ok:false,error:"Otvoreno pitanje nije pronađeno." });
    const q = item.rows[0];
    const slug = "learned:" + hash(String(q.question_hash)).slice(0,48);
    await pool.query(
      `INSERT INTO knowledge_entries(slug,entry_type,title,keywords,content,source,verified_at,updated_at)
       VALUES($1,'guide',$2,$3,$4,'BIO KUTAK – odgovor potvrđen od administratora',NOW(),NOW())
       ON CONFLICT(slug) DO UPDATE SET title=EXCLUDED.title,keywords=EXCLUDED.keywords,content=EXCLUDED.content,source=EXCLUDED.source,verified_at=NOW(),updated_at=NOW()`,
      [slug,title,[q.question,keywords].filter(Boolean).join(" "),answer]
    );
    await pool.query("UPDATE unanswered_questions SET status='resolved',resolved_at=NOW(),resolution_title=$2,resolution=$3 WHERE id=$1",[q.id,title,answer]);
    res.json({ ok:true, learned:true, id:q.id, title, message:"Odgovor je dodat u bazu znanja Pametnice." });
  } catch(e) { res.status(500).json({ ok:false,error:e.message }); }
});

app.get("/api/knowledge/search", async (req,res) => {
  try {
    await ensureSchema();
    const entries = await searchKnowledge(pool, String(req.query.q || "").slice(0,200), 8);
    res.json({ entries });
  } catch (e) { res.status(503).json({ error:"Pretraga baze znanja trenutno nije dostupna." }); }
});

app.post("/api/catalog/sync", async (req,res) => {
  if (!process.env.ADMIN_API_KEY || !safeEqual(req.headers["x-admin-key"], process.env.ADMIN_API_KEY)) return res.sendStatus(401);
  try {
    await ensureSchema();
    const catalog = await syncCatalogV2(pool);
    const knowledge = await rebuildKnowledgeBase(pool);
    res.json({ catalog, knowledge });
  } catch (e) { res.status(500).json({ error:e.message }); }
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
    await ensureKnowledgeSchema(pool);
    rebuildKnowledgeBase(pool).then(result => console.log("Knowledge base initialized:",result)).catch(e => console.error("Knowledge base initialization failed:",e.message));
    syncCatalogV2(pool).then(async result => {
      console.log("Startup catalog sync:",result);
      const knowledge = await rebuildKnowledgeBase(pool);
      console.log("Knowledge base synced:",knowledge);
    }).catch(e => console.error("Startup catalog sync failed:",e.message));
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.RENDER_EXTERNAL_URL) {
      await telegram("setWebhook", {
        url: process.env.RENDER_EXTERNAL_URL.replace(/\/$/, "") + "/webhooks/telegram",
        secret_token: process.env.TELEGRAM_WEBHOOK_SECRET || undefined,
        allowed_updates: ["message","callback_query"]
      });
      console.log("Telegram webhook registered");
    }
  } catch (e) { console.error("Startup initialization:",e.message); }
  setInterval(() => syncCatalogV2(pool).then(async r => {
    console.log("Scheduled catalog sync:",r);
    const knowledge = await rebuildKnowledgeBase(pool);
    console.log("Scheduled knowledge base sync:",knowledge);
  }).catch(e => console.error("Scheduled catalog sync failed:",e.message)), 6 * 60 * 60 * 1000);
});
