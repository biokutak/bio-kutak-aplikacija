const normalize = (value) => String(value || "")
  .toLocaleLowerCase("sr")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/đ/g, "dj")
  .replace(/[^a-z0-9\s]/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const INTENTS = [
  {
    id: "back-care",
    patterns: ["bole me ledja", "bol u ledjima", "krsta", "ukocena ledja", "ukocio sam se", "boli me kicma", "bol u kicmi", "vrat me boli", "boli me vrat", "ramena me bole", "bol u misicima", "upala misica", "zglobovi me bole", "bol u zglobovima"],
    terms: ["gavez", "magnezijum hlorid gel", "magnezijum sprej", "mast od gaveza", "ulje za telo"],
    intro: "Razumem. U katalogu sam pronašao nekoliko proizvoda za spoljašnju negu tela koji bi mogli biti relevantni ako tražite preparat za masažu ili negu kože. To nisu lekovi i ne mogu da leče bol u leđima."
  },
  {
    id: "sleep",
    patterns: ["ne mogu da spavam", "los san", "lose spavam", "nesanica", "tesko zaspim", "budim se nocu", "za spavanje"],
    terms: ["lavanda", "magnezijum", "caj kamilica", "matičnjak", "melisa"],
    intro: "Mogu da pokažem proizvode iz ponude koji se tradicionalno koriste u večernjim rutinama i opuštanju. Ne mogu da garantujem da rešavaju nesanicu niti da zamene savet lekara."
  },
  {
    id: "immunity",
    patterns: ["imunitet", "jacanje imuniteta", "slab imunitet", "otpornost organizma", "vitamini za imunitet"],
    terms: ["vitamin c", "propolis", "cink", "ehi", "đumbir", "djumbir"],
    intro: "Evo proizvoda iz ponude koji se uklapaju u pretragu suplemenata i namirnica povezanih sa podrškom ishrani. Nijedan proizvod ne garantuje sprečavanje ili lečenje bolesti."
  },
  {
    id: "digestion",
    patterns: ["nadutost", "nadut stomak", "varenje", "probava", "zatvor", "redovna stolica", "digestivni problemi", "zeludac", "stomak me boli"],
    terms: ["inulin", "psilijum", "laneno seme", "komorac", "nana", "menta"],
    intro: "Mogu da prikažem proizvode iz ponude povezane sa vlaknima, čajevima i ishranom. Ako imate bol, uporne tegobe ili naglu promenu varenja, obratite se lekaru."
  },
  {
    id: "skin",
    patterns: ["suva koza", "suva koza lica", "nega koze", "iritacija koze", "crvenilo koze", "lice mi je suvo", "akne", "bubuljice"],
    terms: ["krema za lice", "bademovo ulje", "neven", "atopiko", "serum", "hidratantna"],
    intro: "Pronašao sam proizvode iz kategorije prirodne kozmetike za negu kože. Izbor zavisi od tipa kože i eventualnih alergija."
  },
  {
    id: "hair",
    patterns: ["opada mi kosa", "opadanje kose", "nega kose", "suva kosa", "perut", "teme glave"],
    terms: ["ulje za kosu", "sampon", "šampon", "kopriva", "brahmi"],
    intro: "Evo proizvoda iz ponude za negu kose i temena. Ako je opadanje naglo ili izraženo, najbolje je proveriti uzrok sa lekarom."
  },
  {
    id: "energy",
    patterns: ["umor", "stalno sam umoran", "nemam energije", "malaksalost", "iscrpljenost", "koncentracija"],
    terms: ["magnezijum", "vitamin b", "b kompleks", "gvozdje", "spirulina"],
    intro: "Mogu da pokažem proizvode iz ponude povezane sa suplementacijom i ishranom. Umor može imati mnogo uzroka, pa suplement ne treba uzimati kao zamenu za pregled ili analizu."
  },
  {
    id: "weight",
    patterns: ["mrsavljenje", "smrsam", "skidanje kilograma", "kontrola tezine", "zdravo mrsavljenje", "dijeta"],
    terms: ["psilijum", "inulin", "ovsene", "chia", "laneno seme"],
    intro: "Mogu da prikažem namirnice i proizvode koji se uklapaju u uravnoteženu ishranu. Ne preporučujem preparate kao brzo ili garantovano rešenje za mršavljenje."
  }
];

const URGENT = /trnjenje (nogu|ruku)|gubitak kontrole (nad|nad mokrenjem|nad stolicom)|ne mogu da mokrim|slabost nogu|iznenadan jak bol|bol u grudima|otezano disanje|otezano disanje|gubitak svesti|krv u stolici|visoka temperatura/i;

function detectIntent(message) {
  const text = normalize(message);
  return INTENTS.find(intent => intent.patterns.some(pattern => text.includes(normalize(pattern)))) || null;
}

async function searchIntentProducts(db, terms, limit = 5) {
  const normalizedTerms = [...new Set(terms.map(normalize).filter(Boolean))];
  const clauses = normalizedTerms.map((_, i) => `name ILIKE $${i + 1} OR COALESCE(category,'') ILIKE $${i + 1}`);
  const result = await db.query(
    `SELECT name,sku,category,price_rsd,available,image_url,url
     FROM products
     WHERE (length(url)-length(replace(url,'/',''))) >= 4
       AND (${clauses.join(" OR ")})
     ORDER BY name
     LIMIT ${Math.max(1, Math.min(20, limit * 3))}`,
    normalizedTerms.map(term => `%${term}%`)
  );
  const score = (product) => {
    const name = normalize(product.name);
    const category = normalize(product.category);
    return normalizedTerms.reduce((sum, term) => sum + (name.includes(term) ? 5 : category.includes(term) ? 2 : 0), 0);
  };
  return result.rows.sort((a,b) => score(b)-score(a)).slice(0,limit);
}

export async function adviseCustomer(db, message) {
  const intent = detectIntent(message);
  if (!intent) return null;
  if (URGENT.test(normalize(message))) {
    return {
      urgent: true,
      reply: "Ovi simptomi mogu zahtevati hitnu medicinsku procenu. Nemojte se oslanjati na preparate iz prodavnice — odmah se obratite lekaru ili hitnoj službi."
    };
  }
  const products = await searchIntentProducts(db, intent.terms, 5);
  const intro = intent.intro;
  if (!products.length) {
    return {
      urgent: false,
      intent: intent.id,
      products: [],
      reply: intro + "\n\nTrenutno nisam pronašao odgovarajući proizvod u našem katalogu. Mogu da prosledim pitanje kolegama iz BIO KUTAK-a."
    };
  }
  return {
    urgent: false,
    intent: intent.id,
    products,
    reply: intro + "\n\nDa bih suzio izbor, možete mi reći još malo o tome šta tražite. U međuvremenu, pogledajte ove proizvode iz naše ponude:"
  };
}
