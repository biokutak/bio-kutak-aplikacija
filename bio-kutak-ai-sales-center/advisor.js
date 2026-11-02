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
    id: "mens-health-general",
    adviceOnly: true,
    patterns: ["muski problemi", "muske probleme", "muskih problema", "muske tegobe", "muskih tegoba", "problem kod muskaraca", "problemi kod muskaraca", "za muskarce", "musko zdravlje", "intimni problemi kod muskaraca"],
    intro: "Naravno, mogu da proverim šta BIO KUTAK ima u ponudi. 🌿 Da bih vas pravilno usmerio, recite mi na šta konkretno mislite: prostata i mokrenje, potencija i libido, opadanje kose ili neku drugu tegobu? Ako imate bol, krv u mokraći, nemogućnost mokrenja ili iznenadne i jake simptome, obratite se lekaru. Neću preporučivati preparat za lečenje niti nagađati bez dodatnih informacija."
  },
  {
    id: "womens-health-general",
    adviceOnly: true,
    patterns: ["zenski problemi", "zenske probleme", "zenskim problemima", "zenskih problema", "zenske tegobe", "zenskim tegobama", "problemi kod zena", "problemi za zene", "hormonski problemi kod zena", "intimni problemi kod zena"],
    intro: "Naravno, mogu da proverim šta BIO KUTAK ima u ponudi. 🌿 Da bih vas usmerila na odgovarajuće informacije, recite mi na šta konkretno mislite: PMS i menstrualni ciklus, bolne menstruacije, menopauza i valunzi, ili neku drugu tegobu? Ako je reč o neuobičajenom ili obilnom krvarenju, jakom bolu, mogućoj trudnoći, temperaturi ili tegobama intimne regije, važno je da se obratite ginekologu. Neću preporučivati preparat za lečenje niti nagađati bez dodatnih informacija."
  },
  {
    id: "back-care",
    patterns: ["bole me ledja", "bol u ledjima", "krsta", "ukocena ledja", "ukocio sam se", "boli me kicma", "bol u kicmi", "vrat me boli", "boli me vrat", "ramena me bole", "bol u misicima", "upala misica", "zglobovi me bole", "bol u zglobovima"],
    terms: ["gavez mast", "mast od gaveza", "magnezijum hlorid gel", "magnezijum sprej"],
    exclude: ["čaj", "tinktura", "hemoroide", "čukljeve", "pčelinjim otrovom"],
    intro: "Razumem. U katalogu sam pronašao nekoliko proizvoda za spoljašnju negu tela koji bi mogli biti relevantni ako tražite preparat za masažu ili negu kože. To nisu lekovi i ne mogu da leče bol u leđima."
  },
  {
    id: "dry-cough",
    patterns: ["suvi kasalj", "suv kasalj", "suvog kaslja", "suvim kasljem", "nadrazajni kasalj", "golicanje u grlu", "grebanje u grlu", "kasalj bez sekreta", "kasljem suvo", "kasalj"],
    terms: ["beli slez caj", "bokvica caj", "majčina dušica čaj", "timijan-timjan čaj", "lipov med"],
    exclude: ["crni slez", "gavez", "koren", "list"],
    intro: "Za suvi kašalj mogu da pokažem čajeve i med iz naše ponude koji se tradicionalno koriste kao topli napici za umirenje nadraženog grla. Ovo nisu lekovi i ne leče uzrok kašlja. Ako kašalj traje duže od 3 nedelje, pogoršava se ili imate temperaturu, javite se lekaru. Kod otežanog disanja, bola u grudima ili iskašljavanja krvi potražite hitnu medicinsku pomoć."
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
    adviceOnly: true,
    patterns: ["varenje", "za varenje", "probava", "digestivni problemi", "problemi sa varenjem", "problem sa varenjem", "problema sa varenjem", "nadutost", "nadutosti", "nadimanje", "nadimanju", "gasovi", "gasovima"],
    intro: "Varenje može značiti više različitih tegoba. Da ne bih preporučila pogrešan proizvod, recite mi da li imate nadutost/gasove, zatvor, proliv, gorušicu, mučninu ili bol u stomaku. Ako je bol jak ili iznenadan, imate krv u stolici, uporno povraćanje ili naglu promenu pražnjenja, obratite se lekaru."
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
  },

  {
    id: "headache",
    patterns: ["glavobolja", "boli me glava", "migrena", "migrene", "pritisak u glavi", "teska glava"],
    terms: ["magnezijum", "caj nana", "caj kamilica"],
    intro: "Mogu da prikažem proizvode iz ponude za opštu podršku ishrani i opuštanju. Čajevi i suplementi ne leče glavobolju niti migrenu. Ako je glavobolja iznenadna i veoma jaka, nova ili praćena smetnjama vida, govora, slabošću ili ukočenim vratom, odmah potražite medicinsku pomoć."
  },
  {
    id: "cold-flu",
    patterns: ["prehlada", "grip", "simptomi gripa", "curi mi nos", "zapusen nos", "zapusen mi je nos", "kijam", "kijavica", "temperatura i prehlada"],
    terms: ["c vitamin", "propolis", "djumbir", "limun", "zova", "nana"],
    intro: "Mogu da pokažem čajeve, med i prehrambene proizvode iz ponude za tople napitke i podršku ishrani. To nisu lekovi i ne sprečavaju niti leče grip ili prehladu. Kod otežanog disanja, bola u grudima, konfuzije ili izrazito lošeg stanja obratite se hitno lekaru."
  },
  {
    id: "sore-throat",
    patterns: ["bol u grlu", "boli me grlo", "grebe me grlo", "pece me grlo", "promuklost", "upala grla"],
    terms: ["beli slez caj", "bokvica caj", "majčina dušica čaj", "lipov med", "propolis"],
    intro: "Mogu da prikažem tople napitke, med i proizvode iz ponude koji se tradicionalno koriste za umirenje nadraženog grla. Ne leče infekciju. Ako teško gutate ili dišete, imate visoku temperaturu ili se stanje pogoršava, javite se lekaru."
  },
  {
    id: "allergy",
    patterns: ["alergija", "alergije", "polenska alergija", "svrbe me oci", "suzne oci", "alergijski rinitis", "reakcija na polen"],
    terms: ["kopriva", "c vitamin", "kvercetin"],
    intro: "Alergije mogu zahtevati odgovarajuću dijagnostiku i terapiju. Mogu da proverim samo da li u katalogu postoje prehrambeni proizvodi ili suplementi povezani sa vašom pretragom; oni nisu zamena za lekove protiv alergije. Kod otoka jezika ili grla ili otežanog disanja odmah zovite hitnu pomoć."
  },
  {
    id: "heartburn",
    patterns: ["gorusica", "kiselina u zelucu", "vraca mi se kiselina", "refluks", "podrigivanje", "peckanje u zelucu"],
    terms: ["laneno seme", "ovsene pahuljice", "kamilica"],
    intro: "Mogu da prikažem prehrambene proizvode iz ponude, ali oni nisu terapija za gorušicu ili refluks. Ako se tegobe ponavljaju, imate otežano gutanje, povraćanje krvi ili jak bol u grudima, potražite medicinsku procenu."
  },
  {
    id: "nausea",
    patterns: ["mucnina", "muka mi je", "imam mucninu", "nadimanje i mucnina", "povraca mi se"],
    terms: ["djumbir", "nana", "menta", "kamilica"],
    intro: "Mogu da pokažem čajeve i prehrambene proizvode iz ponude koji se koriste kao napici. Ne mogu da utvrdim uzrok mučnine. Ako ne možete da zadržite tečnost, imate jak bol, krv u povraćanju ili znake dehidratacije, javite se lekaru."
  },
  {
    id: "diarrhea",
    patterns: ["proliv", "dijareja", "retka stolica", "ucestala stolica"],
    terms: ["kamilica", "nana"],
    intro: "Kod proliva je najvažnija nadoknada tečnosti i elektrolita; proizvodi iz prodavnice nisu zamena za oralni rehidratacioni rastvor ili medicinski savet. Potražite lekara kod krvi u stolici, visoke temperature, jakog bola ili znakova dehidratacije."
  },
  {
    id: "constipation",
    patterns: ["zatvor", "opstipacija", "tesko praznim creva", "tvrda stolica", "neredovna stolica"],
    terms: ["psilijum", "inulin", "laneno seme", "suve sljive"],
    intro: "Mogu da prikažem proizvode sa vlaknima iz kataloga. Vlakna uvodite postepeno i uz dovoljno tečnosti; nisu prikladna za svaku osobu. Kod jakog bola, povraćanja, krvi u stolici ili nagle promene pražnjenja obratite se lekaru."
  },
  {
    id: "bloating",
    patterns: ["gasovi", "imam gasove", "gasovima", "nadutost", "nadutosti", "nadutost stomaka", "nadimanje", "nadimanju", "grcevi u stomaku"],
    terms: ["komorac", "nana", "menta", "kamilica", "psilijum"],
    intro: "Mogu da prikažem čajeve i proizvode sa vlaknima iz ponude. Nadutost i grčevi imaju različite uzroke; jak ili iznenadan bol, povraćanje ili krv u stolici zahtevaju pregled."
  },
  {
    id: "joint-care",
    patterns: ["bol u kolenu", "bole me kolena", "bol u kuku", "bol u zglobovima", "ukoceni zglobovi", "artritis", "reuma", "boli me lakat"],
    terms: ["magnezijum gel", "magnezijum sprej", "gavez mast", "kolagen"],
    intro: "Mogu da prikažem preparate za spoljašnju negu ili proizvode iz ponude koji se pretražuju uz negu zglobova. Ne leče artritis niti uzrok bola. Ako je zglob crven, vruć, jako otečen ili imate temperaturu, potražite lekara."
  },
  {
    id: "muscle-cramps",
    patterns: ["grcevi u nogama", "grc u listu", "hvataju me grcevi", "trzanje misica", "misicni grcevi"],
    terms: ["magnezijum", "magnezijum hlorid gel", "magnezijum sprej"],
    intro: "Mogu da pokažem proizvode sa magnezijumom iz kataloga, ali grčevi imaju više mogućih uzroka i suplement nije uvek rešenje. Ako su grčevi česti, jaki ili praćeni otokom i crvenilom jedne noge, javite se lekaru."
  },
  {
    id: "stress",
    patterns: ["stres", "napetost", "nervoza", "anksioznost", "uznemirenost", "tesko se opustam"],
    terms: ["matičnjak", "melisa", "lavanda", "kamilica"],
    intro: "Mogu da prikažem čajeve i proizvode za opuštajuću večernju rutinu. Oni nisu terapija za anksioznost ili druge probleme mentalnog zdravlja. Ako tegobe ometaju svakodnevni život, razgovarajte sa zdravstvenim stručnjakom."
  },
  {
    id: "menopause",
    patterns: ["menopauza", "valunzi", "talasi vrucine", "nocno znojenje", "simptomi menopauze"],
    terms: ["soja", "laneno seme", "magnezijum", "crvena detelina"],
    intro: "Mogu da proverim katalog za prehrambene proizvode i suplemente koji se često traže u ovom periodu. Njihova delotvornost za simptome menopauze nije zagarantovana; izbor proverite sa lekarom ili farmaceutom, posebno ako koristite terapiju."
  },
  {
    id: "menstrual",
    patterns: ["menstrualni bolovi", "bolna menstruacija", "bolne menstruacije", "bolne menstruacija", "bolovima tokom menstruacije", "bol tokom menstruacije", "bolovi tokom ciklusa", "bolne menstruacije", "pms", "predmenstrualni sindrom"],
    terms: ["magnezijum", "kamilica", "djumbir"],
    intro: "Mogu da prikažem čajeve i proizvode iz ponude, ali oni nisu dokazano lečenje menstrualnih bolova. Ako je bol nov, veoma jak, praćen obilnim krvarenjem ili postoji mogućnost trudnoće, potražite medicinski savet."
  },
  {
    id: "circulation",
    patterns: ["teske noge", "umorne noge", "hladne ruke i noge", "slaba cirkulacija", "oticanje nogu", "vene na nogama", "prosirene vene"],
    terms: ["divlji kesten", "vinova loza", "ginko"],
    intro: "Mogu da prikažem proizvode iz kataloga koji se traže za negu nogu. Ne mogu da procenim cirkulaciju niti da preporučim lečenje. Iznenadan otok ili bol samo jedne noge, naročito uz nedostatak vazduha, zahteva hitnu procenu."
  },
  {
    id: "hemorrhoids",
    patterns: ["hemoroidi", "suljevi", "svrab oko anusa", "bol pri stolici"],
    terms: ["psilijum", "laneno seme"],
    intro: "Mogu da prikažem proizvode sa vlaknima koji mogu doprineti redovnijoj stolici. To nije terapija za hemoroide. Krvarenje iz završnog dela creva treba proveriti kod lekara, posebno ako se ponavlja."
  },
  {
    id: "oral-care",
    patterns: ["afte", "ranice u ustima", "neprijatan zadah", "suva usta", "krvare mi desni"],
    terms: ["propolis", "zalfija", "kamilica"],
    intro: "Mogu da prikažem proizvode za oralnu negu iz kataloga. Ne zamenjuju stomatološki pregled; krvarenje desni, ranice koje ne prolaze ili zubobolja zahtevaju procenu stomatologa."
  },
  {
    id: "eye-care",
    patterns: ["suve oci", "peckanje ociju", "umorne oci", "naprezanje ociju"],
    terms: ["omega 3", "borovnica"],
    intro: "Mogu da proverim da li u katalogu postoje prehrambeni proizvodi povezani sa vašom pretragom. Suplementi ne leče očne bolesti. Iznenadan gubitak vida, jak bol ili povreda oka zahtevaju hitnu medicinsku procenu."
  },
  {
    id: "memory-focus",
    patterns: ["slaba koncentracija", "lose pamtim", "zaboravnost", "pamcenje", "fokus", "koncentracija"],
    terms: ["omega 3", "vitamin b", "magnezijum"],
    intro: "Mogu da prikažem proizvode iz ponude povezane sa ishranom. Zaboravnost i problemi sa koncentracijom mogu imati različite uzroke i suplementi nisu zamena za pregled ako su tegobe nove ili se pogoršavaju."
  },
  {
    id: "dry-skin",
    patterns: ["svrab koze", "koza me svrbi", "ispucala koza", "ekcem", "crvenilo i svrab"],
    terms: ["neven", "bademovo ulje", "krema za lice", "hidratantna krema"],
    intro: "Mogu da prikažem proizvode za negu kože iz ponude. Pre upotrebe proverite sastav i alergije; osip koji se brzo širi, otok lica ili otežano disanje zahtevaju hitnu pomoć."
  },

  {
    id: "e-coli",
    adviceOnly: true,
    patterns: ["escherichia coli", "escherichia", "e coli", "ešerihija", "eserihija", "ešerihiju", "eserihiju", "bakterija u mokraci", "bakterije u mokraci"],
    intro: "Ešerihija koli (E. coli) može izazvati urinarnu infekciju, ali nalaz i simptomi moraju da se procene kod lekara. Čajevi, brusnica i suplementi ne mogu da zamene urinokulturu niti antibiotik kada ga lekar propiše. Ako imate temperaturu, bol u slabinama, mučninu/povraćanje, krv u mokraći ili ste trudni, javite se lekaru bez odlaganja. Mogu da proverim sastav konkretnog proizvoda, ali neću preporučiti suplement kao lečenje infekcije."
  },
  {
    id: "urinary",
    adviceOnly: true,
    patterns: ["peckanje pri mokrenju", "pece me kad mokrim", "ucestalo mokrenje", "stalno mi se mokri", "bol pri mokrenju", "krv u mokraci", "infekcija urinarnog trakta", "upala besike", "cistitis"],
    intro: "Peckanje, učestalo mokrenje i bol mogu imati više uzroka, uključujući infekciju. Potreban je savet lekara i po potrebi analiza urina; nemojte pokušavati da infekciju lečite samo čajevima ili suplementima. Krv u mokraći, temperatura, bol u slabinama, mučnina ili povraćanje zahtevaju brzu medicinsku procenu."
  },
  {
    id: "blood-pressure",
    adviceOnly: true,
    patterns: ["visok pritisak", "povisen pritisak", "nizak pritisak", "skace mi pritisak", "pritisak mi je visok", "pritisak mi je nizak"],
    intro: "Krvni pritisak treba pravilno izmeriti i pratiti, a terapiju ne treba prekidati niti menjati bez lekara. Suplementi i biljni preparati nisu zamena za terapiju i mogu da utiču na lekove. Ako je pritisak veoma visok uz bol u grudima, otežano disanje, jaku glavobolju, smetnje vida ili slabost, odmah potražite hitnu pomoć."
  },
  {
    id: "blood-sugar",
    adviceOnly: true,
    patterns: ["povisen secer", "visok secer", "nizak secer", "dijabetes", "dijabeticar sam", "insulinska rezistencija", "insulin"],
    intro: "Kod dijabetesa i promena šećera u krvi važno je pratiti vrednosti i držati se plana koji je odredio lekar. Nemojte menjati insulin ili lekove zbog suplementa ili biljnog preparata. Zbunjenost, gubitak svesti ili izrazita slabost mogu biti hitni znaci — pozovite hitnu pomoć."
  },
  {
    id: "thyroid",
    adviceOnly: true,
    patterns: ["stitna zlezda", "stitnu zlezdu", "hipotireoza", "hipertireoza", "hashimoto", "hašimoto", "problemi sa hormonima stitne"],
    intro: "Tegobe povezane sa štitnom žlezdom zahtevaju laboratorijsku i lekarsku procenu. Jod, alge i suplementi mogu biti neodgovarajući kod pojedinih oboljenja štitne žlezde i mogu uticati na terapiju. Nemojte ih uzimati za lečenje bez saveta endokrinologa ili farmaceuta."
  },
  {
    id: "anemia",
    adviceOnly: true,
    patterns: ["anemija", "malokrvnost", "nisko gvozdje", "nizak hemoglobin", "manjak gvozdja", "nedostatak gvozdja"],
    intro: "Umor, bledilo i vrtoglavica mogu biti povezani sa anemijom, ali uzrok treba potvrditi krvnom slikom i drugim analizama. Gvožđe ne treba uzimati naslepo — višak može biti štetan, a anemija nema uvek isti uzrok. Razgovarajte sa lekarom o nalazima i odgovarajućoj terapiji."
  },
  {
    id: "kidney",
    adviceOnly: true,
    patterns: ["bubrezi", "bol u bubrezima", "problem sa bubrezima", "slabi bubrezi", "kamen u bubregu", "pesak u bubregu"],
    intro: "Tegobe sa bubrezima zahtevaju oprez: neki biljni preparati, čajevi i suplementi nisu bezbedni kod smanjene funkcije bubrega. Nemojte koristiti preparate za 'čišćenje bubrega' bez saveta lekara. Jak bol u slabini, temperatura, povraćanje ili krv u mokraći zahtevaju brzu procenu."
  },
  {
    id: "liver",
    adviceOnly: true,
    patterns: ["jetra", "masna jetra", "povisen ast alt", "povisen ggt", "enzimi jetre", "problem sa jetrom"],
    intro: "Kod masne jetre ili povišenih jetrenih enzima važno je utvrditi uzrok sa lekarom. 'Detoks' preparati i biljni suplementi nisu dokazano čišćenje jetre, a neki mogu dodatno oštetiti jetru ili stupiti u interakciju sa lekovima. Žutilo kože ili očiju, taman urin ili jak bol zahtevaju hitnu medicinsku procenu."
  },
  {
    id: "pregnancy",
    adviceOnly: true,
    patterns: ["trudna sam", "trudnoca", "u drugom sam stanju", "dojim", "dojenje", "za trudnice", "za dojilje"],
    intro: "Tokom trudnoće i dojenja nemojte uzimati biljne preparate, eterična ulja ili suplemente bez provere sa ginekologom ili farmaceutom. I proizvodi koji su inače prirodni mogu biti neodgovarajući u ovom periodu. Mogu da proverim sastav konkretnog proizvoda, ali konačnu procenu treba da da zdravstveni stručnjak."
  },
  {
    id: "potency",
    adviceOnly: true,
    patterns: ["potencija", "problem sa potencijom", "problemi sa potencijom", "slaba potencija", "erekcija", "slaba erekcija", "problem sa erekcijom", "problemi sa erekcijom", "libido", "slab libido", "seksualna funkcija", "seksualna zelja"],
    intro: "Razumem. 🌿 Tegobe sa potencijom mogu imati različite uzroke, uključujući cirkulaciju, šećer u krvi, hormone, stres ili dejstvo lekova. Da li mislite na teško postizanje ili održavanje erekcije, smanjenu seksualnu želju (libido), ili oboje? Ne bih preporučivao preparat naslepo — suplementi nisu dokazano lečenje erektilne disfunkcije i mogu stupiti u interakciju sa terapijom. Ako se problem ponavlja, najbolje je razgovarati sa lekarom ili urologom, jer ponekad može ukazivati na drugo zdravstveno stanje. Nemojte prekidati propisanu terapiju."
  },
  {
    id: "prostate",
    patterns: ["prostata", "uvećana prostata", "uvećanu prostatu", "za prostatu", "problemi sa prostatom", "slab mlaz mokrace", "nocu ustajem da mokrim", "tesko mokrim"],
    terms: ["serenoa repens", "saw palmetto", "palma sabal", "seme bundeve", "ulje semenki bundeve", "kopriva koren"],
    intro: "Mogu da proverim katalog za proizvode čiji sastav ili naziv odgovara pretrazi za prostatu. Važno: suplementi nisu dokazano lečenje uvećane prostate i ne treba da odlažu pregled kod urologa. Ako ne možete da mokrite, imate temperaturu, jak bol ili krv u mokraći, potražite hitnu medicinsku pomoć."
  },
  {
    id: "stomach-pain",
    adviceOnly: true,
    patterns: ["jak bol u stomaku", "iznenadan bol u stomaku", "bol u donjem delu stomaka", "bol ispod desnog rebra", "bol ispod levog rebra"],
    intro: "Bol u stomaku može imati mnogo uzroka i ne može se pouzdano proceniti preko poruke. Nemojte birati suplement kao terapiju. Jak, iznenadan ili sve jači bol, tvrd stomak, uporno povraćanje, krv u stolici ili moguća trudnoća zahtevaju hitnu medicinsku procenu."
  },
  {
    id: "dizziness",
    adviceOnly: true,
    patterns: ["vrtoglavica", "vrti mi se u glavi", "gubim ravnotezu", "nesvestica", "osecam da cu se onesvestiti"],
    intro: "Vrtoglavica može biti posledica različitih stanja, od dehidratacije do problema sa pritiskom ili unutrašnjim uhom. Sedite ili lezite dok ne prođe i nemojte voziti. Ako se javi iznenadna slabost jedne strane tela, smetnja govora ili vida, bol u grudima ili gubitak svesti, odmah pozovite hitnu pomoć."
  },

  {
    id: "gastritis",
    adviceOnly: true,
    patterns: ["gastritis", "gastritisu", "upala zeluca", "upala želuca", "helikobakter", "helicobacter", "cir na zelucu", "čir na želucu"],
    intro: "Kod gastritisa je važno utvrditi uzrok i pratiti savet lekara. Hrana, čajevi i suplementi ne leče gastritis, a neki mogu pogoršati tegobe ili uticati na terapiju. Nemojte prekidati propisane lekove. Ako imate crnu stolicu, povraćanje krvi, jak bol ili nesvesticu, odmah potražite medicinsku pomoć. Mogu da proverim sastav konkretnog proizvoda, ali neću ga predstavljati kao terapiju za gastritis."
  },
  {
    id: "cholesterol",
    adviceOnly: true,
    patterns: ["holesterol", "povisen holesterol", "visok holesterol", "ldl", "trigliceridi"],
    intro: "Kod povišenog holesterola izbor postupka zavisi od LDL-a, ukupnog kardiovaskularnog rizika i drugih nalaza. Ishrana sa više povrća, mahunarki, ovsa i drugih izvora rastvorljivih vlakana, manje zasićenih i trans masti i redovna fizička aktivnost mogu biti deo zdravih navika. To nije zamena za terapiju koju je propisao lekar. Neću preporučiti suplement kao sredstvo za snižavanje holesterola bez provere terapije i zdravstvenog stanja. Mogu da proverim deklaraciju konkretnog proizvoda."
  },
  {
    id: "hormonal-balance",
    patterns: ["hormonalni balans", "hormonski balans", "hormonski disbalans", "hormonalni disbalans", "balans hormona", "regulisanje hormona", "hormoni kod zena", "hormonska ravnoteza"],
    terms: ["crvena detelina", "soja", "laneno seme", "virak"],
    intro: "Mogu da proverim proizvode iz BIO KUTAK ponude koji se često traže u vezi sa ženskim hormonskim promenama. Važno: ne postoji univerzalni suplement za 'hormonalni balans', a biljni preparati nisu dokazano lečenje hormonskog poremećaja. Ako imate neredovne cikluse, izražene simptome ili sumnju na hormonski problem, razgovarajte sa ginekologom/endokrinologom. Proverite interakcije pre upotrebe, posebno uz hormonsku terapiju."
  },
  {
    id: "estrogen-hormones",
    adviceOnly: true,
    patterns: ["estrogen", "estrogena", "estrogenu", "estrogenski", "hormonski status", "hormoni kod zena"],
    intro: "Estrogen je hormon čiji se nivo menja tokom života i menstrualnog ciklusa. Jedna vrednost se ne tumači bez uzrasta, faze ciklusa, simptoma i razloga zbog kog je analiza rađena. Nemojte pokušavati da menjate nivo hormona suplementima bez saveta ginekologa ili endokrinologa. Ako imate nalaz, mogu da objasnim šta naziv analize znači, ali tumačenje pripada lekaru."
  },
];
const URGENT = /bol u grudima|pritisak u grudima|otezano disanje|ne mogu da disem|gubitak svesti|onesvestio|onesvestila|iznenadna slabost|oduzetost|iskrivljeno lice|otezan govor|iznenadna jaka glavobolja|najgora glavobolja|obilno krvarenje|krv u povracanju|crna stolica|krv u stolici|ne mogu da mokrim|gubitak kontrole nad (mokr(enjem|acom)|stolicom)|trnjenje (cele|jedne) strane|oticanje jezika|otok grla|anafilaksija|misli o samoubistvu/i;

function detectIntent(message) {
  const text = normalize(message);
  return INTENTS.find(intent => intent.patterns.some(pattern => text.includes(normalize(pattern)))) || null;
}

function containsWholePhrase(haystack, phrase) {
  const padded = " " + normalize(haystack) + " ";
  return padded.includes(" " + normalize(phrase) + " ");
}

function productMatchScore(product, terms, exclude = []) {
  const name = normalize(product.name);
  const category = normalize(product.category);
  if (exclude.some(term => containsWholePhrase(name, term))) return 0;

  let score = 0;
  for (const rawTerm of terms) {
    const term = normalize(rawTerm);
    if (!term) continue;
    const words = term.split(" ").filter(Boolean);
    const nameHasPhrase = containsWholePhrase(name, term);
    const categoryHasPhrase = containsWholePhrase(category, term);
    const nameHasAllWords = words.length > 1 && words.every(word => containsWholePhrase(name, word));
    const categoryHasAllWords = words.length > 1 && words.every(word => containsWholePhrase(category, word));

    if (nameHasPhrase) score = Math.max(score, 100 + words.length * 5);
    else if (nameHasAllWords) score = Math.max(score, 70 + words.length * 5);
    else if (categoryHasPhrase) score = Math.max(score, 35 + words.length * 3);
    else if (categoryHasAllWords) score = Math.max(score, 25 + words.length * 3);
  }
  return score;
}

async function searchIntentProducts(db, terms, limit = 5, exclude = []) {
  // The catalogue is small enough to rank locally. This deliberately avoids
  // SQL ILIKE substring matches such as "nana" inside "ananas" or "banana".
  const result = await db.query(
    "SELECT name,sku,category,price_rsd,available,image_url,url,description,ingredients,usage,warnings FROM products WHERE url IS NOT NULL"
  );
  return result.rows
    .map(product => ({ product, score: productMatchScore(product, terms, exclude) }))
    .filter(item => item.score > 0)
    .sort((a,b) => b.score - a.score || String(a.product.name).localeCompare(String(b.product.name), "sr"))
    .slice(0, Math.max(1, Math.min(20, limit)))
    .map(item => item.product);
}

export async function adviseCustomer(db, message) {
  const normalizedMessage = normalize(message);
  if (URGENT.test(normalizedMessage)) {
    return {
      urgent: true,
      reply: "Ovi simptomi mogu zahtevati hitnu medicinsku procenu. Nemojte se oslanjati na preparate iz prodavnice — odmah se obratite lekaru ili hitnoj službi."
    };
  }
  const intent = detectIntent(message);
  if (!intent) {
    const symptomLike = /\b(bol|boli|boli me|svrbi|svrab|pece|temperatur|kasalj|kaslj|mucnin|povrac|krvar|otok|osip|umor|vrtoglav|proliv|zatvor|nesanic|trnjen|slabost|pritisak|secer|dijabet|astm|srce|bubreg|jetra)\w*/i.test(normalizedMessage);
    if (!symptomLike) return null;
    return {
      urgent: false,
      autoReply: true,
      intent: "unclassified-symptom",
      products: [],
      reply: "Razumem. Ne želim da nagađam niti da vam preporučim pogrešan proizvod. Opišite tegobu malo preciznije ili se obratite farmaceutu/lekaru. U našem katalogu trenutno nisam pouzdano povezao ovu tegobu sa odgovarajućim artiklom. Ako su simptomi jaki, nagli ili se pogoršavaju, potražite medicinsku pomoć."
    };
  }
  const intro = intent.intro;
  if (intent.id === "potency") {
    const result = await db.query(
      "SELECT name,category,price_rsd,available,url,description,ingredients,usage,warnings FROM products WHERE url IS NOT NULL AND (concat_ws(' ',name,category,description,ingredients) ILIKE ANY(ARRAY['%libido%','%potenc%','%erekc%','%seksual%']) OR name ILIKE '%shilajit%' OR name ILIKE '%šilajit%') ORDER BY price_rsd DESC NULLS LAST, CASE WHEN available IS TRUE THEN 0 ELSE 1 END, name LIMIT 5"
    );
    if (!result.rows.length) {
      return {
        urgent: false,
        autoReply: true,
        intent: "potency",
        products: [],
        reply: "Razumem. 🌿 Proverio sam BIO KUTAK katalog, ali trenutno nisam pronašao proizvod čiji opis ili sastav izričito navodi libido, potenciju ili seksualnu funkciju. Neću vam preporučiti nasumičan preparat niti tvrditi da suplement leči ove tegobe. Ako se problem ponavlja, razgovarajte sa lekarom ili urologom; posebno je važno proveriti moguće uzroke i interakcije sa lekovima."
      };
    }
    return {
      urgent: false,
      intent: "potency",
      products: result.rows,
      reply: "Proverio sam BIO KUTAK katalog i pronašao sledeće artikle čiji opis ili sastav pominje libido, potenciju ili seksualnu funkciju. 🌿 To ne znači da je dokazano da leče erektilne smetnje ili smanjen libido. Proverite deklaraciju i posavetujte se sa lekarom ili farmaceutom, naročito ako koristite terapiju."
    };
  }
  if (intent.adviceOnly) {
    return { urgent: false, autoReply: true, intent: intent.id, products: [], reply: intro };
  }
  const products = await searchIntentProducts(db, intent.terms, 5, intent.exclude || []);
  if (!products.length) {
    return {
      urgent: false,
      autoReply: true,
      intent: intent.id,
      products: [],
      reply: intro + "\n\nTrenutno nisam pronašao odgovarajući proizvod u našem katalogu. Neću nagađati niti preporučivati nepovezan artikal. Mogu da proverim sa kolegama da li postoji dodatna ponuda u prodavnici."
    };
  }
  return {
    urgent: false,
    intent: intent.id,
    products,
    reply: intro + "\n\nDa bih suzio izbor, možete mi reći još malo o tome šta tražite. U međuvremenu, pogledajte ove proizvode iz naše ponude:"
  };
}
