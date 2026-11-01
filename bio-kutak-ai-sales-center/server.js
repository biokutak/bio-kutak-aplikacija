import "dotenv/config";
import express from "express";
import pg from "pg";
import crypto from "node:crypto";
import { searchProducts, syncCatalog } from "./catalog.js";

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

async function notifyAdmins(conversation, incoming, suggestion) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !adminIds().length) return;
  const keyboard = {
    inline_keyboard: [[
      { text: "✅ Odobri predlog", callback_data: `approve:${conversation.public_id}` },
      { text: "🙋 Preuzmi razgovor", callback_data: `take:${conversation.public_id}` }
    ],[
      { text: "Zatvori", callback_data: `close:${conversation.public_id}` }
    ]]
  };
  const message = [
    `📩 NOVI ZAHTEV – ${conversation.public_id}`,
    `Kanal: ${conversation.channel}`,
    `Kupac: ${conversation.customer_name || conversation.external_user_id || "Posetilac sajta"}`,
    "",
    `Poruka: ${incoming}`,
    "",
    `AI predlog: ${suggestion}`,
    "",
    "Odgovori direktno na ovu Telegram poruku da pošalješ odgovor kupcu."
  ].join("\n");
  for (const chatId of adminIds()) {
    const sent = await telegram("sendMessage", { chat_id: chatId, text: message, reply_markup: keyboard });
    await pool.query("UPDATE conversations SET telegram_message_id=$1 WHERE id=$2", [sent.message_id, conversation.id]);
  }
}

function formatProducts(products) {
  return products.slice(0,3).map((p) => {
    const price = p.price_rsd == null ? "Cena nije prikazana na sajtu" : `${Number(p.price_rsd).toLocaleString("sr-RS")} RSD`;
    const availability = p.available === false ? "Trenutno nedostupan" : p.available === true ? "Dostupnost prikazana na sajtu" : "Proveriti dostupnost";
    return `• ${p.name} – ${price} ( ${availability} )\n${p.url}`;
  }).join("\n\n");
}

async function classifyAndReply(conversation, message) {
  if (botPaused) return { type: "handoff", text: "Hvala na poruci! Proslediću vaše pitanje kolegama iz BIO KUTAK-a." };
  const lower = message.toLocaleLowerCase("sr");
  if (/bolest|simptom|terapij|lekov|lekove|trudn|dojen|dijabet|pritisak|holesterol|tumor|rak|alergij|interakcij|nuspojav|dete|beba|lečenje|lecenje|izleči|izleci/.test(lower)) {
    return { type: "handoff", text: "Hvala na pitanju. 🌿 Pošto se radi o zdravstvenoj temi, neću davati medicinski savet niti preporučivati terapiju. Proslediću pitanje našem timu; za zdravstvene odluke obratite se lekaru ili farmaceutu." };
  }
  if (/zdravo|dobar dan|dobro jutro|dobro veče|cao|ćao/.test(lower) && message.trim().split(/\s+/).length < 7) {
    return { type: "auto", text: "Zdravo i dobro došli u BIO KUTAK! 🌿 Napišite koji proizvod tražite ili šta vas zanima, pa ću pokušati da pomognem." };
  }
  if (/radno vreme|kada radite|adresa|gde se nalazite|telefon|kontakt/.test(lower)) {
    return { type: "auto", text: "BIO KUTAK, Dimitrija Tucovića 2, Subotica. Telefon: 024/552-953. Radno vreme: ponedeljak–petak 08–19h, subota 08–13h, nedelja ne radimo. 🌿" };
  }
  const products = await searchProducts(pool, message, 3);
  if (products.length) {
    return { type: "auto", text: `Pronašao sam sledeće proizvode u BIO KUTAK katalogu:\n\n${formatProducts(products)}\n\nŽelite li da proverim još neki proizvod? Cene i dostupnost proverite i na stranici proizvoda.` };
  }
  const suggestion = "Hvala na pitanju! 🌿 Proslediću ga našem timu kako bismo proverili tačne informacije i javili vam se.";
  return { type: "handoff", text: suggestion };
}

async function handleIncoming({ channel, externalUserId, customerName, message, sessionToken }) {
  const conversation = await getOrCreateConversation({ channel, externalUserId, customerName, sessionToken });
  await saveMessage(conversation.id, "in", "customer", message, { channel });
  if (conversation.status === "human") {
    const acknowledgement = "Hvala na dodatnoj poruci. Kolega iz BIO KUTAK-a je preuzeo razgovor i odgovoriće vam čim bude moguće.";
    await notifyAdmins(conversation, message, acknowledgement).catch((e) => console.error("Telegram notify failed:", e.message));
    return { conversation, reply: acknowledgement, handoff: true };
  }
  const result = await classifyAndReply(conversation, message);
  if (result.type === "auto") {
    await deliverToCustomer(conversation, result.text);
    await saveMessage(conversation.id, "out", "bot", result.text);
    return { conversation, reply: result.text, handoff: false };
  }
  await pool.query("UPDATE conversations SET status='awaiting_approval',suggested_reply=$1 WHERE id=$2", [result.text, conversation.id]);
  await notifyAdmins(conversation, message, result.text).catch((e) => console.error("Telegram notify failed:", e.message));
  return { conversation, reply: result.text, handoff: true };
}

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
  try { await ensureSchema(); res.json(await syncCatalog(pool)); }
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
    if (text === "/pause" || text === "/resume") {
      botPaused = text === "/pause";
      await telegram("sendMessage",{chat_id:chatId,text:botPaused ? "Automatski odgovori su pauzirani." : "Automatski odgovori su ponovo aktivni."});
      return res.sendStatus(200);
    }
    if (text === "/sync") {
      const result = await syncCatalog(pool);
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
      await pool.query("UPDATE conversations SET status='bot',suggested_reply=NULL WHERE id=$1",[conversation.id]);
      await telegram("sendMessage",{chat_id:chatId,text:`Odgovor poslat kupcu u razgovoru ${conversation.public_id}.`});
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
    const count = await pool.query("SELECT COUNT(*)::int AS n FROM products");
    if (count.rows[0].n === 0) {
      const result = await syncCatalog(pool);
      console.log("Initial catalog sync:",result);
    }
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.RENDER_EXTERNAL_URL) {
      await telegram("setWebhook", {
        url: process.env.RENDER_EXTERNAL_URL.replace(/\/$/, "") + "/webhooks/telegram",
        secret_token: process.env.TELEGRAM_WEBHOOK_SECRET || undefined,
        allowed_updates: ["message","callback_query"]
      });
      console.log("Telegram webhook registered");
    }
  } catch (e) { console.error("Startup initialization:",e.message); }
  setInterval(() => syncCatalog(pool).then(r => console.log("Scheduled catalog sync:",r)).catch(e => console.error("Scheduled catalog sync failed:",e.message)), 6 * 60 * 60 * 1000);
});
