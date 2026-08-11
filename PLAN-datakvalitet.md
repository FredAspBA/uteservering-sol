# Plan: bättre datakvalitet för skuggor, platser och sol

Status: **fas 1–3 byggda och verifierade** (fas 3 mot två riktiga
`workflow_dispatch`-körningar, se PR #2). **Fas 4:s valideringsexperiment
kört och klart — NO-GO: Overture slår inte nuvarande modell på den
population som faktiskt räknas (byggnader utan känd höjd), och täcker
bara drygt hälften av dem.** **Fas 5 (del A + del B) helt klar.** Skapad
2026-08-07, fas 3 klar 2026-08-08, fas 4-valideringen klar 2026-08-08
(första omgången var cirkulär, se avsnittet nedan; korrigerad och
avslutad NO-GO samma dag), fas 5 del A klar 2026-08-08, del B klar
2026-08-11.

Målet är så tillförlitlig data som möjligt — skuggor, platser, sol — med
enbart avgiftsfria källor. Den här filen är beslutsunderlaget; bocka av
faserna i takt med att de byggs.

## Utgångsläge (uppmätt, inte gissat)

Mätning på `data/buildings.geojson` (23 251 byggnader):

```
height-tagg:           89  (0,4 %)
building:levels:    4 489  (19,3 %)
någon höjdkälla:    4 534  (19,5 %)
GISSAS till 15 m:  18 717  (80,5 %)
```

**Fyra av fem byggnader i skuggberäkningen har en gissad höjd.** Det är
den största felkällan i appen — större än solalgoritm, raycast-geometri
och allt annat tillsammans.

Av de höjdlösa saknar 61,7 % dessutom typinformation (`building=yes`),
så per-typ-gissningar räcker inte hela vägen.

### Solpositionen är däremot inte ett problem

SunCalc ligger inom ~0,01° från NOAA:s referensalgoritm. Att byta till
NREL SPA eller astronomy-engine vore att slipa på fel ände. **Ingen
åtgärd föreslås.**

## Hold-out-validering av höjdgissning

De 4 525 byggnader som har känd höjd behandlades som okända, och olika
strategier fick gissa. Fel i meter:

| Strategi | MAE | Median-fel | Inom ±3 m | Inom ±6 m |
|---|---|---|---|---|
| Platt 15 m (nuvarande) | 10,40 m | 12,00 m | 9,0 % | 13,7 % |
| Per byggnadstyp | 1,68 m | 0,00 m | 89,5 % | 94,4 % |
| Grannskapsmedian | 1,63 m | 0,00 m | 89,6 % | 93,8 % |
| **Kombinerad** | **1,58 m** | **0,00 m** | **90,4 %** | **94,5 %** |

Uppmätta medianhöjder per typ: `house` 3,0 m · `detached` 3,0 m ·
`apartments` 12,0 m · `office` 16,5 m · `school` 7,5 m · `garage` 3,0 m ·
`shed` 3,0 m · `terrace` 6,0 m.

### Förbehåll — läs detta innan siffrorna övertolkas

Valideringsurvalet är **snedfördelat**: 74 % av byggnaderna med känd höjd
är `house`/`detached`, och medianen bland dem är 3,0 m. Det betyder att
förbättringen framför allt gäller **villaområdena** (Limhamn, Fridhem,
Erikslust), där dagens platta 15 m får varje villa att kasta en femdubbelt
för lång skugga.

I **innerstadens kvarter** — där de flesta uteserveringar faktiskt ligger
— är 15 m redan ungefär rätt för hyreshus (uppmätt median 12 m). Vinsten
där blir därför liten.

Därför mättes effekten om, mot appen istället för mot metrar — se nästa
avsnitt. Det är den siffran fas 1 vilar på, inte MAE-tabellen ovan.

## Verifierad effekt på appen (detta är siffran som räknas)

`scripts/impact-experiment.py` kör hela raycasten med båda höjdmodellerna
och räknar hur många uteserveringar som byter status. Resultatet kördes
sedan om med **den riktiga `computeShading()` från `src/shadow.js`**:

| Tidpunkt | Soliga före | Soliga efter | Skillnad |
|---|---|---|---|
| 15 maj 17:00 | 743 | 777 | +34 (+4,6 %) |
| 21 juni 18:00 | 697 | 745 | +48 (+6,9 %) |
| 15 juli 19:00 | 601 | 650 | +49 (+8,2 %) |
| 15 aug 16:00 | 799 | 821 | +22 (+2,8 %) |
| 15 sep 15:00 | 754 | 793 | +39 (+5,2 %) |

**Riktningen är det viktiga:** 92 % av statusändringarna går från skugga
till sol. Den platta 15-metersgissningen gjorde appen systematiskt
pessimistisk — den gömde soliga uteserveringar, vilket är precis motsatsen
till vad appen finns till för.

En ärlig notering: en tidigare Python-approximation av raycasten gav
+8,5–16,5 %, alltså dubbelt så mycket. Den approximationen exkluderade
inte terrassens egen byggnad, vilket `computeShading()` gör. **De lägre
talen i tabellen ovan är de riktiga.**

## Huvudutmaningen: nätverket

Sessionsmiljöns proxy blockerar all extern datatrafik — verifierat med
403 på `download.geofabrik.de`, `overturemaps.org`, `data.source.coop`
och `overpass-api.de`. Bara npm, PyPI och Anthropic släpps igenom.

Det betyder att jag **inte kan hämta ny data härifrån**, bara bearbeta det
som redan ligger i repot och skriva script som körs någon annanstans.

**Uppdatering 2026-08-07, senare samma dag:** en annan session (körd
lokalt i Claude Code CLI på Fredriks dator, inte molnmiljön ovan) testade
samma fyra värdar och nådde alla fyra utan problem (`overpass-api.de` →
400 på ett tomt GET, väntat, inte en blockering; `download.geofabrik.de` →
302; `restaurang.malmo.se` → 200; `overturemaps.org` → 200). Blockeringen
gäller alltså **den specifika molnmiljön där den här planen skrevs, inte
nätverksåtkomst i allmänhet** — vilken session eller miljö som helst kan
ha andra regler. Slutsatsen nedan ändras inte av det: väg D (GitHub
Actions) är fortfarande rätt val, men numera av andra skäl än
nätverksblockering — en permanent lösning oavsett vilken session som
råkar bygga/underhålla den, ingen manuell körning, alltid färsk data. Har
en session väl åtkomst kan den däremot prototypa och verifiera lokalt
först, vilket sänker antalet blinda Actions-iterationer (se fas 5, som
byggde vidare på precis det).

### Fyra vägar runt det, i stigande ordning av elegans

**A. Fredrik kör lokalt.** Jag skriver scripten, du kör dem på din maskin
och committar resultatet. Funkar idag, noll uppsättning, men du blir kvar
i loopen vid varje datasynk.

**B. Öppna nätverkspolicyn för miljön.** Miljöns nätverkspolicy väljs när
miljön skapas (se code.claude.com/docs). Läggs `download.geofabrik.de`,
`overturemaps.org` och `overpass-api.de` till i policyn kan jag köra hela
pipelinen härifrån. Kräver att du ändrar miljöinställningen.

**C. Data via repot.** Du laddar ner råfilerna en gång och committar dem;
jag bearbetar. Klumpigt för `.osm.pbf` i hundramegabytesklassen.

**D. GitHub Actions — rekommenderas.** Actions-runners har full
internetåtkomst. Ett workflow som kör datapipelinen och committar
resultatet löser problemet **permanent och för alla**: ingen Overpass-
tiling, inga 504:or, ingen manuell 20–40-minuterskörning, och
byggnadsluckorna kan aldrig uppstå igen. Kan triggas manuellt
(`workflow_dispatch`) eller schemalagt. Detta gör dessutom fas 3 och 4
körbara utan att någon av oss sitter och väntar.

## Faser

### ✅ Fas 1 — Bättre höjdgissning (KLAR)

Ersätt den platta 15-metersgissningen i `src/shadow.js` med:

1. `height` → 2. `building:levels` × 3 → 3. **per-typ-median** (från
tabellen ovan) → 4. **grannskapsmedian** för generiska typer → 5. 15 m.

Grannskapsmedianen återanvänder rutnätsindexet som redan finns i
`shadow.js`, och beräknas **en gång vid laddning**, inte per omberäkning —
prestandabudgeten i CLAUDE.md får inte regressa.

**Utfall:** byggnader kvar på 15-metersgissningen gick från 18 719 till
**1 529** (−92 %). Höjdfördelningen ser nu rimlig ut (p10 = 3 m,
median = 6 m, p90 = 15 m) istället för att 80 % klumpade ihop sig på
exakt 15 m. `prepareBuildings()` tar 116 ms — ingen prestandaregression.

### ✅ Fas 2 — Behåll fler höjdtaggar vid hämtning (KLAR)

`BUILDING_PROPS_TO_KEEP` i `scripts/fetch-data.js` slängde allt utom fem
taggar. Nu behålls även `roof:levels`, `roof:height`, `roof:shape`,
`est_height`, `min_height` och `building:min_level`. Gratis extra signal
vid nästa hämtning, försumbar filstorlek. Taggarna finns i datan först
efter nästa `npm run fetch-data`.

### ✅ Fas 3 — Pipeline utan Overpass (BYGGD OCH VERIFIERAD 2026-08-08)

Byt tiled Overpass mot **Geofabrik-extrakt + osmium**, kört i GitHub
Actions. Tar bort tidsgränser, hastighetsbegränsning och byggnadsluckor
strukturellt, och löser att-göra-punkten "fyll byggnadsluckor" permanent.

**Byggt och mergat till `main` via [PR #2](https://github.com/FredAspBA/uteservering-sol/pull/2)
(2026-08-08, stackad ovanpå [PR #1](https://github.com/FredAspBA/uteservering-sol/pull/1)):**

- `.github/workflows/refresh-data.yml` — `workflow_dispatch` + månadsvis
  schema (03:00 UTC den 1:a), `permissions: contents: write`, kö istället
  för avbrott vid överlappande körningar.
- `scripts/fetch-data-geofabrik.js` — hämtar Sverige-extraktet, `osmium
  extract` till Malmö-bboxen, `osmium tags-filter` (terrasser resp.
  byggnader), `osmium export` till GeoJSON, återställer OSM-id, filtrerar
  terrasser till exakt samma urval som Overpass-frågan, reducerar
  polygon-terrasser till en representativ punkt, kör byggnader genom
  samma slimning som idag. Skriver `data/*.geojson.new` — rör **aldrig**
  de riktiga filerna direkt.
- `scripts/check-data-drift.js` — ±20 %-grinden. Jämför `.new`-kandidaterna
  mot det som redan ligger i repot; avbryter jobbet (inget committas) om
  någon avviker för mycket.
- `scripts/lib/slim-building.js`, `scripts/lib/terrace-categories.js` —
  bruten ut ur `fetch-data.js` så Overpass-vägen (kvar som manuellt
  reservalternativ) och osmium-vägen delar exakt samma regler för vilka
  taggar som behålls och vilka ställen som räknas som terrass. Kan aldrig
  divergera i tysthet.
- `scripts/lib/write-geojson-lines.js` — en feature per rad, sorterat
  deterministiskt på OSM-id.

#### Verifierat mot riktiga Actions-körningar (inte längre bara lokalt/dokumentation)

Innan detta skeppades var de fyra osmium-CLI-anropen overifierade (ingen
`apt-get`/WSL-distro/Docker i utvecklingsmiljön — kontrollerat
2026-08-08). De kördes sedan på riktigt, tre gånger, via `workflow_dispatch`
mot GitHub Actions:

**Körning 1** ([run 31255468098](https://github.com/FredAspBA/uteservering-sol/actions/runs/31255468098),
1m26s): **alla steg gröna på första försöket** — inklusive alla fyra
osmium-anrop, som alltså fungerade direkt utan en enda iteration (planen
räknade med 2–3). Terrasser: 938 → 939 (+0,1 %, i praktiken exakt
matchning). Byggnader: 23 251 → 21 055 (**−9,4 %**) — inom ±20 %-grinden,
men värt att gräva i snarare än att bara lita på att grinden släppte
igenom det.

**Grävt i det:** en jämförelse av gammal mot ny `buildings.geojson` visade
att alla 3 351 saknade byggnader låg i randzonen precis utanför den råa
sökrutan. Orsak: `fetch-data.js` hämtar byggnader mot **terrassernas egen
uppmätta utbredning + 600 m marginal** (`BUILDING_PADDING_METERS`, ihop
med `MAX_RAY_METERS=500` i `shadow.js` — "hur långt en byggnad rimligen
kan skugga en terrass"), medan `fetch-data-geofabrik.js` av misstag
använde samma **opaddade** sökruta för både terrasser och byggnader,
vilket tyst tappade den marginalen.

**Fixat** ([commit e985d73](https://github.com/FredAspBA/uteservering-sol/commit/e985d73)):
två separata `osmium extract`-anrop istället för ett delat — terrasser mot
den exakta opaddade sökrutan (matchar Overpass-frågan exakt), byggnader
mot sökrutan **+600 m** via en ny `padOsmiumBboxMeters()`-hjälpare. En
statisk padding av hela sökrutan istället för en dynamisk padding av
terrassernas uppmätta utbredning — enklare, och alltid minst lika
heltäckande (sökrutan innehåller alltid terrassernas utbredning, så
sökruta+600m innehåller alltid terrass-utbredning+600m också).

**Körning 2** ([run 31255752905](https://github.com/FredAspBA/uteservering-sol/actions/runs/31255752905),
2m2s): grön igen. Terrasser: 939 → 939 (±0 %). Byggnader: 21 055 → **25 099**
(+19,2 % — och fler än de ursprungliga 23 251, som väntat eftersom den nya
paddingen är en superset av den gamla). Den nya byggnads-bboxen kontrollerad
geografiskt: `[12,893, 55,551, 13,047, 55,623]`, i det närmaste
pixelidentisk med den **ursprungliga** Overpass-hämtade bboxen `[12,893,
55,552, 13,047, 55,623]` — bekräftar att fixen återställde likvärdig
(faktiskt något bredare) täckning, inte bara ett antal som råkar passera
grinden.

**Körning 3** ([run 31256629412](https://github.com/FredAspBA/uteservering-sol/actions/runs/31256629412),
~2 min, kördes mot `main` **efter** att PR #1 och PR #2 mergats — första
körningen på den riktiga slutdestinationen, inte en feature-branch): grön.
Terrasser 939 → 939, byggnader 25 099 → 25 099 (±0 % båda, som väntat —
datan var redan färsk sedan körning 2 dagen innan). Detta var samtidigt
första gången **"inget att committa"-grenen** kördes på riktigt (tidigare
bara läst i koden): `git diff --cached --quiet` slog till, jobbet loggade
"No data changes this run — nothing to commit." och avslutades grönt utan
att pusha en tom commit. De sista overifierade raderna i workflowet är
därmed också bekräftade.

**Fortsatt lokalt testat** (från innan körningarna, se git-historiken för
detaljer): alla post-processing-funktioner mot handbyggda fixturer och
riktig data, `write-geojson-lines.js` (round-trip, determinism, ett
riktigt git-test), `check-data-drift.js` (fem scenarier),
`refresh-data.yml` validerad med actionlint (noll fel).

#### Tre saker vi lärde oss på vägen (värda att komma ihåg)

- **`osmium export --add-unique-id=type_id` ger INTE originalets id** för
  polygoner/areor (byggnader) — det ger 2×way-id (eller 2×relation-id+1),
  och att räkna baklänges är felbenäget. `--attributes=id,type` ger
  däremot originalets rena `@id`/`@type` som properties, utan omräkning.
  Det är vad `fetch-data-geofabrik.js` faktiskt använder.
- **Ett riktigt git-test** (23 251 byggnader, 50 ändrade) visade att gits
  binära delta-komprimering är bättre än väntat även för enrads-JSON —
  båda formaten packade till samma storlek när ordningen var stabil.
  Skillnaden syntes först när feature-ordningen slumpades om mellan
  körningar (+17 % `.git`-tillväxt utan sortering, 0 % med). **Den
  verkliga skyddsmekanismen är den deterministiska sorteringen på
  OSM-id, inte radbrytningarna i sig** — raderna gör diffen läsbar för en
  människa som granskar en PR, sorteringen är vad som faktiskt skyddar
  `.git`. `write-geojson-lines.js` gör båda.
- **En delad sökruta för terrasser och byggnader tappar tyst en viktig
  marginal.** `fetch-data.js` hämtar byggnader mot terrassernas egen
  uppmätta utbredning + 600 m, inte mot samma sökruta som terrasserna
  filtreras mot — en skillnad som är lätt att missa om man (som här)
  antar att "samma område" räcker. Hittades genom att inte nöja sig med
  att grinden släppte igenom en −9,4 %-avvikelse, utan gräva i *varför*.
  Se körning 1 → 2 ovan för hela utredningen.

#### Utmaningar och hur vi tar oss runt dem

| Utmaning | Lösning |
|---|---|
| **Repo-uppsvällning.** `buildings.geojson` är ~9 MB. | Skriv **en feature per rad, sorterat deterministiskt på OSM-id** (`write-geojson-lines.js`, verifierat med ett riktigt git-test). Kör **månadsvis**, inte veckovis, och committa bara vid faktisk ändring. |
| **Tyst sönderkörning.** Om ett filter blir fel kan workflowet committa en tom eller halv fil och slå sönder den live-appen utan att någon märker det. | **Grindar innan commit** (`check-data-drift.js`): avbryt om antalet terrasser eller byggnader avviker mer än ±20 % från det som redan ligger i repot. Verifierat i praktiken: fångade den riktiga byggnadsluckan i körning 1 (se ovan) utan att blockera den legitima täckningsökningen i körning 2. |
| **Extraktets storlek.** | Bekräftat 775 MB, ~15 s att hämta i Actions. Om det blir ett problem: byt till ett mindre regionalt extrakt eller BBBike:s skräddarsydda bbox-extrakt. |
| **Deploy-loop.** | Bekräftat i praktiken: två `workflow_dispatch`-körningar, två auto-commits till branchen, ingen av dem triggade en ny workflow-körning. |
| **Osmium-id:n matchar inte det format resten av koden förväntar sig.** (Upptäckt under bygget.) | `--attributes=id,type` istället för `--add-unique-id` — se ovan. |
| **Delad sökruta tappar byggnadsmarginalen.** (Upptäckt i körning 1, fixat till körning 2.) | Två separata `osmium extract` — terrasser opaddat, byggnader +600 m. Se ovan. |
| **Jag kan inte köra osmium härifrån.** | Ej längre ett hinder — verifierat på riktiga Actions-körningar, se ovan. Kvarstår bara som en anmärkning om varför den ursprungliga risken fanns. |

### ⛔ Fas 4 — Overture som höjdkälla (VALIDERINGSEXPERIMENT KLART 2026-08-08 — NO-GO, AVSLUTAD)

Hämta **höjder** från Overture Maps buildings (OSM + Microsoft/Google ML +
myndighetsdata, gratis) och lägg dem ovanpå OSM:s. Fas 1 är kvalificerade
uppskattningar; tanken var att det här skulle vara mätdata istället —
valideringen visade att det för vår population inte är det.

**Tänkt upplägg (byggs inte):** utöka fas 3-workflowet med ett DuckDB-steg
som läser Overtures publika parquet direkt med bbox-filter. Beslutet nedan
gör att det här inte byggs.

#### Valideringsexperiment (2026-08-08)

Kört: `scripts/overture-height-experiment.py`, hold-out-validering mot
Malmös byggnader (samma teknik som fas 1).

**Första körningen var cirkulär och missvisande.** Den ursprungliga
rapporten sammanfattade Overtures träffsäkerhet som ett enda blandat MAE
(1,09 m mot nuvarande modells 1,80 m) över alla matchade byggnader. En
slutgranskning avslöjade varför det talet inte går att lita på: 57,7 % av
de matchade byggnaderna fick sin Overture-höjd hämtad direkt från
OpenStreetMap självt — samma källa som "facit" i hold-out-testet kommer
från. Den delmängden får därför ett MAE nära noll nästan per definition
(Overture ekar bara tillbaka OSM:s eget värde) utan att testa något, och
drar ner det blandade snittet utan att det säger något om hur bra Overture
faktiskt är på byggnader vi *inte* redan har en höjd för.

**Omkört uppdelat på vilket dataset som faktiskt gav höjden** (inte bara
geometrin) ger den riktiga bilden:

| height_source | n | Overture MAE | nuvarande modell MAE (samma byggnader) |
|---|---|---|---|
| OpenStreetMap (ekar facit — inget oberoende test) | 2907 | 0,01 m | 1,73 m |
| Microsoft ML Buildings (det enda oberoende testet) | 2132 | **2,56 m** | **1,89 m** |

På den enda delmängden som faktiskt testar något oberoende slår Overture
alltså INTE nuvarande modell (2,56 m mot 1,89 m) — tvärtom, nuvarande
modell är bättre där.

**Produktionsrelevant täckning** (OSM-byggnader UTAN känd höjd — de en
produktionspipeline faktiskt skulle fråga Overture om, inte hold-out-
setets byggnader som redan har en höjd):

- Totalt: 20 054 byggnader utan känd höjd.
- Overture ger NÅGON höjd för 10 313 av dem (51,4 %) — varav 10 306
  Microsoft-ML-sourced och bara 7 OSM-sourced.

Dvs. Overture skulle täcka ungefär hälften av det verkliga behovet, och nästan
uteslutande med samma ML-höjder som just visade sig sämre än nuvarande
modell.

**Sidofynd (ej byggt):** en bias-koll på Microsoft-ML-delmängden visar att
Overture systematiskt överskattar (medel signed error +1,42 m, median
+2,01 m — troligen taknock mot OSM:s takfotskonvention). Subtraherar man
medianoffset sjunker MAE till 1,74 m, marginellt bättre än nuvarande
modells 1,89 m på samma byggnader. Det är en observation, inte en
specad eller byggd strategi — den kräver egen validering (håller offset
sig stabil över hela Malmö? över tid?) innan den är något att bygga på,
och ingår inte i det här beslutet.

**Beslut: NO-GO.** Overture slår inte nuvarande modell på den population
som räknas (byggnader utan känd höjd: Overture MAE 2,56 m mot nuvarande
modells 1,89 m på samma byggnader), och täcker dessutom bara 51,4 % av
den populationen. Fas 4 stängs här — ingen produktionsspec skrivs. Det
här är inte samma sak som "Overture är dåligt": det är att ett korrekt
test (isolerat från OSM-ekot) inte visade någon fördel just nu, med
dagens data och utan kalibrering.

#### Utmaningar och hur vi tar oss runt dem

| Utmaning | Lösning |
|---|---|
| **Konflatering är svårt.** Att matcha Overture-byggnader mot OSM-byggnader geometriskt är en klassisk felkälla — fel matchning ger fel höjd på fel hus. | **Rör inte geometrin.** Behåll OSM:s fotavtryck (redan buffrade och förenklade, och prestandaintrimmade) och hämta *bara höjd*. Matcha i första hand på OSM-id, som Overture bär med sig i sitt `sources`-fält; bara i andra hand på centroid inom några meter. |
| **Overture-höjder är delvis själva ML-gissningar.** Vi kan råka byta en bra gissning mot en sämre. | Mätt (se ovan): på den oberoende testbara delmängden (Microsoft ML Buildings) är Overtures MAE 2,56 m mot nuvarande modells 1,89 m — nuvarande modell vann, så inget byts ut. Ingen `impact-experiment.py`-körning mot riktig `computeShading()` gjordes eller behövdes, eftersom hold-out-valideringen redan gav NO-GO innan det steget. |
| **Ännu en stor fil i repot.** | Blev aldrig aktuellt — inget byggs. |

### ✅ Fas 5 del A — Serveringstillstånd från Malmö stad (KLAR 2026-08-08)

**Del A byggd och körd mot riktig data 2026-08-08:**
`scripts/fetch-serving-permits.js` (`npm run fetch-serving-permits`) hämtar
listsidan (verifierad live samma dag — strukturen från 2026-08-07 stämde
exakt, inklusive AJA/ALP-kolumnerna som ligger i `<abbr>`-taggar och
missades av ett första, för enkelt `grep`), matchar mot `data/
terraces.geojson` på normaliserat namn + gata (husnummer ignoreras för att
tolerera format som "25 - 27" vs "27"), och skriver `data/serving-
permits.json`. Körning på riktig data:

```
551 tillståndshavare i registret, 917 namngivna OSM-ställen att matcha mot
  112 starka matchningar (namn + gata)
   86 svaga matchningar (bara namn — OSM saknar addr:street)
  353 omatchade (osäkra eller saknas i vår OSM-data — se fas 5 del B)
175 löser ett tidigare alcohol=unknown OSM-ställe till alkohol: ja
```

De fem alkoholtyperna (Sprit/Vin/Starköl/AJA/ALP) kollapsas till en enda
boolean, eftersom appen själv bara förstår ja/nej/okänt (`venueInfo()` i
`src/app.js`) — ett tillstånd av vilken typ som helst räknas som "ja".
Endast listsidan behövs (ett anrop) — ingen detaljsida-skrapning gjordes,
eftersom Allmänheten/Uteservering/tid-precisionen den ger inte behövs för
det booleska alkohol-fältet appen faktiskt använder.

**Del A helt klar** (samma dag): `resolvesUnknownAlcohol`-fältet är inkopplat
i `scripts/build-tagging-list.js` och visas som en egen hint-chip
("Malmö stad: har serveringstillstånd", `.hint-register`) bredvid "OSM:
alkohol okänt" i taggning.html — aldrig auto-taggat, samma
"människan bekräftar"-mönster som resten av listan. Verifierat live i
webbläsaren (inte bara i JSON-outputen): 175 chips renderade, rätt text,
rätt ställe, inga konsolfel. `data/tagging-list.json` regenererad.

**Del B klar 2026-08-11:** `scripts/geocode-unverified-venues.js`
geokodar de 257 kandidaterna via Nominatim (cachad per registerId i
`data/geocode-forward-cache.json`) och skriver `data/unverified-
venues.geojson` i exakt samma Feature-form som `terraces.geojson` — rör
aldrig den filen själv. Riktig körning: **246/257 geokodade** (11
misslyckades på format som Nominatim inte tolkar — "Olof Palmes Plats 1",
adresser med snedstreck mellan två gator — hoppades över, ingen gissning).
**"Andys Burgers" (Mariedalsvägen 32) kom med** — den konkreta "Andy's"
som nämnts i CLAUDE.md sedan projektet startade.

**Viktig upptäckt under bygget:** svensk OSM-adresstäckning är gles —
Nominatim kan nästan aldrig slå upp exakt husnummer i Malmö (verifierat
live mot flera adresser: bara vägsegment, inga `addr:interpolation`-vägar
för dessa gator). De flesta geokodade punkterna hamnar alltså "någonstans
på rätt gata", inte vid exakt byggnad — mindre exakt än OSM-data. Appen
visar därför dessa platser med streckad markörkontur (inte bekräftad
data) och en tydlig ⚠️-notis i popupen ("läget är en ungefärlig
geokodning ... inte en exakt position") plus en direktlänk till att lägga
till platsen i OSM på riktigt — samma "människan bekräftar/åtgärdar"-
princip som resten av projektet.

`src/dataLoad.js` läser filen (valfri — trasig/saknad fil kraschar inte
laddningen) och slår ihop den med `terraces.geojson` i minnet.
Sol/skugga-beräkningen, röstning, sök och "nära mig" fungerar oförändrat
eftersom det är samma featureform. Verifierat live i webbläsaren: 246
streckade markörer renderade, popup-notisen och OSM-länken stämmer,
skuggberäkning fungerar identiskt med en vanlig terrass, inga
konsolfel.

**Kvar (mindre, ospecat):** koppla in i `refresh-data.yml` (månadsvis
ny-geokodning), och stöd för "Dölj i appen" i taggningslistan för de här
platserna.

---

**Det finns ett publikt restaurangregister**, och det är nu verifierat
direkt mot verklig HTML (2026-08-07, en session med nätverksåtkomst — se
anmärkningen om nätverket ovan):
`https://restaurang.malmo.se/AlktWebbforms/Restaurants` — sökbart på namn
och område, **uppdateras varje natt**. Ingen `robots.txt` (404 — inget
crawl-regelverk finns, men fortsatt gott skick att vara skonsam mot en
kommuns server: identifierande User-Agent, fördröjning mellan anrop).

**Fyndet som ändrar hela upplägget: listsidan ensam räcker för
alkoholfrågan.** Ett enda GET-anrop mot listsidan (569 kB, inga
paginerings-signaler hittade — alla 551 tillståndshavare tycks ligga på
en sida) ger en tabell med kolumnerna:

```
Namn | Postadress | Sprit | Vin | Starköl | AJA | ALP | Serveringstider
```

(AJA = Andra jästa alkoholdrycker, ALP = Alkoholdrycksliknande preparat —
alkohollagens fem drycktyper, som kryssmarkeringar per ställe.) Det löser
**hela alkoholtyp-frågan för alla 551 ställen i en enda begäran** — ingen
per-ställe-skrapning krävs för det.

**Vad som ändå kräver en detaljsida** (`/Show/{id}`, löpande id:n — 80,
809, 1268 observerade; ren semantisk Bootstrap-tabell,
`<tr><td>Etikett</td><td>[✓-ikon om det gäller]</td></tr>`, verifierad
mot id 809 "Modomio, Restaurang"):

- **Servering till: Allmänheten vs Slutet sällskap** — korrekthetsgrinden
  vi resonerade fram (se nedan): ett tillstånd som bara gäller slutna
  sällskap (catering/event) ska inte räknas som "ja" för en förbipasserande
  gäst på uteserveringen.
- **Serveringstyp: Uteservering** (en av åtta kryssbara typer, ihop med
  Trafikservering, Pausservering, Roomservice, Minibar, Catering,
  Provsmakning, Kryddning) — en direkt myndighetssignal för
  uteserveringstillstånd, starkare än men inte identisk med OSM:s
  `outdoor_seating`-tagg.
- **Serveringstider uppdelat inomhus/utomhus** (t.ex. "11:00–01:00
  inomhus" vs "11:00–23:00 utomhus"). Listsidan visar tider men utan
  tydlig inomhus/utomhus-etikett; bara detaljsidan är entydig.

**Reviderad budget: 1 anrop (listan) + upp till 551 anrop** (detaljer,
bara om vi vill ha den extra precisionen, och bara för den delmängd som
matchar `terraces.geojson`) — inte "ett par tusen" som ursprungligen
antaget innan HTML:en var sedd.

**Personuppgift att hålla koll på:** detaljsidan visar ägarnamn för
enskilda firmor (t.ex. "Djamel Boudjedien ensk. firma…"). Offentlig
handling, men vi extraherar bara ställe-nivå-fälten appen faktiskt
behöver (namn, adress, tillståndsflaggor, tider) till
`serving-permits.json` — aldrig ägarnamnet.

En begäran om utlämnande av allmän handling skickades ändå till
`tillstandsenheten@malmo.se` 2026-08-07, men är mindre kritisk nu —
listsidans data är redan så pass komplett och strukturerad att en CSV
vore en genväg, inte en förutsättning.

**Så här:** ett steg i fas 3-workflowet:

1. hämtar listsidan (ett anrop) → `data/serving-permits.json` med namn,
   adress, alkoholtyper och rå serveringstider för alla ~551
2. matchar mot `data/terraces.geojson` på normaliserat namn + adress
3. (andra prioritet, valfritt) hämtar detaljsidor för matchade ställen —
   fördröjning mellan anrop, identifierande User-Agent — för
   Allmänheten/Slutet-sällskap-grinden, Uteservering-flaggan och
   inomhus/utomhus-tider
4. **(Beslutat 2026-08-08, ej byggt än)** för register-ställen med
   `Serveringstyp: Uteservering` som INTE matchar något i
   `terraces.geojson` alls: geokoda adressen (Nominatim, samma cache som
   taggningslistan redan använder för dubblettfilialer) och visa dem
   **direkt på kartan** som en egen punkt — inte bara i en
   att-lägga-till-i-OSM-kö. Solberäkningen fungerar utan ändring (den
   skjuter redan bara en stråle från en punkt + närliggande byggnader ur
   `buildings.geojson`, oberoende av om terrassen själv har en
   OSM-geometri). Dessa punkter måste märkas tydligt som
   **OSM-overifierade** (annan ikon/badge i appen, och en rad i
   taggningslistan som uppmanar att lägga till dem i OSM på riktigt) —
   syns i appen omedelbart, men flyttas över till att vara en "riktig"
   OSM-driven terrass så fort någon lägger till dem där. Det här är
   fasens svar på att-göra-punkten "Lägg till saknade ställen i OSM" (t.ex.
   Andy's): de blir synliga i appen direkt istället för att vänta på
   manuell OSM-redigering, men uppmaningen att lägga till dem i OSM
   kvarstår ändå (så att de blir en riktig, kvalitetsgranskad
   community-post i det öppna datasetet, inte bara ett appspecifikt
   specialfall för alltid).

**Utmaningar och hur vi tar oss runt dem:**

| Utmaning | Lösning |
|---|---|
| **Namnmatchning.** Krogar heter sällan exakt samma i OSM som i tillståndsregistret, och kedjor har många filialer. | Matcha på normaliserat namn **plus** adress, och skriv osäkra träffar till en separat granskningslista istället för att gissa. Samma mönster som taggningslistan redan använder. |
| **Tillstånd ≠ uteservering.** Registret säger att stället får servera alkohol, inte att det har uteservering. | `Serveringstyp: Uteservering`-flaggan på detaljsidan täcker det mesta av luckan, men är fortfarande skild från OSM:s `outdoor_seating`. OSM-taggning behövs ändå för ställen registret inte matchar. |
| **Personuppgift på detaljsidan.** Ägarnamn för enskilda firmor. | Extrahera bara ställe-nivå-fält (namn/adress/flaggor/tider) till `serving-permits.json` — aldrig ägarnamnet. |
| **Registret ändras** (nya/upphörda tillstånd). | Månadsvis körning (samma takt som fas 3) håller det i synk utan att någon manuellt beter av en lista. |
| **Ovanpå OSM-datat: ställen som inte finns i OSM alls, men HAR uteserveringstillstånd** (steg 4 ovan). Appen har hittills bara visat OSM-data, så det här är ett nytt datalager, inte bara en ny källa till befintliga fält. | Geokodning kan träffa fel adress eller fel filial av en kedja — samma osäkerhet som taggningslistans befintliga geokodning, med samma motåtgärd (osäkra träffar till granskning, inte auto-publicerade). Tydlig OSM-overifierad-märkning i UI så det aldrig ser ut som verifierad OSM-data. |

### Fas 6 — Senare, om vi vill längre

- **Träd.** Halva Malmös terrasser står under en lönn i juli, och appen
  vet inget om det. LiDAR fångar trädkronor; `natural=tree` i OSM är glest.
- **Terrass som yta, inte punkt.** Idag skjuts en enda stråle från en
  koordinat — halva uteserveringen kan ligga i sol.
- **Lantmäteriet Laserdata NH** (CC0) för verkliga taknockar. Mest
  exakt, men punkttätheten är 0,5–1 pkt/m² och byggnader är oklassade i
  punktmolnet, så det är ett helgprojekt.

Ej aktuellt: Lantmäteriets Ythöjdmodell (avgiftsbelagd via Geotorget) och
Googles Solar API (betalt per anrop) — båda faller på avgiftsfrihetskravet.

## Status och ordning

1. ✅ **Fas 1** — klar, verifierad mot riktig `computeShading()`
2. ✅ **Fas 2** — klar, slår igenom vid nästa `fetch-data`
3. ✅ **Nätverksbeslut** — GitHub Actions (väg D) vald
4. ✅ **Fas 3** — byggd, mergad till `main` OCH verifierad 2026-08-08 med
   tre riktiga `workflow_dispatch`-körningar (PR #1 och PR #2 mergade,
   plus en tredje körning direkt mot `main` efteråt). Första körningen
   grön direkt, avslöjade en verklig −9,4 % byggnadslucka som grinden
   fångade; fixad och verifierad grön i körning 2 (byggnader nu 25 099,
   fler än ursprungliga 23 251). Körning 3 (mot `main`) bekräftade även
   "inget att committa"-grenen. Helt klar — inget kvarstår.
5. ⛔ **Fas 4 — valideringsexperimentet klart, NO-GO** (2026-08-08): den
   ursprungliga MAE-siffran (1,09 m) var cirkulär (57,7 % av matchningarna
   ekade bara OSM:s eget värde). Omkört per height_source: på den enda
   oberoende testbara delmängden (Microsoft ML Buildings, n=2132) är
   Overtures MAE 2,56 m mot nuvarande modells 1,89 m — nuvarande modell
   vinner. Täckningen mot den produktionsrelevanta populationen (byggnader
   utan känd höjd) är dessutom bara 51,4 %. Beslut: stängd, ingen
   produktionsspec skrivs (se `scripts/overture-height-experiment.py` och
   avsnittet ovan för alla siffror)
6. ✅ **Fas 5 del A** — helt klar 2026-08-08: `scripts/fetch-serving-
   permits.js` hämtar och matchar registret mot `data/terraces.geojson`,
   175 tidigare `alcohol=unknown`-ställen löses till "ja", hintet syns nu
   live i taggningslistan (se avsnittet ovan för alla siffror). Byggd
   direkt (inte via subagent-driven-development — medvetet lean given
   begränsad sessionsbudget) och verifierad mot riktig data OCH i
   webbläsaren, inte bara lokala fixturer.
7. ✅ **Fas 5 del B** — klar 2026-08-11: 246/257 registerställen utan
   OSM-motsvarighet geokodade och visas på kartan, streckade och tydligt
   märkta OSM-overifierade, med direktlänk till att lägga till dem i OSM.
   Verifierad live i webbläsaren. Se avsnittet ovan för detaljer och
   kvarstående småsaker (Actions-koppling, "Dölj i appen"-stöd).

### Nästa steg

1. **Fas 3**: klar — mergad till `main`, tre gröna `workflow_dispatch`-
   körningar, inget kvarstår.
2. **Fas 4**: avslutad, NO-GO (se avsnittet ovan). Overture slår inte
   nuvarande modell på den population som räknas (byggnader utan känd
   höjd: Overture MAE 2,56 m mot nuvarande modells 1,89 m på samma
   byggnader), och täcker bara 51,4 % av den populationen. Ingen
   produktionsspec skrivs. Inget kvarstår här.
3. **Fas 5 parallellt** — oberoende av de andra två, och redan avsevärt
   mindre jobb än ursprungligen trott (se fas 5-avsnittet).

#### Vad Fredrik behöver göra för fas 5

Ingenting längre — löst. En session med nätverksåtkomst (se anmärkningen
om nätverket ovan) hämtade själv listsidan, en detaljsida (id 809) och
`robots.txt` 2026-08-07 och analyserade strukturen direkt (resultatet
står ovan). Exempelfilerna ligger i den sessionens scratchpad, inte
committade än — detaljsidan innehåller ett ägarnamn (personuppgift, se
ovan), så Fredrik bör godkänna innan ett exempel eventuellt läggs i repot.
Listsidans exempel innehåller ingen personuppgift och kan committas fritt
om det är till nytta för nästa session som bygger parsern.
