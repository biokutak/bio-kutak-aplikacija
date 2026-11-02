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


GUIDES.push(
{slug:"vitamin-d",title:"Vitamin D – uloga i oprez",keywords:"vitamin d d3 kosti misici imunitet sunce nedostatak",content:"Vitamin D doprinosi normalnoj apsorpciji kalcijuma i fosfora i održavanju normalnih kostiju i mišića. Potreba za suplementacijom zavisi od ishrane, izlaganja suncu, uzrasta i zdravstvenih faktora. Kod sumnje na manjak lekar može preporučiti analizu. Visoke doze bez nadzora mogu biti štetne."},
{slug:"vitamin-c",title:"Vitamin C – osnovne informacije",keywords:"vitamin c askorbinska kiselina kolagen imunitet",content:"Vitamin C doprinosi normalnom stvaranju kolagena i normalnoj funkciji imunskog sistema. Veće količine kod nekih osoba mogu izazvati stomačne tegobe. Osobe sa istorijom bubrežnih kamenaca ili određenim bolestima treba da pitaju lekara o visokim dozama."},
{slug:"b-complex",title:"B kompleks – vitamini B grupe",keywords:"b kompleks b1 b2 b3 b5 b6 b7 b9 b12 energija nervni sistem",content:"B kompleks obuhvata više vitamina sa različitim ulogama u metabolizmu stvaranja energije, nervnom sistemu i stvaranju krvnih ćelija. Nije stimulans i ne rešava svaki umor. Dugotrajne visoke doze pojedinih vitamina, naročito B6, mogu biti štetne. Proveriti deklaraciju i izbegavati dupliranje preparata."},
{slug:"vitamin-b12",title:"Vitamin B12",keywords:"b12 kobalamin krvna slika nervi vegani vegetarijanci umor",content:"Vitamin B12 doprinosi normalnom stvaranju crvenih krvnih zrnaca i normalnom funkcionisanju nervnog sistema. Rizik od manjka može biti veći kod osoba koje ne jedu namirnice životinjskog porekla ili imaju poremećaj apsorpcije. Umor i trnjenje sami po sebi ne potvrđuju manjak; potrebna je medicinska procena."},
{slug:"magnesium",title:"Magnezijum – oblici i upotreba",keywords:"magnezijum glicinat citrat oksid grcevi misici nervni sistem",content:"Magnezijum doprinosi normalnoj funkciji mišića i nervnog sistema. Različiti oblici imaju različite količine elementarnog magnezijuma; upoređivati tu količinu na deklaraciji. Suplementi mogu izazvati proliv. Kod bolesti bubrega ili redovne terapije proveriti upotrebu sa lekarom ili farmaceutom."},
{slug:"zinc",title:"Cink – osnovne informacije",keywords:"cink zinc imunitet koza kosa nokti ukus",content:"Cink doprinosi normalnoj funkciji imunskog sistema i održavanju normalne kože, kose i noktiju. Dugotrajne prevelike količine mogu poremetiti status bakra. Proveriti ukupan unos iz svih preparata."},
{slug:"iron",title:"Gvožđe – kada je potrebna provera",keywords:"gvozdje iron feritin hemoglobin anemija krvna slika malokrvnost",content:"Gvožđe doprinosi normalnom stvaranju hemoglobina i prenosu kiseonika. Umor nije dovoljan dokaz manjka. Suplementaciju zasnovati na proceni i nalazima jer višak može biti štetan. Preparati gvožđa mogu stupati u interakcije sa lekovima i drugim mineralima."},
{slug:"calcium",title:"Kalcijum – kosti i mišići",keywords:"kalcijum calcium kosti zubi osteoporoza vitamin d",content:"Kalcijum je potreban za održavanje normalnih kostiju i zuba i normalnu funkciju mišića. Potreba za dodatkom zavisi od ishrane i zdravstvenog stanja. Veće doze mogu izazvati zatvor; kod bolesti bubrega ili poremećaja kalcijuma savetovati se sa lekarom."},
{slug:"omega-3",title:"Omega-3 masne kiseline",keywords:"omega 3 riblje ulje epa dha srce trigliceridi",content:"Omega-3 obuhvata masne kiseline kao što su EPA i DHA. Količine EPA i DHA proveriti na deklaraciji; ukupna masa ribljeg ulja nije isto što i EPA+DHA. Osobe koje koriste lekove protiv zgrušavanja krvi ili planiraju operaciju treba da se posavetuju sa lekarom."},
{slug:"probiotics",title:"Probiotici – šta znače sojevi",keywords:"probiotik probiotici crevna flora mikrobiota laktobacil bifidobakterija",content:"Efekti probiotika zavise od konkretnog soja, kombinacije i količine. Proveriti naziv soja, broj živih kultura do isteka roka i uslove čuvanja. Osobe sa ozbiljno oslabljenim imunitetom ili teškim bolestima treba da pitaju lekara pre upotrebe."},
{slug:"collagen",title:"Kolagen – vrste i deklaracija",keywords:"kolagen collagen hidrolizovani peptidi koza zglobovi kosa",content:"Kolagen je strukturni protein. Suplementi mogu imati različito poreklo i tipove; proveriti izvor zbog alergija i načina ishrane. Ne predstavljati kolagen kao lek za bolove ili kao garantovano sredstvo protiv bora."},
{slug:"ashwagandha",title:"Ašvaganda – tradicionalna upotreba i oprez",keywords:"asvaganda ashwagandha withania somnifera stres san stitna zlezda",content:"Ašvaganda (Withania somnifera) je biljka koja se tradicionalno koristi i proučava u vezi sa stresom i snom. Ne obećavati lečenje anksioznosti ili nesanice. Može izazvati pospanost i stomačne tegobe; opisani su retki slučajevi oštećenja jetre. Izbegavati u trudnoći; kod bolesti štitne žlezde, autoimunih bolesti, jetre ili terapije obavezno proveriti sa lekarom."},
{slug:"shilajit",title:"Shilajit (Mumio) – šta je i na šta obratiti pažnju",keywords:"shilajit silajit mumio smola mineralna smola poreklo preciscavanje teski metali",content:"Shilajit, poznat i kao Mumio, jeste prirodna mineralno-organska smola. Sastav može varirati prema poreklu i obradi. Proveriti proizvođača, prečišćavanje i laboratorijske analize na teške metale i kontaminante. Ne pripisivati svakom proizvodu univerzalna dejstva na testosteron, potenciju ili lečenje bolesti. Ne koristiti sirov ili neproveren proizvod; u trudnoći, dojenju, kod hroničnih bolesti ili terapije tražiti savet lekara."},
{slug:"turmeric",title:"Kurkuma i kurkumin",keywords:"kurkuma turmeric kurkumin piperin zglobovi",content:"Kurkuma je začinska biljka, a kurkumin jedan od njenih proučavanih sastojaka. Koncentrisani ekstrakti nisu isto što i začin u hrani. Piperin u nekim preparatima može uticati na metabolizam lekova. Kod bolesti žučne kese, jetre ili redovne terapije proveriti upotrebu sa stručnjakom."},
{slug:"melatonin",title:"Melatonin i san",keywords:"melatonin spavanje san nesanica ritam spavanja",content:"Melatonin učestvuje u regulaciji ritma spavanja i budnosti. Suplement nije univerzalno rešenje za nesanicu; efekat zavisi od uzroka i vremena uzimanja. Može izazvati pospanost i uticati na vožnju. Ne kombinovati sa alkoholom ili sedativima bez stručnog saveta."},
{slug:"sleep-hygiene",title:"Navike koje podržavaju kvalitetan san",keywords:"san spavanje nesanica rutina ekran kofein",content:"Za podršku snu pomažu redovno vreme odlaska na spavanje i buđenja, mirna prostorija, smanjenje kofeina kasnije tokom dana i ograničavanje ekrana pred spavanje. Uporna nesanica ili izražena dnevna pospanost zahtevaju razgovor sa lekarom."},
{slug:"stress",title:"Stres i biljni preparati",keywords:"stres napetost nervoza adaptogen smirenje biljke",content:"Stres može imati psihološke i telesne uzroke. San, fizička aktivnost, redovni obroci i tehnike opuštanja mogu biti deo podrške. Biljni preparati nisu zamena za stručnu pomoć kod dugotrajne anksioznosti, depresije ili napada panike."},
{slug:"bloating",title:"Nadutost i gasovi – opšte informacije",keywords:"nadutost gasovi stomak varenje digestija probava",content:"Nadutost i gasovi mogu biti povezani sa brzinom jedenja, gaziranim pićima, pojedinim namirnicama ili zatvorom. Korisno je pratiti kada se tegobe javljaju, jesti sporije i održavati hidrataciju. Jak ili iznenadan bol, povraćanje, krv u stolici, gubitak težine ili uporne tegobe zahtevaju lekarsku procenu."},
{slug:"constipation",title:"Zatvor – opšte mere",keywords:"zatvor opstipacija stolica vlakna voda probava",content:"Kod povremenog zatvora mogu pomoći postepeno povećanje vlakana, dovoljno tečnosti ako nije ograničena zbog bolesti, kretanje i redovna rutina. Novi ili dugotrajan zatvor, jak bol, povraćanje, krv u stolici ili nemogućnost ispuštanja gasova zahtevaju medicinsku procenu."},
{slug:"diarrhea",title:"Proliv – nadoknada tečnosti",keywords:"proliv dijareja dehidracija elektroliti rehidratacija",content:"Kod proliva je važno nadoknađivati tečnost i elektrolite; rastvori za oralnu rehidrataciju koriste se prema uputstvu. Krv u stolici, visoka temperatura, znaci dehidracije, jak bol ili dugotrajni simptomi zahtevaju lekarsku procenu."},
{slug:"heartburn",title:"Gorušica i refluks – opšte informacije",keywords:"gor usica gorusica refluks zeludac kiselina",content:"Gorušica može biti povezana sa vraćanjem želudačnog sadržaja u jednjak. Nekima pomažu manji obroci, izbegavanje ličnih okidača i neleganje odmah nakon jela. Otežano gutanje, povraćanje krvi, crna stolica ili gubitak težine zahtevaju pregled. Bol u grudima ne pripisivati automatski gorušici."},
{slug:"blood-sugar",title:"Šećer u krvi i suplementi",keywords:"secer krv glukoza dijabetes insulin glikemija",content:"Suplementi i biljni preparati ne zamenjuju lekove za dijabetes. Neki sastojci mogu uticati na šećer ili terapiju. Osobe koje koriste insulin ili lekove treba da se posavetuju sa lekarom pre novog preparata i da ne menjaju terapiju samostalno."},
{slug:"blood-pressure",title:"Krvni pritisak i biljni preparati",keywords:"pritisak krvni hipertenzija hipotenzija",content:"Krvni pritisak se procenjuje pravilnim merenjem kroz više vrednosti. Suplementi ne zamenjuju propisanu terapiju, a neki sastojci mogu uticati na pritisak ili lekove. Ne prekidati terapiju samostalno."},
{slug:"liver",title:"Jetra i oprez sa suplementima",keywords:"jetra detoks detox ciscenje jetre hepatoprotektivno",content:"Preparati reklamirani kao detoks ili čišćenje jetre ne treba da obećavaju uklanjanje toksina ili lečenje bolesti. Pojedini biljni ekstrakti i suplementi mogu oštetiti jetru ili stupiti u interakcije sa lekovima. Žutilo kože ili beonjača, taman urin ili jak bol zahtevaju lekarsku procenu."},
{slug:"kidneys",title:"Bubrezi i bezbednost suplemenata",keywords:"bubrezi bubreg kamen pesak kreatinin",content:"Kod smanjene funkcije bubrega suplementi magnezijuma, kalijuma, fosfora i pojedini biljni preparati mogu biti rizični. Osobe sa bubrežnom bolešću ili kamenom u bubregu ne treba da uzimaju preparate bez provere sa lekarom."},
{slug:"menopause",title:"Menopauza – biljni preparati i očekivanja",keywords:"menopauza klimaks valunzi nocno znojenje hormoni",content:"Simptomi menopauze se razlikuju. Biljni proizvodi imaju različite dokaze i bezbednosne profile. Preparati sa fitoestrogenima ili biljnim ekstraktima nisu prikladni za svakoga, naročito kod hormonski osetljivih stanja ili terapije. Za izražene simptome razgovarati sa ginekologom."},
{slug:"urinary",title:"Mokraćni putevi – kada potražiti pomoć",keywords:"mokracni putevi urinarno besika infekcija urin cistitis",content:"Peckanje pri mokrenju, učestalo mokrenje i bol mogu imati različite uzroke. Čajevi i suplementi ne leče pouzdano bakterijsku infekciju i ne treba da odlažu pregled. Temperatura, bol u slabinama, krv u urinu ili trudnoća zahtevaju brzu medicinsku procenu."},
{slug:"skin-hair-nails",title:"Koža, kosa i nokti – ishrana i suplementi",keywords:"koza kosa nokti opadanje lomljivi biotin cink kolagen",content:"Stanje kože, kose i noktiju zavisi od genetike, ishrane, hormona, nege i zdravlja. Suplement može imati smisla kod potvrđenog manjka, ali ne rešava sve uzroke opadanja kose. Biotin u većim dozama može ometati rezultate nekih laboratorijskih testova."},
{slug:"joints",title:"Zglobovi i pokretljivost",keywords:"zglobovi kolena hrskavica glukozamin hondroitin kolagen bol",content:"Bolovi u zglobovima mogu nastati zbog povrede, preopterećenja ili različitih bolesti. Glukozamin, hondroitin i kolagen imaju različite i ograničene dokaze; ne predstavljati ih kao zamenu za dijagnozu ili terapiju. Iznenadan otok, crvenilo, toplota zgloba ili temperatura zahtevaju pregled."},
{slug:"weight",title:"Kontrola telesne mase – bezbedan pristup",keywords:"mršavljenje kilogrami telesna masa dijeta metabolizam sagorevac masti",content:"Održiva promena telesne mase zasniva se na dugoročnim navikama u ishrani, kretanju i snu. Preparati za mršavljenje ne garantuju rezultat, a neki mogu imati neželjene efekte. Izbegavati ekstremne dijete, laksative i preparate nepoznatog sastava."},
{slug:"immune",title:"Imunitet – šta realno može suplement",keywords:"imunitet otpornost prehlada infekcija vitamin c d cink",content:"Normalna funkcija imunskog sistema zavisi od raznovrsne ishrane, sna, aktivnosti i drugih faktora. Vitamini i minerali doprinose normalnoj funkciji imuniteta kada su potrebe zadovoljene; dodatne količine ne garantuju da se infekcija neće javiti niti je leče."},
{slug:"essential-oils",title:"Eterična ulja – bezbedna upotreba",keywords:"etericno ulje aromaterapija lavanda nana cajevac razblazivanje",content:"Eterična ulja su koncentrisane smeše i nisu isto što i biljni čajevi. Ne gutati ih osim ako su izričito namenjena za oralnu upotrebu i uz odgovarajući stručni savet. Za kožu pratiti uputstvo i razblaživanje; poseban oprez potreban je kod dece, trudnoće, astme i kućnih ljubimaca."},
{slug:"label-reading",title:"Kako čitati deklaraciju suplementa",keywords:"deklaracija etiketa dnevna doza sastav aktivna materija porcija",content:"Proveriti količinu po kapsuli ili porciji, preporučenu dnevnu količinu, aktivne sastojke, alergene, upozorenja, proizvođača, seriju i rok. Obratiti pažnju da li je navedena masa sirovine ili količina aktivne supstance. Ne izmišljati podatke koji nedostaju."},
{slug:"supplement-combinations",title:"Kombinovanje više suplemenata",keywords:"kombinovanje suplementi zajedno dupliranje vitamini minerali predoziranje",content:"Isti sastojak može biti prisutan u multivitaminu i pojedinačnim preparatima. Saberite dnevne količine i proverite bezbedne granice sa stručnjakom. Poseban oprez potreban je kod vitamina A i D, gvožđa, cinka, selena, joda i vitamina B6."},
{slug:"natural-not-always-safe",title:"Prirodno ne znači automatski bezbedno",keywords:"prirodno bezbedno biljno alergija interakcija doza",content:"Biljni i prirodni sastojci mogu izazvati alergije, neželjene reakcije ili interakcije sa lekovima. Bezbednost zavisi od vrste biljke, dela biljke, ekstrakta, doze, kvaliteta i zdravstvenog stanja korisnika."},
{slug:"evidence-claims",title:"Kako tumačiti tvrdnje o dejstvu proizvoda",keywords:"dokazi naucni dokazi studije tvrdnje leci izlecenje efikasnost",content:"Marketinške tvrdnje treba razlikovati od dokaza iz kvalitetnih istraživanja i od odobrenih zdravstvenih tvrdnji. Jedna mala studija ne dokazuje da proizvod leči bolest. Pametnica ne sme obećavati izlečenje, garantovan rezultat ili zamenu za lek."}
);


GUIDES.push(
{slug:"e-coli-infection",title:"Ešerihija koli (E. coli) i urinarne infekcije",keywords:"escherichia coli e coli eserihija eserihiju ešerihija bakterija urin mokraca urinokultura infekcija besika",content:"E. coli je bakterija koja često može izazvati infekciju mokraćnih puteva. Pozitivan nalaz bakterije mora se tumačiti zajedno sa simptomima i rezultatima urinokulture; samo prisustvo bakterije ne znači uvek aktivnu infekciju. Kod simptoma kao što su peckanje, učestalo mokrenje ili bol treba se javiti lekaru radi procene i odgovarajuće analize. Antibiotik se bira prema kliničkoj proceni i, kada je potrebno, antibiogramu. Brusnica, D-manoza, probiotici i biljni čajevi nisu zamena za dijagnostiku ili antibiotik kada je propisan. Temperatura, bol u slabinama, mučnina/povraćanje, krv u mokraći ili trudnoća zahtevaju brzu procenu. Izvor: NHS – urinary tract infections."},
{slug:"urine-culture",title:"Urinokultura i antibiogram – šta znače",keywords:"urinokultura urin kultura bakterije antibiogram osetljivost antibiotik nalaz",content:"Urinokultura je laboratorijska analiza kojom se proverava rast bakterija u uzorku urina. Antibiogram pokazuje na koje antibiotike je izolovana bakterija osetljiva u laboratorijskim uslovima. Rezultat se tumači zajedno sa simptomima, načinom uzimanja uzorka, trudnoćom, polom i drugim zdravstvenim faktorima. Nemojte samostalno započinjati, prekidati ili menjati antibiotik. Pametnica može objasniti pojmove sa nalaza, ali ne postavlja dijagnozu niti bira terapiju."},
{slug:"prostate-health",title:"Prostata – simptomi i bezbedan pristup",keywords:"prostata uvecana prostata benigno uvecanje prostate mokrenje slab mlaz nocno mokrenje urolog",content:"Uvećana prostata može izazvati otežan početak mokrenja, slab ili isprekidan mlaz, osećaj nepotpunog pražnjenja i češće noćno mokrenje. Slične tegobe mogu imati i druge uzroke, pa je potreban pregled kod lekara/urologa. Krv u mokraći, bol pri mokrenju ili nemogućnost mokrenja zahtevaju hitnu procenu. Dodaci ishrani i biljni preparati nisu zamena za pregled niti dokazano lečenje uvećane prostate. Ako proizvod sadrži Serenoa repens/saw palmetto ili seme bundeve, Pametnica treba da navede sastav i deklaraciju, ali ne obećava smanjenje prostate ili izlečenje. Izvor: NHS – enlarged prostate."},
{slug:"prostate-supplements",title:"Sastojci koji se reklamiraju za prostatu",keywords:"serenoa repens saw palmetto sabal palma sabal beta sitosterol seme bundeve kopriva prostata",content:"Serenoa repens (saw palmetto), beta-sitosterol, seme bundeve i koren koprive pojavljuju se u nekim proizvodima koji se reklamiraju za prostatu. Dokazi o koristi nisu jednaki za sve sastojke i preparate, a kvalitet i standardizacija se razlikuju. Ne zaključivati da proizvod leči benigno uvećanje prostate, prostatitis ili rak prostate. Kod problema sa mokrenjem prvo je potreban pregled; ne odlagati PSA ili druge preglede koje preporuči lekar. Proveriti moguće interakcije sa terapijom."},
{slug:"period-pain",title:"Bolne menstruacije – šta je važno znati",keywords:"bolne menstruacije bolna menstruacija menstrualni bol grcevi ciklus dismenoreja pms",content:"Grčevi tokom menstruacije mogu nastati zbog kontrakcija materice, ali novi, veoma jaki ili sve jači bolovi mogu biti povezani sa endometriozom, adenomiozom, miomima ili infekcijom. Toplota na donjem stomaku, odmor i blago kretanje nekima prijaju. Lekovi protiv bolova i hormonske opcije treba da se biraju uz savet zdravstvenog stručnjaka i u skladu sa kontraindikacijama. Javite se ginekologu ako bol remeti svakodnevni život, menstruacije postanu obilnije ili neredovne, javlja se bol pri odnosu ili mokrenju, ili krvarenje između ciklusa. Iznenadan jak bol, moguća trudnoća, nesvestica, temperatura ili obilno krvarenje zahtevaju hitnu procenu. Izvor: NHS – period pain."},
{slug:"endometriosis",title:"Endometrioza – simptomi koji zahtevaju procenu",keywords:"endometrioza endometriosis bolna menstruacija karlica bol odnos bol stolica mokrenje",content:"Endometrioza je stanje u kojem tkivo slično sluzokoži materice nalazi se izvan materice. Mogući simptomi uključuju bolne ili obilne menstruacije, bol u karlici, bol tokom ili nakon seksualnog odnosa, bol pri pražnjenju creva ili mokrenju i umor. Simptomi se razlikuju i ne mogu se potvrditi preko razgovora sa Pametnicom. Ako tegobe utiču na svakodnevni život, obratite se ginekologu. Suplementi i čajevi nisu dokazano lečenje endometrioze. Izvor: NHS – endometriosis."},
{slug:"pms",title:"PMS – predmenstrualni sindrom",keywords:"pms predmenstrualni sindrom razdrazljivost grudi nadutost glavobolja promene raspolozenja",content:"PMS obuhvata fizičke i emocionalne simptome koji se javljaju pre menstruacije, kao što su nadutost, osetljivost grudi, glavobolja, promene raspoloženja i razdražljivost. Vođenje dnevnika simptoma kroz najmanje dva ciklusa može pomoći lekaru da proceni obrazac. Redovan san, kretanje i uravnotežena ishrana mogu biti deo opštih navika. Ako simptomi značajno ometaju život, razgovarajte sa ginekologom; postoje medicinske mogućnosti lečenja. Ne predstavljati magnezijum, virak ili druge biljke kao dokazanu terapiju za PMS. Izvor: NHS – PMS."},
{slug:"pcos",title:"PCOS – sindrom policističnih jajnika",keywords:"pcos policisticni jajnici policisticni ovarijalni sindrom neredovna menstruacija androgeni insulinska rezistencija",content:"PCOS je hormonsko-metabolički sindrom koji može biti povezan sa neredovnim ciklusima, pojačanim androgenima, aknama, pojačanom maljavošću i poteškoćama sa ovulacijom. Dijagnozu postavlja lekar na osnovu simptoma, pregleda i odgovarajućih analiza; sam ultrazvučni nalaz nije dovoljan za svaku osobu. Ishrana, fizička aktivnost i praćenje metaboličkog zdravlja mogu biti deo plana, a terapija zavisi od ciljeva i simptoma. Ne postoji jedan suplement koji leči PCOS ili univerzalno reguliše hormone."},
{slug:"menopause-detail",title:"Menopauza i perimenopauza – simptomi i mogućnosti",keywords:"menopauza perimenopauza klimaks valunzi nocno znojenje hormoni san raspolozenje vaginalna suvoca",content:"Perimenopauza je prelazni period u kojem se ciklusi i simptomi menjaju; menopauza se obično definiše nakon 12 meseci bez menstruacije, kada nema drugog uzroka. Mogući simptomi su valunzi, noćno znojenje, poremećaj sna, promene raspoloženja, vaginalna suvoća, smanjen libido i bolovi u zglobovima. Postoje medicinske i nemedicinske mogućnosti za ublažavanje simptoma, uključujući hormonsku terapiju za odgovarajuće osobe. O izboru razgovarati sa lekarom. Crvena detelina, soja, crni kohoš i drugi biljni preparati nisu dokazano ekvivalentni hormonskoj terapiji i mogu imati interakcije. Svako krvarenje nakon 12 meseci bez menstruacije zahteva pregled. Izvor: NHS – menopause."},
{slug:"red-clover",title:"Crvena detelina i fitoestrogeni",keywords:"crvena detelina trifolium pratense izoflavoni fitoestrogen menopauza estrogen",content:"Crvena detelina (Trifolium pratense) sadrži izoflavone koji se nazivaju fitoestrogenima. To ne znači da biljka deluje kao propisana estrogenska terapija niti da pouzdano uklanja valunge ili reguliše hormone. Dokazi o koristi kod menopauzalnih simptoma su ograničeni i neujednačeni. Poseban oprez potreban je kod hormonski osetljivih bolesti, hormonske terapije, trudnoće i dojenja. Pre upotrebe proveriti sa lekarom ili farmaceutom. Izvor: NHS – herbal remedies for menopause."},
{slug:"hormone-balance",title:"Hormonalni balans – šta taj izraz znači",keywords:"hormonalni balans hormonski balans disbalans hormoni estrogen progesteron testosteron prolaktin",content:"Izraz 'hormonalni balans' nije jedna medicinska dijagnoza. Različiti hormoni imaju različite uloge, a tumačenje nalaza zavisi od uzrasta, pola, faze menstrualnog ciklusa, trudnoće, lekova i simptoma. Umor, akne, promene težine ili neredovan ciklus ne dokazuju sami po sebi hormonski poremećaj. Ne preporučivati biljni preparat za 'regulisanje hormona' bez procene. Lekar može odrediti koje analize imaju smisla; nasumično testiranje svih hormona često nije korisno."},
{slug:"thyroid-basics",title:"Štitna žlezda – hormoni i suplementi",keywords:"stitna zlezda stitnjaca tsh ft4 ft3 hashimoto hipotireoza hipertireoza jod selen",content:"Štitna žlezda proizvodi hormone koji utiču na metabolizam. Procena često uključuje TSH i, prema potrebi, FT4 i druga ispitivanja. Simptomi poput umora, lupanja srca, promene težine ili opadanja kose nisu dovoljni za dijagnozu. Jod, alge i visoke doze selena nisu bezazleni i mogu biti neodgovarajući kod pojedinih bolesti štitne žlezde. Ne menjati terapiju levotiroksinom ili drugim lekovima zbog suplementa; pitati lekara/farmaceuta i proveriti razmak uzimanja minerala ako je relevantno."},
{slug:"plant-milk",title:"Biljni napici kao zamena za kravlje mleko",keywords:"biljno mleko biljni napitak sojino ovseno bademovo kokosovo pirincano zamena za kravlje mleko",content:"Biljni napici od soje, ovsa, badema, pirinča i kokosa nisu nutritivno jednaki kravljem mleku. Sojin napitak obično ima više proteina od bademovog, pirinčanog ili kokosovog; sastav zavisi od brenda. Ako se koristi kao redovna zamena, birati nezaslađen napitak obogaćen kalcijumom, vitaminom B12 i vitaminom D; proveriti i jod i proteine na deklaraciji. Promućkati pre upotrebe ako je kalcijum dodat. Za kafu i kuvanje ukus i tekstura mogu biti glavni kriterijumi. Kod alergije na proteine kravljeg mleka, mleko bez laktoze nije odgovarajuća zamena jer i dalje sadrži mlečne proteine. Za odojčad i malu decu ne zamenjivati majčino mleko ili formulu običnim biljnim napicima bez pedijatra/dijetetičara. Izvor: NHS – dairy and alternatives."},
{slug:"lactose-vs-milk-allergy",title:"Intolerancija na laktozu i alergija na mlečne proteine",keywords:"laktoza lactose intolerancija alergija kravlje mleko kazein surutka mlečni proteini",content:"Intolerancija na laktozu nastaje kada organizam teško vari mlečni šećer laktozu; proizvodi bez laktoze mogu biti odgovarajući za neke osobe. Alergija na proteine kravljeg mleka je imunološka reakcija na mlečne proteine kao što su kazein ili proteini surutke. Mleko bez laktoze i dalje sadrži te proteine i nije bezbedna zamena kod alergije. Kod sumnje na alergiju, naročito kod dece, izbor ishrane treba voditi uz lekara/dijetetičara. Otežano disanje ili otok jezika/grla su hitni znaci."},
{slug:"vegan-nutrients",title:"Biljna ishrana – nutrijenti koje treba planirati",keywords:"veganska ishrana vegan vegetarijanska b12 kalcijum jod vitamin d gvozdje omega 3",content:"Dobro planirana biljna ishrana može biti raznovrsna, ali je važno obratiti pažnju na vitamin B12, kalcijum, jod, vitamin D, gvožđe, cink i omega-3. B12 treba obezbediti pouzdanim obogaćenim namirnicama ili suplementom. Biljni napici nisu svi obogaćeni; proveriti deklaraciju. Gvožđe iz biljnih izvora se slabije apsorbuje nego iz mesa, a vitamin C uz obrok može pomoći apsorpciji. Izvor: NHS – vegan diet."},
{slug:"probiotics-detail",title:"Probiotici – izbor prema soju i nameni",keywords:"probiotici probiotik soj strain lactobacillus bifidobacterium crevna flora",content:"Probiotik nije samo naziv vrste bakterije: efekti su specifični za soj, kombinaciju i dozu. Proveriti pun naziv soja, broj živih mikroorganizama do isteka roka i način čuvanja. Ne obećavati da svaki probiotik rešava nadutost, proliv, kandidu ili infekciju urinarnog trakta. Kod teškog oboljenja ili oslabljenog imuniteta upotrebu proveriti sa lekarom."},
{slug:"cranberry-d-mannose",title:"Brusnica i D-manoza – šta mogu, a šta ne mogu",keywords:"brusnica cranberry d manoza mannoza urinarna infekcija e coli prevencija cistitis",content:"Brusnica i D-manoza se prodaju kao proizvodi povezani sa zdravljem mokraćnih puteva. Ne treba ih predstavljati kao lek za aktivnu bakterijsku urinarnu infekciju niti kao zamenu za urinokulturu i propisanu terapiju. Dokazi za prevenciju i korist zavise od populacije i preparata i nisu garancija. Kod ponavljanih infekcija razgovarati sa lekarom o uzroku i prevenciji; temperatura, bol u slabinama, krv u urinu ili trudnoća zahtevaju brzu procenu."},
{slug:"magnesium-forms",title:"Oblici magnezijuma – citrat, glicinat i oksid",keywords:"magnezijum citrat glicinat bisglicinat oksid hlorid elementarni magnezijum",content:"Magnezijum-citrat, -glicinat/bisglicinat i -oksid razlikuju se po količini elementarnog magnezijuma, rastvorljivosti i podnošljivosti. Upoređivati deklarisanu količinu elementarnog magnezijuma, a ne samo masu jedinjenja. Citrat kod nekih osoba može omekšati stolicu; veće doze mogu izazvati proliv. Kod bolesti bubrega i uz redovnu terapiju obavezna je provera sa lekarom/farmaceutom. Ne preporučivati isti broj kapsula za različite proizvode."},
{slug:"vitamin-d-and-calcium",title:"Vitamin D i kalcijum – zajedno i odvojeno",keywords:"vitamin d kalcijum kosti osteoporoza apsorpcija",content:"Vitamin D pomaže apsorpciju kalcijuma i doprinosi održavanju normalnih kostiju. To ne znači da svako treba da uzima oba suplementa; izbor zavisi od ishrane, nalaza, uzrasta i zdravstvenog stanja. Preteran unos vitamina D ili kalcijuma može biti štetan, naročito kod bolesti bubrega ili poremećaja kalcijuma. Doze treba uskladiti sa lekarom."},
{slug:"supplement-interactions-anticoagulants",title:"Suplementi i lekovi protiv zgrušavanja krvi",keywords:"varfarin antikoagulansi antitrombocitni aspirin suplementi ginko beli luk kantarion omega 3",content:"Osobe koje koriste varfarin, direktne oralne antikoagulanse ili antiagregacione lekove treba da provere svaki novi biljni preparat i suplement sa lekarom/farmaceutom. Neki sastojci mogu povećati krvarenje ili promeniti dejstvo terapije. Ne prekidati lek i ne uvoditi suplement samostalno. Prijaviti lekaru sve čajeve, tinkture, vitamine i proizvode koje koristite."},
{slug:"high-blood-pressure",title:"Povišen krvni pritisak – suplementi nisu terapija",keywords:"hipertenzija visok povisen krvni pritisak merenje so kalijum suplement",content:"Povišen pritisak se procenjuje pravilnim merenjem i ukupnim kardiovaskularnim rizikom. Smanjenje soli, redovna aktivnost, uravnotežena ishrana i terapija koju propiše lekar mogu biti deo plana. Suplementi i biljni preparati ne zamenjuju antihipertenzivne lekove; neki mogu uticati na pritisak ili terapiju. Ne uzimati kalijum bez provere, posebno kod bolesti bubrega ili određenih lekova."},
{slug:"blood-glucose-food",title:"Šećer u krvi, zaslađivači i deklaracije",keywords:"glukoza secer dijabetes zasladjivaci stevija eritritol ksilitol fruktoza glikemijski indeks",content:"Zaslađivači se razlikuju po sastavu i uticaju na glikemiju. Eritritol i stevija imaju drugačiji profil od šećera, dok ksilitol i drugi polioli mogu izazvati stomačne tegobe kod većih količina. Proizvod sa oznakom 'bez šećera' i dalje može sadržati ugljene hidrate ili kalorije. Kod dijabetesa proveriti ukupne ugljene hidrate i deklaraciju, ne oslanjati se samo na glikemijski indeks ili marketinški naziv. Ne menjati terapiju zbog zaslađivača."},
{slug:"gut-fiber",title:"Vlakna – psilijum, lan, ovas i inulin",keywords:"vlakna psilijum psyllium laneno seme ovas inulin zatvor holesterol probava",content:"Različita vlakna imaju različita svojstva. Psilijum upija vodu i može pomoći regulisanju stolice; uvoditi ga postepeno uz dovoljno tečnosti i proveriti razmak od lekova prema deklaraciji/farmaceutu. Lan i ovas doprinose unosu vlakana. Inulin kod nekih ljudi pojačava gasove i nadutost. Kod otežanog gutanja, suženja creva ili jakog bola ne uzimati vlakna bez medicinskog saveta."},
{slug:"food-allergens",title:"Alergeni u hrani i deklaracija",keywords:"alergeni gluten soja badem orasi kikiriki mleko laktoza deklaracija tragovi",content:"Kod alergije proveriti kompletan sastav i upozorenje o mogućim tragovima alergena; naziv proizvoda ili oznaka 'biljno' nisu dovoljni. Intolerancija na laktozu nije isto što i alergija na mlečne proteine. Kod celijakije potrebno je pouzdano bezglutensko označavanje i sprečavanje unakrsne kontaminacije. Teška alergijska reakcija sa otežanim disanjem ili otokom jezika/grla zahteva hitnu pomoć."}
);

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
       concat_ws(E'\n',
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

export async function answerFromKnowledge(db, message) {
  const original = normalize(message);
  const questionLike = /\\b(sta je|sta znaci|cemu sluzi|za sta sluzi|kako deluje|kako se koristi|zasto|koja je razlika|objasni|reci mi o|sta preporucujete|sta preporucujes|sta da radim|imam|muci me|problem sa|kako da|da li mogu|da li je|preporuka|preporucite|za|oko|u vezi sa)\\b/.test(original) || original.split(" ").filter(x => x.length > 3).length >= 2;
  if (!questionLike) return null;
  const stop = new Set(["sta","znaci","cemu","sluzi","za","je","kako","se","koristi","zasto","koja","koji","koje","razlika","objasni","reci","mi","o","molim","vas","moze","li","imam","muci","me","problem","sa","preporucujete","preporucujes","radim","mogu","da","kod","oko","u","vezi","moja","moj","moje","neki","neka","neko","treba","potrebno","zelim","hteo","htela","bih","imate","vam"]);
  const terms = original.split(" ").filter(word => word.length>2 && !stop.has(word));
  if (!terms.length) return null;
  const entries = await searchKnowledge(db,terms.join(" "),5);
  const best = entries.find(entry => entry.entry_type === "guide") || entries.find(entry => entry.entry_type === "product");
  if (!best) return null;
  if (best.entry_type === "product") {
    return { type:"auto", text:"Prema podacima za **" + best.title + "** u BIO KUTAK katalogu: 🌿\n\n" + best.content.slice(0,2600) +
      (best.product_url ? "\n\n" + best.product_url : "") +
      "\n\nOpis proizvoda je informacija iz kataloga, a ne potvrda medicinskog dejstva. Za zdravstvene tegobe ili kombinovanje sa terapijom posavetujte se sa lekarom ili farmaceutom." };
  }
  return { type:"auto", text:"**" + best.title + "**\n\n" + best.content +
    "\n\nOvo su opšte informacije; za izbor konkretnog proizvoda proverite njegovu deklaraciju." };
}

export async function searchKnowledge(db, query, limit=5) {
  await ensureKnowledgeSchema(db);
  const terms = [...new Set(normalize(query).split(" ").filter(x=>x.length>2))].slice(0,10);
  if (!terms.length) return [];
  // OR retrieval handles short, natural-language customer queries with extra words.
  const tsQuery = terms.map(x => x.replace(/[^a-z0-9]/g,"")).filter(Boolean).join(" | ");
  const patterns = terms.map(x => "%" + x + "%");
  const result = await db.query(
    `SELECT slug,entry_type,title,keywords,content,product_url,source,
      ts_rank(to_tsvector('simple',coalesce(title,'') || ' ' || coalesce(keywords,'') || ' ' || coalesce(content,'')), to_tsquery('simple',$1)) AS rank,
      (CASE WHEN title ILIKE ANY($2::text[]) THEN 5 ELSE 0 END +
       CASE WHEN keywords ILIKE ANY($2::text[]) THEN 3 ELSE 0 END) AS phrase_bonus
     FROM knowledge_entries
     WHERE to_tsvector('simple',coalesce(title,'') || ' ' || coalesce(keywords,'') || ' ' || coalesce(content,'')) @@ to_tsquery('simple',$1)
        OR title ILIKE ANY($2::text[]) OR keywords ILIKE ANY($2::text[])
     ORDER BY (rank + phrase_bonus) DESC, updated_at DESC LIMIT $3`,
    [tsQuery,patterns,Math.max(1,Math.min(10,limit))]
  );
  return result.rows;
}
