# Plan: bättre datakvalitet för skuggor, platser och sol

Status: **fas 1–2 byggda och verifierade. Fas 3–4 planerade i detalj,
inväntar OK innan de byggs.** Skapad och påbörjad 2026-08-07.

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

### ⬜ Fas 3 — Pipeline utan Overpass (detaljerad plan, inväntar OK)

Byt tiled Overpass mot **Geofabrik-extrakt + osmium**, kört i GitHub
Actions. Tar bort tidsgränser, hastighetsbegränsning och byggnadsluckor
strukturellt, och löser att-göra-punkten "fyll byggnadsluckor" permanent.

**Så här:** ett workflow (`.github/workflows/refresh-data.yml`) som körs på
`workflow_dispatch` + schemalagt, och som:

1. `apt-get install osmium-tool` (finns i Ubuntu-runners repo)
2. hämtar Geofabrik-extraktet för Sverige
3. `osmium extract` till Malmö-bbox:en, sedan `osmium tags-filter` för
   dels terrasstaggarna, dels `building`
4. kör om geometriförenkling/buffring precis som `fetch-data.js` gör idag
5. kör `build-tagging-list`
6. committar bara om datan faktiskt ändrats

`scripts/fetch-data.js` behålls som manuellt reservalternativ, men är inte
längre huvudvägen.

#### Utmaningar och hur vi tar oss runt dem

| Utmaning | Lösning |
|---|---|
| **Repo-uppsvällning.** `buildings.geojson` är 8,9 MB och skrivs som *en enda rad* JSON. Git kan inte delta-komprimera det, så varje körning lägger en helt ny blob. Veckovis skulle `.git` (nu 6 MB) växa med hundratals MB per år. | Skriv **en feature per rad** och sortera features deterministiskt på OSM-id. Då blir diffen radbaserad och git delta-komprimerar normalt. Kör dessutom **månadsvis**, inte veckovis, och committa bara vid faktisk ändring. |
| **Tyst sönderkörning.** Om ett filter blir fel kan workflowet committa en tom eller halv fil och slå sönder den live-appen utan att någon märker det. | **Grindar innan commit:** avbryt om antalet terrasser eller byggnader avviker mer än ±20 % från det som redan ligger i repot. Hellre ett rött workflow än trasig data i produktion. |
| **Extraktets storlek.** Sverige-extraktet är hundratals MB att ladda ner varje körning. | Acceptabelt i Actions (bra bandbredd, ~1–2 min). Om det blir ett problem: byt till ett mindre regionalt extrakt eller BBBike:s skräddarsydda bbox-extrakt. |
| **Deploy-loop.** En commit från workflowet triggar Pages-bygget — men skulle den också trigga workflowet självt blir det en oändlig loop. | Sker inte automatiskt: commits gjorda med `GITHUB_TOKEN` triggar inte nya workflow-körningar. Behöver bara `permissions: contents: write`. |
| **Jag kan inte testa workflowet härifrån.** Proxyn blockerar allt, så jag kan inte köra pipelinen lokalt först. | Jag skriver workflowet, det körs på GitHub, och jag läser körloggarna via GitHub-verktygen och itererar därifrån. Räkna med 2–3 rundor innan första gröna körningen. |

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

**Det finns ett publikt restaurangregister.** Malmö stad publicerar
gällande serveringstillstånd på
`https://restaurang.malmo.se/AlktWebbforms/Restaurants` — sökbart på namn
och område, visar serveringstider och vad varje ställe får servera, och
**uppdateras varje natt**. Detaljsidor ligger på
`/AlktWebbforms/Restaurants/Show/{id}` med löpande id:n (80, 809 och 1268
observerade), alltså uppräkningsbara.

Det är bättre än en engångsfil: datan hålls aktuell av kommunen, så en
schemalagd körning fångar nyöppnade ställen automatiskt. Kan ersätta
merparten av de 877 "okänd alkohol" med myndighetsdata istället för
handpåläggning — och till skillnad från OSM-taggningen behöver ingen
människa beta av en lista.

En begäran om utlämnande av allmän handling skickades ändå till
`tillstandsenheten@malmo.se` 2026-08-07. **Får vi en CSV därifrån är den
att föredra** — renare att tolka och skonsammare mot deras server än att
hämta sida för sida. Registret är planen om svaret dröjer eller uteblir.

**Så här:** ett steg i fas 3-workflowet (samma nätverksskäl som allt
annat — registret är blockerat härifrån) som:

1. hämtar listsidan och plockar ut alla `Show/{id}`-länkar
2. hämtar varje detaljsida med **fördröjning mellan anropen** och en
   identifierande User-Agent — det är en kommuns server, inte ett API
3. skriver `data/serving-permits.json` med namn, adress och tillstånd
4. matchar mot `data/terraces.geojson` på namn + adress

**Utmaningar och hur vi tar oss runt dem:**

| Utmaning | Lösning |
|---|---|
| **Jag har inte sett HTML:en.** Proxyn blockerar registret, så jag kan inte skriva en parser mot verklig markup utan att gissa selektorer. | Fredrik kör en `curl` lokalt och committar en exempelsida; jag skriver parsern mot den. Se nästa steg nedan. |
| **Belastning på kommunens server.** Ett par tusen detaljsidor. | Fördröjning mellan anrop, kör **månadsvis** (samma takt som fas 3), respektera `robots.txt`, och cacha så bara nya id:n hämtas. |
| **Namnmatchning.** Krogar heter sällan exakt samma i OSM som i tillståndsregistret, och kedjor har många filialer. | Matcha på normaliserat namn **plus** adress, och skriv osäkra träffar till en separat granskningslista istället för att gissa. Samma mönster som taggningslistan redan använder. |
| **Tillstånd ≠ uteservering.** Registret säger att stället får servera alkohol, inte att det har uteservering. | Det löser bara alkoholfrågan. Uteservering förblir OSM-taggning — men det är ändå 877 av 938 okända som blir kända. |

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
4. ⬜ **Fas 3** — pipelinen som Actions-workflow
5. ⬜ **Fas 4** — Overture, förutsätter fas 3
6. 🕓 **Fas 5** — publikt register hittat; mejl skickat 2026-08-07 som
   renare alternativ, inväntar svar

### Nästa steg — inväntar OK

Fas 3 och 4 är planerade i detalj ovan, med utmaningar och motåtgärder.
Ingenting av dem är byggt. Rekommenderad ordning:

1. **Fas 3 först**, och som en egen PR. Den rör pipelinen, inte appen — om
   något går fel ska det inte blandas ihop med skuggkoden.
2. **Fas 4 därefter**, hängd på samma workflow, som en andra PR.
3. **Fas 5 parallellt** — oberoende av de andra två.

Räkna med att fas 3 behöver 2–3 iterationer innan workflowet blir grönt,
eftersom det inte går att provköra härifrån.

#### Vad Fredrik behöver göra för fas 5

Registret är blockerat från sessionsmiljön, så jag kan inte se HTML:en och
skulle behöva gissa selektorer. Kör detta lokalt och committa resultatet,
så skriver jag parsern mot verklig markup istället:

```
curl -sS "https://restaurang.malmo.se/AlktWebbforms/Restaurants" \
  -o data/sample-register-list.html
curl -sS "https://restaurang.malmo.se/AlktWebbforms/Restaurants/Show/809" \
  -o data/sample-register-detalj.html
curl -sS "https://restaurang.malmo.se/robots.txt" -o data/sample-robots.txt
```

Listsidan kan vara paginerad eller ladda via POST — syns i HTML:en. Är den
det behöver jag se sida 2 också.
