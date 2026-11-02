CREATE TABLE IF NOT EXISTS conversations (
  id BIGSERIAL PRIMARY KEY,
  public_id TEXT UNIQUE NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('website','facebook','instagram','telegram')),
  external_user_id TEXT,
  customer_name TEXT,
  status TEXT NOT NULL DEFAULT 'bot' CHECK (status IN ('bot','awaiting_approval','human','closed')),
  session_token_hash TEXT,
  suggested_reply TEXT,
  telegram_message_id BIGINT,
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS conversations_status_last_message_idx ON conversations(status,last_message_at DESC);
CREATE INDEX IF NOT EXISTS conversations_channel_external_idx ON conversations(channel,external_user_id);

CREATE TABLE IF NOT EXISTS messages (
  id BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('in','out','internal')),
  sender TEXT NOT NULL,
  body TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS messages_conversation_created_idx ON messages(conversation_id,created_at);

CREATE TABLE IF NOT EXISTS products (
  id BIGSERIAL PRIMARY KEY,
  url TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  sku TEXT,
  category TEXT,
  price_rsd NUMERIC(12,2),
  available BOOLEAN,
  image_url TEXT,
  description TEXT,
  ingredients TEXT,
  usage TEXT,
  warnings TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE products ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS ingredients TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS usage TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS warnings TEXT;
CREATE INDEX IF NOT EXISTS products_name_search_idx ON products USING GIN (to_tsvector('simple', name));
CREATE INDEX IF NOT EXISTS products_sku_idx ON products(sku);

CREATE TABLE IF NOT EXISTS unanswered_questions (
  id BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT REFERENCES conversations(id) ON DELETE SET NULL,
  channel TEXT NOT NULL,
  customer_name TEXT,
  question TEXT NOT NULL,
  question_hash TEXT UNIQUE NOT NULL,
  draft_reply TEXT,
  context JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  occurrences INTEGER NOT NULL DEFAULT 1,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolution_title TEXT,
  resolution TEXT
);
CREATE INDEX IF NOT EXISTS unanswered_questions_status_seen_idx ON unanswered_questions(status,last_seen_at DESC);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
