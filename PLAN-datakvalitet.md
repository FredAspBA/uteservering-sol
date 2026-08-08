# Plan: bättre datakvalitet för skuggor, platser och sol

Status: **fas 1–3 byggda och verifierade** (fas 3 mot två riktiga
`workflow_dispatch`-körningar, se PR #2). **Fas 4 planerad i detalj,
redo att börjas.** Skapad 2026-08-07, fas 3 klar 2026-08-08.

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

**Byggt, på en egen branch (`phase3-geofabrik-osmium-pipeline`, ovanpå
denna), som en egen PR enligt rekommendationen nedan:**

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
2026-08-08). De kördes sedan på riktigt, två gånger, via `workflow_dispatch`
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

### ⬜ Fas 4 — Overture som höjdkälla (detaljerad plan, inväntar OK)

Hämta **höjder** från Overture Maps buildings (OSM + Microsoft/Google ML +
myndighetsdata, gratis) och lägg dem ovanpå OSM:s. Fas 1 är kvalificerade
uppskattningar; detta är mätdata, och angriper huvudfelkällan på riktigt.

**Så här:** utöka fas 3-workflowet med ett DuckDB-steg som läser Overtures
publika parquet direkt med bbox-filter (deras schema har bbox-kolumner
gjorda för predicate pushdown, så bara några hundra MB läses trots att
datamängden är global). Resultatet blir en `data/heights-overture.json`
som `shadow.js` konsulterar före typ-/grannskapsgissningen.

#### Utmaningar och hur vi tar oss runt dem

| Utmaning | Lösning |
|---|---|
| **Konflatering är svårt.** Att matcha Overture-byggnader mot OSM-byggnader geometriskt är en klassisk felkälla — fel matchning ger fel höjd på fel hus. | **Rör inte geometrin.** Behåll OSM:s fotavtryck (redan buffrade och förenklade, och prestandaintrimmade) och hämta *bara höjd*. Matcha i första hand på OSM-id, som Overture bär med sig i sitt `sources`-fält; bara i andra hand på centroid inom några meter. |
| **Overture-höjder är delvis själva ML-gissningar.** Vi kan råka byta en bra gissning mot en sämre. | Mät det, precis som i fas 1: kör `scripts/impact-experiment.py` före och efter, och behåll Overture-höjden bara om den slår nuvarande modell. Prioritetsordning: OSM-taggad höjd → Overture → typmedian → grannskapsmedian → 15 m. |
| **Ännu en stor fil i repot.** | Skicka bara `{osm_id: höjd}`, inte geometri. Det blir några hundra kB, inte megabyte. |

### 🕓 Fas 5 — Serveringstillstånd från Malmö stad

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

**Utmaningar och hur vi tar oss runt dem:**

| Utmaning | Lösning |
|---|---|
| **Namnmatchning.** Krogar heter sällan exakt samma i OSM som i tillståndsregistret, och kedjor har många filialer. | Matcha på normaliserat namn **plus** adress, och skriv osäkra träffar till en separat granskningslista istället för att gissa. Samma mönster som taggningslistan redan använder. |
| **Tillstånd ≠ uteservering.** Registret säger att stället får servera alkohol, inte att det har uteservering. | `Serveringstyp: Uteservering`-flaggan på detaljsidan täcker det mesta av luckan, men är fortfarande skild från OSM:s `outdoor_seating`. OSM-taggning behövs ändå för ställen registret inte matchar. |
| **Personuppgift på detaljsidan.** Ägarnamn för enskilda firmor. | Extrahera bara ställe-nivå-fält (namn/adress/flaggor/tider) till `serving-permits.json` — aldrig ägarnamnet. |
| **Registret ändras** (nya/upphörda tillstånd). | Månadsvis körning (samma takt som fas 3) håller det i synk utan att någon manuellt beter av en lista. |

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
4. ✅ **Fas 3** — byggd OCH verifierad 2026-08-08 med två riktiga
   `workflow_dispatch`-körningar (PR #2, `phase3-geofabrik-osmium-pipeline`
   → `sol-uteservering-webapp-ke5dtt`). Första körningen grön direkt,
   avslöjade en verklig −9,4 % byggnadslucka som grinden fångade; fixad
   och verifierad grön i körning 2 (byggnader nu 25 099, fler än
   ursprungliga 23 251). Väntar bara på PR-granskning/merge.
5. ⬜ **Fas 4** — Overture, kan börjas nu när fas 3 är grön
6. 🕓 **Fas 5** — publikt register hittat OCH verifierat mot verklig HTML
   2026-08-07; listsidan ensam löser alkoholtyp-frågan i ett anrop,
   detaljsidor behövs bara för allmänhet/uteservering/tider-precisionen;
   mejl skickat 2026-08-07 som genväg, mindre kritiskt nu

### Nästa steg

1. **Fas 3**: klar för granskning/merge — [PR #2](https://github.com/FredAspBA/uteservering-sol/pull/2).
   Ingen ytterligare iteration krävs, båda testkörningarna är gröna.
2. **Fas 4 därefter**, hängd på samma workflow, som en andra PR.
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
