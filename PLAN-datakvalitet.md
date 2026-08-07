# Plan: bättre datakvalitet för skuggor, platser och sol

Status: **förslag, inväntar godkännande**. Skapad 2026-08-07.

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

**Åtgärd innan bygget godkänns som klart:** kör om valideringen viktad mot
byggnader som ligger inom skuggavstånd (500 m) från en faktisk terrass.
Det är den siffra som faktiskt betyder något för appen. Om vinsten där är
försumbar ska fas 1 omvärderas, inte skeppas på de här talen.

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

### Fas 1 — Bättre höjdgissning (ingen nätverksåtkomst krävs)

Ersätt den platta 15-metersgissningen i `src/shadow.js` med:

1. `height` → 2. `building:levels` × 3 → 3. **per-typ-median** (från
tabellen ovan) → 4. **grannskapsmedian** för generiska typer → 5. 15 m.

Grannskapsmedianen återanvänder rutnätsindexet som redan finns i
`shadow.js`, och beräknas **en gång vid laddning**, inte per omberäkning —
prestandabudgeten i CLAUDE.md får inte regressa.

Kan byggas och verifieras helt offline mot befintlig data. **Störst effekt
per nedlagd timme.**

### Fas 2 — Behåll fler höjdtaggar vid hämtning (liten, nätverkslös)

`BUILDING_PROPS_TO_KEEP` i `scripts/fetch-data.js` slänger idag allt utom
fem taggar. Lägg till `roof:levels`, `roof:height`, `roof:shape`,
`est_height`, `min_height`, `building:min_level`. Gratis extra signal vid
nästa hämtning, försumbar filstorlek.

### Fas 3 — Pipeline utan Overpass

Byt tiled Overpass mot **Geofabrik-extrakt + osmium**, kört i GitHub
Actions (väg D). Tar bort tidsgränser, hastighetsbegränsning och
byggnadsluckor strukturellt. Löser den befintliga att-göra-punkten "fyll
byggnadsluckor" permanent.

### Fas 4 — Overture som höjdkälla

Konflatera in **Overture Maps buildings** (OSM + Microsoft/Google ML +
myndighetsdata, höjd som förstklassigt attribut, gratis) ovanpå
OSM-höjderna. Detta är den riktiga fixen på huvudfelkällan — fas 1 är en
uppskattning, detta är mätdata. Kräver nätverk (väg B eller D).

### Fas 5 — Serveringstillstånd från Malmö stad

Begär ut listan över stadigvarande serveringstillstånd (offentlig
handling) från `tillstandsenheten@malmo.se`. Kan ersätta merparten av de
877 "okänd alkohol" med myndighetsdata istället för handpåläggning.
Engångsfil, inget API. Utkast till mejl skickas separat.

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

## Föreslagen ordning

1. **Fas 1** — störst effekt, kan göras direkt, noll beroenden
2. **Fas 2** — trivial, åker med på samma gång
3. **Beslut om väg B eller D** för nätverket
4. **Fas 3** — pipelinen, förutsätter beslutet ovan
5. **Fas 4** — Overture, förutsätter pipelinen
6. **Fas 5** — mejlet kan skickas parallellt när som helst
