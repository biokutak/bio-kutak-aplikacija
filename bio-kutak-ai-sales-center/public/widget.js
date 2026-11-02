(() => {
  const script = document.currentScript;
  const apiBase = new URL(script.src).origin;
  if (document.getElementById("bk-ai-chat-root")) return;

  const root = document.createElement("div");
  root.id = "bk-ai-chat-root";
  root.innerHTML = `
    <style>
      #bk-ai-chat-root{font-family:Arial,sans-serif;z-index:2147483000;position:fixed;right:20px;bottom:20px}
      #bk-ai-open{border:0;border-radius:999px;padding:14px 20px;background:#236b45;color:white;font-weight:700;box-shadow:0 8px 28px #0003;cursor:pointer}
      #bk-ai-panel{display:none;width:min(360px,calc(100vw - 32px));height:480px;max-height:70vh;background:#fff;border:1px solid #ddd;border-radius:16px;box-shadow:0 12px 40px #0003;overflow:hidden;margin-bottom:10px;color:#202820}
      #bk-ai-head{background:#236b45;color:#fff;padding:14px;font-weight:700;display:flex;justify-content:space-between;align-items:center}
      #bk-ai-close{background:transparent;border:0;color:#fff;font-size:22px;cursor:pointer}
      #bk-ai-log{height:350px;overflow:auto;padding:12px;background:#f7faf7}
      .bk-ai-msg{max-width:88%;padding:10px 12px;border-radius:12px;margin:8px 0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px;line-height:1.4}
      .bk-ai-bot{background:#e6f1e9;margin-right:auto}.bk-ai-user{background:#dceaff;margin-left:auto}
      #bk-ai-form{display:flex;gap:6px;padding:10px;border-top:1px solid #eee}
      #bk-ai-input{min-width:0;flex:1;border:1px solid #ccc;border-radius:9px;padding:10px;font-size:14px}
      #bk-ai-send{border:0;border-radius:9px;padding:0 14px;background:#236b45;color:#fff;cursor:pointer}
      #bk-ai-note{font-size:10px;color:#777;padding:0 12px 8px}
    </style>
    <section id="bk-ai-panel" aria-label="BIO KUTAK pomoć">
      <header id="bk-ai-head"><span>🌿 BIO KUTAK pomoć</span><button id="bk-ai-close" aria-label="Zatvori">×</button></header>
      <div id="bk-ai-log" aria-live="polite"><div class="bk-ai-msg bk-ai-bot">Zdravo! Dobro došli u BIO KUTAK. Napišite koji proizvod tražite ili šta vas zanima.</div></div>
      <form id="bk-ai-form"><input id="bk-ai-input" maxlength="2000" placeholder="Napišite poruku..." autocomplete="off" required><button id="bk-ai-send">Pošalji</button></form>
      <div id="bk-ai-note">Automatska pomoć BIO KUTAK-a. Za stručni zdravstveni savet obratite se zdravstvenom radniku.</div>
    </section>
    <button id="bk-ai-open">💬 Pitajte BIO KUTAK</button>`;
  document.body.appendChild(root);

  const panel = root.querySelector("#bk-ai-panel");
  const log = root.querySelector("#bk-ai-log");
  const input = root.querySelector("#bk-ai-input");
  let sessionToken = localStorage.getItem("bk_ai_session") || "";
  let conversationId = "";
  let lastSeen = 0;

  const add = (text, side) => {
    const node = document.createElement("div");
    node.className = "bk-ai-msg " + (side === "user" ? "bk-ai-user" : "bk-ai-bot");
    const parts = String(text || "").split(/(https:\/\/biokutak\.co\.rs\/[^\s<>"']*)/gi);
    for (const part of parts) {
      if (/^https:\/\/biokutak\.co\.rs\//i.test(part)) {
        const link = document.createElement("a");
        link.href = part.replace(/[),.;!?]+$/,"");
        link.textContent = "Otvori proizvod";
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.style.cssText = "color:#176b43;text-decoration:underline;font-weight:700;display:inline-block;margin-top:3px";
        node.appendChild(link);
      } else node.appendChild(document.createTextNode(part));
    }
    log.appendChild(node);
    log.scrollTop = log.scrollHeight;
  };

  root.querySelector("#bk-ai-open").onclick = () => { panel.style.display = "block"; root.querySelector("#bk-ai-open").style.display = "none"; input.focus(); };
  root.querySelector("#bk-ai-close").onclick = () => { panel.style.display = "none"; root.querySelector("#bk-ai-open").style.display = "block"; };

  root.querySelector("#bk-ai-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message) return;
    input.value = "";
    add(message,"user");
    try {
      const response = await fetch(apiBase + "/api/chat", {
        method:"POST", headers:{"content-type":"application/json"},
        body:JSON.stringify({message,sessionToken})
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Greška");
      sessionToken = data.sessionToken;
      conversationId = data.conversationId;
      localStorage.setItem("bk_ai_session",sessionToken);
      add(data.reply,"bot");
    } catch {
      add("Trenutno ne mogu da pošaljem poruku. Pokušajte ponovo malo kasnije.","bot");
    }
  });

  setInterval(async () => {
    if (!conversationId || !sessionToken || panel.style.display === "none") return;
    try {
      const response = await fetch(apiBase + "/api/chat/" + encodeURIComponent(conversationId) + "/messages?token=" + encodeURIComponent(sessionToken));
      if (!response.ok) return;
      const data = await response.json();
      for (const message of data.messages || []) {
        const stamp = new Date(message.created_at).getTime();
        if (message.direction === "out" && message.sender === "human" && stamp > lastSeen) add(message.body,"bot");
        lastSeen = Math.max(lastSeen,stamp || 0);
      }
    } catch {}
  },5000);
})();