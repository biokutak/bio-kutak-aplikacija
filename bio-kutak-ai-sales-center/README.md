# BIO KUTAK AI Sales Center

Separate service for a shared BIO KUTAK customer-conversation inbox.

## Current MVP scope

- Website chat widget (/widget.js) and chat API.
- Product catalogue import from the public BIO KUTAK website (/pretraga + product pages).
- Telegram operator inbox with approve / take-over / close actions.
- Meta Messenger webhook endpoints, ready for a Page with the correct permissions and Page access token.
- PostgreSQL persistence in an isolated Neon project.

**Important:** this first version uses deterministic catalogue matching and fixed safe replies. It is not yet a generative AI model. Do not describe it to customers as a full LLM assistant until an AI provider or local model has been configured and tested. Health-related product questions are escalated; product pages are treated as catalogue data, not medical advice.

## Deployment

Render Web Service:
- Repository: biokutak/bio-kutak-aplikacija
- Branch: bio-kutak-ai-sales-center
- Build command: cd bio-kutak-ai-sales-center && npm install
- Start command: cd bio-kutak-ai-sales-center && npm start
- Region: Frankfurt
- Health endpoint: /health

Required environment:
- DATABASE_URL – Neon pooled PostgreSQL connection string.
- SITE_URL=https://biokutak.co.rs
- TELEGRAM_BOT_TOKEN – create via @BotFather.
- TELEGRAM_ADMIN_CHAT_ID – private operator chat ID (get it by sending /id to the bot after webhook is configured).
- TELEGRAM_WEBHOOK_SECRET – long random secret.
- ADMIN_API_KEY – long random key for protected catalogue sync.

Optional Meta environment:
- META_VERIFY_TOKEN
- META_APP_SECRET
- META_PAGE_ACCESS_TOKEN
- META_PAGE_ID
- META_GRAPH_VERSION

Never commit tokens or database connection strings to GitHub.

## Website widget

Add this before the closing body tag on the BIO KUTAK website after deployment:

<script src="https://YOUR-RENDER-SERVICE.onrender.com/widget.js" defer></script>

The widget calls the API on the same service origin. CORS is restricted to SITE_URL and www BIO KUTAK.

## Telegram setup

1. Create a bot using @BotFather and copy its token directly into Render environment variables.
2. Set TELEGRAM_WEBHOOK_SECRET and deploy/restart. The service registers its webhook automatically when TELEGRAM_BOT_TOKEN is present.
3. Send /id to the bot and copy the returned numeric chat ID into TELEGRAM_ADMIN_CHAT_ID.
4. Restart the service and send /start.
5. Use /status, /sync, /inbox, /pause, /resume, /reply BK-ID message, /take BK-ID, and /close BK-ID.
6. To answer a customer, reply directly to the Telegram notification message.

## Meta Messenger

The server exposes:
- GET /webhooks/meta for webhook verification.
- POST /webhooks/meta for message events.

A Page administrator must connect the Page to a Meta Developer App, grant the required messaging task/permissions, configure the webhook fields, and provide a Page access token. The service cannot attach itself to a Page without those account permissions. Complete Meta App Review / access requirements before public production use.

## API

- GET /health
- GET /api/catalog/search?q=magnesium
- POST /api/catalog/sync with header x-admin-key: ADMIN_API_KEY
- POST /api/chat with JSON body containing message
- GET /api/chat/:conversationId/messages?token=...

## Data and safety

- Conversations and messages are stored in PostgreSQL.
- Website session tokens are stored only as SHA-256 hashes.
- The Meta webhook signature is verified when META_APP_SECRET is configured.
- Telegram webhook requests are checked using TELEGRAM_WEBHOOK_SECRET.
- Product availability is not inferred if the website does not clearly publish it.
- The bot does not diagnose, prescribe, or make treatment claims.
