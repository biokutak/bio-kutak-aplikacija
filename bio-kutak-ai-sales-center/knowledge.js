const normalize = value => String(value || "")
  .toLocaleLowerCase("sr")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/đ/g, "dj")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

const GUIDES = [
  {
    slug: "supplement-basics",
    title: "Osnovne informacije o suplementima",
    keywords: "suplement dodatak ishrani vitamini minerali doza doziranje lek terapija",
    content: "Dodaci ishrani dopunjuju uobičajenu ishranu i nisu lekovi. Ne služe za dijagnostikovanje, lečenje ili sprečavanje bolesti i ne zamenjuju propisanu terapiju. Količina i način upotrebe moraju se proveriti na deklaraciji konkretnog proizvoda. Ne treba prekoračivati preporučenu dnevnu dozu niti kombinovati više preparata sa istim sastojkom bez provere ukupnog unosa."
  },
  {
    slug: "medicine-interactions",
    title: "Suplementi i lekovi",
    keywords: "lekovi terapija interakcije farmaceut lekar kombinovanje",
    content: "Biljni preparati, vitamini i minerali mogu uticati na dejstvo lekova ili povećati rizik od neželjenih reakcija. Osoba koja koristi redovnu terapiju, ima hronično oboljenje ili ide na operaciju treba da proveri konkretan proizvod sa lekarom ili farmaceutom pre upotrebe. Terapiju ne treba prekidati ili menjati zbog suplementa."
  },
  {
    slug: "pregnancy-breastfeeding",
    title: "Trudnoća i dojenje",
    keywords: "trudnoca trudnice dojenje dojilje beba",
    content: "Tokom trudnoće i dojenja bezbednost biljnih preparata, eteričnih ulja i suplemenata mora se proveriti za svaki sastojak i dozu. Oznaka prirodno ne znači automatski bezbedno. Pre upotrebe obavezno se posavetovati sa ginekologom, lekarom ili farmaceutom."
  },
  {
    slug: "children",
    title: "Proizvodi za decu",
    keywords: "deca dete beba deciji decji uzrast",
    content: "Proizvodi za odrasle ne treba automatski davati deci. Prikladnost zavisi od uzrasta, sastava i doze. Za dete, naročito bebu, ne preporučivati suplement ili biljni preparat bez provere deklaracije i saveta pedijatra ili farmaceuta."
  },
  {
    slug: "product-quality",
    title: "Kako proveriti kvalitet proizvoda",
    keywords: "kvalitet cistoca laboratorijski test sertifikat poreklo serija deklaracija",
    content: "Pri izboru dodatka ishrani proveriti kompletnu deklaraciju, proizvođača ili odgovorno lice, seriju, rok upotrebe, sastav, preporučenu dnevnu dozu i upozorenja. Kod sirovina koje mogu biti kontaminirane važni su proverljivi laboratorijski testovi i podaci o kontroli kvaliteta. Ne zaključivati o kvalitetu samo na osnovu marketinških tvrdnji."
  },
  {
    slug: "herbal-tea",
    title: "Biljni čajevi – opšta uputstva",
    keywords: "caj biljni caj priprema prelivanje kuvanje infuzija",
    content: "Način pripreme zavisi od biljke i dela biljke koji se koristi. List i cvet se često pripremaju prelivanjem vrelom vodom, dok se koren i tvrđi delovi mogu pripremati drugačije. Uvek pratiti deklaraciju konkretnog proizvoda; ne pretpostavljati dozu, vreme kuvanja ili učestalost ako nisu navedeni. Biljni čaj nije zamena za medicinsku terapiju."
  },
  {
    slug: "cosmetics-use",
    title: "Bezbedna upotreba kozmetike",
    keywords: "kozmetika krema serum ulje koza lice alergija test",
    content: "Pre upotrebe kozmetičkog proizvoda pročitati sastav i upozorenja. Kod osetljive kože ili sklonosti alergijama može se prvo probati mala količina na ograničenom delu kože, osim ako deklaracija ne nalaže drugačije. Prekinuti upotrebu ako se javi jaka iritacija. Proizvode namenjene spoljašnjoj upotrebi ne gutati i izbegavati kontakt sa očima ako deklaracija tako nalaže."
  },
  {
    slug: "allergy-safety",
    title: "Alergije i sastojci",
    keywords: "alergija alergije alergeni sastav reakcija osetljivost",
    content: "Pre kupovine proveriti sve sastojke i moguće alergene. Pri poznatoj alergiji ne koristiti proizvod ako sadrži odgovarajući alergen ili ako sastav nije dovoljno jasan. Otok jezika ili grla, otežano disanje ili brzo širenje ozbiljne reakcije zahtevaju hitnu medicinsku pomoć."
  },
  {
    slug: "medical-red-flags",
    title: "Kada je potreban lekar",
    keywords: "lekar hitno simptomi bol disanje krvarenje temperatura",
    content: "Prodavnica i dodaci ishrani ne mogu zameniti medicinsku procenu. Kod bola u grudima, otežanog disanja, gubitka svesti, iznenadne slabosti jedne strane tela, obilnog krvarenja, jakog iznenadnog bola ili otoka jezika i grla odmah potražiti hitnu pomoć. Kod upornih, novih ili pogoršavajućih tegoba obratiti se lekaru."
  },
  {
    slug: "catalog-data",
    title: "Kako Pametnica koristi BIO KUTAK katalog",
    keywords: "katalog proizvodi cena dostupnost sastav upotreba deklaracija",
    content: "Podaci o nazivu, ceni, dostupnosti, sastavu, opisu, načinu upotrebe i upozorenjima preuzimaju se iz BIO KUTAK kataloga. Ako podatak nije pronađen ili nije potvrđen, Pametnica treba jasno da kaže da podatak nedostaje i da ne nagađa. Cena i stanje zaliha mogu se promeniti; konačnu potvrdu daje prodavnica ili stranica proizvoda."
  }
];

export async function ensureKnowledgeSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS knowledge_entries (
      id BIGSERIAL PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      entry_type TEXT NOT NULL CHECK (entry_type IN ('guide','product')),
      title TEXT NOT NULL,
      keywords TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      product_url TEXT,
      source TEXT NOT NULL DEFAULT 'BIO KUTAK',
      verified_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS knowledge_entries_type_idx ON knowledge_entries(entry_type);
    CREATE INDEX IF NOT EXISTS knowledge_entries_product_url_idx ON knowledge_entries(product_url);
    CREATE INDEX IF NOT EXISTS knowledge_entries_search_idx ON knowledge_entries USING GIN (to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(keywords,'') || ' ' || coalesce(content,'')));
  `);
}

export async function rebuildKnowledgeBase(db) {
  await ensureKnowledgeSchema(db);
  for (const guide of GUIDES) {
    await db.query(
      `INSERT INTO knowledge_entries(slug,entry_type,title,keywords,content,source,verified_at,updated_at)
       VALUES($1,'guide',$2,$3,$4,'BIO KUTAK – opšta bezbednosna pravila',NOW(),NOW())
       ON CONFLICT(slug) DO UPDATE SET title=EXCLUDED.title,keywords=EXCLUDED.keywords,content=EXCLUDED.content,source=EXCLUDED.source,verified_at=NOW(),updated_at=NOW()`,
      [guide.slug,guide.title,guide.keywords,guide.content]
    );
  }
  const result = await db.query(
    `INSERT INTO knowledge_entries(slug,entry_type,title,keywords,content,product_url,source,verified_at,updated_at)
     SELECT
       'product:' || id::text,
       'product',
       name,
       concat_ws(' ',category,sku,name),
       concat_ws(E'\\n',
         name,
         CASE WHEN category IS NOT NULL THEN 'Kategorija: ' || category END,
         CASE WHEN sku IS NOT NULL THEN 'Šifra: ' || sku END,
         CASE WHEN description IS NOT NULL THEN 'Opis: ' || description END,
         CASE WHEN ingredients IS NOT NULL THEN 'Sastav: ' || ingredients END,
         CASE WHEN usage IS NOT NULL THEN 'Način upotrebe: ' || usage END,
         CASE WHEN warnings IS NOT NULL THEN 'Upozorenja: ' || warnings END,
         CASE WHEN price_rsd IS NULL THEN 'Cena nije potvrđena.' ELSE 'Cena: ' || price_rsd::text || ' RSD.' END,
         CASE WHEN available IS TRUE THEN 'Dostupnost: dostupno prema katalogu.' WHEN available IS FALSE THEN 'Dostupnost: trenutno nedostupno prema katalogu.' ELSE 'Dostupnost nije potvrđena.' END
       ),
       url,
       'BIO KUTAK katalog',
       NOW(),
       NOW()
     FROM products WHERE url IS NOT NULL
     ON CONFLICT(slug) DO UPDATE SET
       title=EXCLUDED.title,keywords=EXCLUDED.keywords,content=EXCLUDED.content,
       product_url=EXCLUDED.product_url,source=EXCLUDED.source,
       verified_at=NOW(),updated_at=NOW()
     RETURNING id`
  );
  return { guides:GUIDES.length, products:result.rowCount, total:GUIDES.length+result.rowCount };
}

const QUESTION_TYPES = [
  {id:"price", re:/\b(cena|cene|koliko kosta|koja je cena|koliko je)\b/},
  {id:"availability", re:/\b(dostupnost|dostupan|dostupno|na stanju|ima li)\b/},
  {id:"ingredients", re:/\b(sastav|sastojci|sta sadrzi|od cega je)\b/},
  {id:"usage", re:/\b(kako se koristi|nacin upotrebe|doziranje|koliko se uzima|kako da koristim)\b/},
  {id:"warnings", re:/\b(upozorenje|upozorenja|nuspojave|nezeljena dejstva|kontraindikacije)\b/},
  {id:"purpose", re:/\b(cemu sluzi|za sta sluzi|za sta je|kakva je korist|sta radi|namena)\b/},
  {id:"link", re:/\b(link|gde mogu da kupim|stranica proizvoda)\b/}
];

function productMentionedInReply(product, normalizedReply) {
  const name = normalize(product.name);
  const sku = normalize(product.sku);
  const slug = normalize(String(product.url || "").split("/").filter(Boolean).at(-1) || "");
  return (name.length > 4 && normalizedReply.includes(name)) ||
    (sku.length > 4 && normalizedReply.includes(sku)) ||
    (slug.length > 8 && normalizedReply.includes(slug));
}

export async function answerProductFollowUp(db, recentRows, message) {
  const q = normalize(message);
  const kind = QUESTION_TYPES.find(x => x.re.test(q))?.id;
  if (!kind) return null;
  const latestReply = recentRows.find(row => row.direction === "out")?.body || "";
  const normalizedReply = normalize(latestReply);
  if (!normalizedReply) return null;
  const productsResult = await db.query(
    "SELECT name,sku,category,price_rsd,available,url,description,ingredients,usage,warnings FROM products WHERE url IS NOT NULL ORDER BY name"
  );
  const matched = productsResult.rows.filter(p => productMentionedInReply(p,normalizedReply)).slice(0,8);
  if (!matched.length) return null;

  const value = (p) => {
    if (kind === "price") return p.price_rsd == null ? "cena nije potvrđena u katalogu" : Number(p.price_rsd).toLocaleString("sr-RS") + " RSD";
    if (kind === "availability") return p.available === true ? "dostupan prema katalogu" : p.available === false ? "trenutno nedostupan prema katalogu" : "dostupnost nije potvrđena";
    if (kind === "ingredients") return p.ingredients || "sastav nije naveden u trenutno dostupnim podacima";
    if (kind === "usage") return p.usage || "način upotrebe nije naveden; proverite deklaraciju proizvoda";
    if (kind === "warnings") return p.warnings || "posebna upozorenja nisu navedena u trenutno dostupnim podacima";
    if (kind === "purpose") return p.description || "opis namene nije naveden u katalogu";
    return p.url;
  };
  const labels = {price:"Cena",availability:"Dostupnost",ingredients:"Sastav",usage:"Način upotrebe",warnings:"Upozorenja",purpose:"Opis proizvoda",link:"Link"};
  const lines = matched.map(p => "• " + p.name + "\n" + labels[kind] + ": " + value(p) + (kind === "link" || kind === "price" || kind === "availability" ? "\n" + p.url : ""));
  const lead = kind === "price" ? "Cene proizvoda koje smo upravo prikazali:" :
    kind === "availability" ? "Dostupnost proizvoda koje smo upravo prikazali:" :
    "Podaci za proizvode koje smo upravo prikazali:";
  return { type:"auto", text:lead + " 🌿\n\n" + lines.join("\n\n") +
    (kind === "price" || kind === "availability" ? "\n\nPodaci su preuzeti iz BIO KUTAK kataloga i mogu se promeniti; konačnu potvrdu proverite u prodavnici." : "") };
}

export async function searchKnowledge(db, query, limit=5) {
  await ensureKnowledgeSchema(db);
  const terms = normalize(query).split(" ").filter(x=>x.length>2).slice(0,10);
  if (!terms.length) return [];
  const result = await db.query(
    `SELECT slug,entry_type,title,keywords,content,product_url,source,
      ts_rank(to_tsvector('simple',coalesce(title,'') || ' ' || coalesce(keywords,'') || ' ' || coalesce(content,'')), plainto_tsquery('simple',$1)) AS rank
     FROM knowledge_entries
     WHERE to_tsvector('simple',coalesce(title,'') || ' ' || coalesce(keywords,'') || ' ' || coalesce(content,'')) @@ plainto_tsquery('simple',$1)
        OR title ILIKE $2 OR keywords ILIKE $2
     ORDER BY rank DESC, updated_at DESC LIMIT $3`,
    [terms.join(" "),"%"+terms.join("%")+"%",Math.max(1,Math.min(10,limit))]
  );
  return result.rows;
}
