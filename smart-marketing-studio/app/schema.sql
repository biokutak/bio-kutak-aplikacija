CREATE TABLE IF NOT EXISTS products (
 id BIGSERIAL PRIMARY KEY, product_url TEXT NOT NULL UNIQUE, name TEXT NOT NULL, sku TEXT,
 category TEXT, brand TEXT, price NUMERIC(12,2), old_price NUMERIC(12,2), unit TEXT,
 image_url TEXT, source_payload JSONB NOT NULL DEFAULT '{}'::jsonb, active BOOLEAN NOT NULL DEFAULT TRUE,
 synced_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS products_name_idx ON products(name);
CREATE TABLE IF NOT EXISTS creative_templates (
 id BIGSERIAL PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT,
 width INTEGER NOT NULL, height INTEGER NOT NULL, resolution_label TEXT NOT NULL DEFAULT '4K',
 enabled BOOLEAN NOT NULL DEFAULT TRUE, sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS creative_requests (
 id BIGSERIAL PRIMARY KEY, product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
 template_id BIGINT NOT NULL REFERENCES creative_templates(id), status TEXT NOT NULL DEFAULT 'selected',
 instructions TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS generated_assets (
 id BIGSERIAL PRIMARY KEY, request_id BIGINT REFERENCES creative_requests(id) ON DELETE SET NULL,
 product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE, template_code TEXT NOT NULL,
 file_name TEXT NOT NULL, file_url TEXT, width INTEGER, height INTEGER, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS catalog_sync_runs (
 id BIGSERIAL PRIMARY KEY, status TEXT NOT NULL DEFAULT 'running', products_seen INTEGER NOT NULL DEFAULT 0,
 products_inserted INTEGER NOT NULL DEFAULT 0, products_updated INTEGER NOT NULL DEFAULT 0,
 error_text TEXT, started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), finished_at TIMESTAMPTZ
);
INSERT INTO creative_templates(code,name,description,width,height,resolution_label,sort_order) VALUES
('facebook','Facebook reklama','Portretna promotivna fotografija',1080,1920,'Full HD / 4K',1),
('tv','Bio Kutak TV','Horizontalna reklama za TV ekran',3840,2160,'4K UHD',2),
('strapi','Strapi slika','Kvadratna fotografija proizvoda',2160,2160,'4K',3),
('strapi_no_packaging','Strapi bez ambalaže','Kvadratni prikaz sadržaja bez ambalaže',2160,2160,'4K',4)
ON CONFLICT(code) DO NOTHING;
