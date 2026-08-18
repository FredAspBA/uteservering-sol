# Design: Kart-/byggnadsvy-växling

**Datum:** 2026-08-18
**Status:** Godkänd av Fredrik i chatt, redo för implementationsplan

## Problem

MALMÖ URBAN GRID-omdesignen (2026-08-16) tog bort Leaflet-kartan helt till
förmån för `isoHero.js`: en isometrisk, lokal 200m-scen kring det
*fokuserade* resultatet. Det löser "varför är just det här stället soligt/
skuggigt", men löser inte huvudsyftet med appen — **hitta ett ställe med
sol och/eller alkohol** — lika bra som en karta gjorde:

- **Ingen geografisk överblick.** Kortlistan visar inte var ställena ligger
  relativt varandra; svårt att se "vilket kluster/område har sol nu" på en
  snabb blick.
- **Svårt att navigera till platsen.** Efter man valt ett ställe saknas
  gatunamn, en väg dit, och vetskap om egen position/avstånd i appen.

`isoHero.js`s egen kommentar säger uttryckligen att den är "not a pannable
replacement for the results list" — den var aldrig tänkt att lösa det här.

## Beslut: dela upp i två oberoende delar

De två behoven (överblick vs. navigering) har helt olika databehov, och att
separera dem tar bort den svåra delen:

- **Överblick** → ny topp-vy-karta, byggd på byggnadsdata som redan finns
  i pipelinen (`data/buildings.geojson`). Ingen väggeometri behövs.
- **Navigering** → gatunamn som text (redan i data där OSM har `addr:street`)
  + länk till Google Maps + avstånd (redan beräknat av
  `findNearestMatching`). Ingen kartmotor inblandad.

**Varför inte en riktig gatukarta?** `fetch-data-geofabrik.js` extraherar
i dag bara `w/building`/`r/building` — inget `highway=*`. En renderad
gatukarta hade krävt en ny osmium tags-filter, en ny geojson, och ett nytt
steg i `.github/workflows/refresh-data.yml` — en permanent utökning av den
månatliga pipelinen, i spänning med PRODUCT.md:s princip "Gratis och
underhållsfritt i drift". Fredrik bekräftade att uppdelningen ovan räcker
(2026-08-18, chatt) — ingen väg-data läggs till.

## 1. Arkitektur

Nytt modul `src/mapView.js`, syskon till `src/isoHero.js` — den senare
lämnas helt orörd (fortsätter vara den lokala skuggscenen för fokuserat
kort). `mapView.js` renderar uppifrån (rakt, inte isometriskt):

- Byggnadskonturer: tunna linjer i grid-estetiken (samma
  `--color-surface-border`-ton som resten av systemet), ingen extrudering.
- Terrasser: punkter färgade efter status, samma `STATUS_COLORS`-konstant
  som redan används i kortlistan och `isoHero.js` — sol/skugga/mörkt/
  osäker ska se likadana ut oavsett vy.
- Pan/zoom inom hero-boxen (samma yta `isoHero.js` upptar i dag, inte
  helskärm — se avsnitt "Växlingens omfattning").

Ingen ny geojson, inget nytt pipeline-steg. Modulet läser samma
`buildings`/`entries`/`filteredSorted`-modultillstånd som `app.js` redan
håller (se `CLAUDE.md`s karta över `app.js`) — samma data som
`renderVisibleList()` och `isoHero.js` konsumerar, bara en annan
rendering av den.

## 2. Växling och läges-minne

Två textknappar ("Karta" / "Byggnader") ovanför hero-ytan. Ingen ny
emoji-ikon — DESIGN.md dokumenterar redan emoji-ikoner som ett känt,
oåtgärdat gap och nya UI-element ska inte utöka det gapet.

**Omfattning:** knappen byter *bara* innehållet i hero-boxen (dagens
`isoHero.js`-yta). Resultatlistan under är identisk i båda lägena — samma
sortering, filter, sol-status, kort-expansion. Ingen dubblering av
listlogik.

**Minne:** valt läge sparas i `localStorage` under samma mönster som
`src/favorites.js`/`src/votes.js` (enkel nyckel, ingen Firebase). Läge
läses vid sidladdning och avgör vilken vy som visas initialt — inget
läge är "standard" i koden, det är alltid "senast valda, eller Byggnader
om inget sparat än".

## 3. Navigeringshjälp (oberoende av växlingen)

I kortets detaljvy (`cardDetailHtml()` i `app.js`), tre tillägg:

- **Gatunamn** — `terrace.feature.properties["addr:street"]`, taggen
  finns direkt på terrassens egna properties (verifierat mot
  `data/terraces.geojson`: 464 av 939 terrasser, ~49 %, har den redan i
  dag — samma källa `build-tagging-list.js` läser). Saknas taggen: raden
  utelämnas tyst, ingen platshållartext.
- **"Öppna i kartor"-länk** — `https://www.google.com/maps/search/?api=1&query=<lat>,<lon>`
  byggd från terrassens egna koordinater. Extern länk, `target="_blank"`,
  ingen egen kartmotor.
- **Avstånd** — redan beräknat av `findNearestMatching`/`haversineMeters`
  för "hitta närmaste"-flödet; visas nu även som en rad i det expanderade
  kortet när en position finns (se punkt 4), inte bara i statusmeddelandet.

Detta är en fristående ändring — skickas oberoende av kartvyn, ingen
gemensam kod med `mapView.js` utöver att båda läser `entries`.

## 4. Position i kartläget

Knapp ("Visa mig") i `mapView.js`s kontrollrad. Hämtar position **en
gång per tryck** via `navigator.geolocation.getCurrentPosition` — samma
engångsmönster och samma dokumenterade löfte som befintlig
`findNearestMatching()` i `app.js` ("aldrig lagrad, loggad eller
skickad"). Ingen `watchPosition`, ingen bakgrundsspårning. Man kan trycka
knappen igen (t.ex. efter att ha gått en bit) för att uppdatera pricken —
positionen hålls bara i modulets lokala state tills nästa tryck eller
sidladdning, aldrig i `localStorage`.

Prickens färg: en egen, ny CSS-token (inte guld — guld är reserverat för
"solen själv, primärknappen, fokuserat kort" per "The One Gold Rule" i
DESIGN.md). Läggs till DESIGN.md:s färgtabell som del av implementationen.

## 5. Prestanda

Täckningsområdet är ~940 terrasser / ~25 000 byggnader — för mycket för
att rita allt varje frame när kartan pannas/zoomas. `mapView.js` gör
viewport-culling: bara byggnader/terrasser vars bbox skär den aktuella
synliga rutan ritas, med hjälp av samma spatiala rutnätsindex
`shadow.js` redan bygger för skuggberäkning (ingen ny indexstruktur att
underhålla parallellt).

Appen har sedan tidigare en känd kall-laddningsfrysning (~8.6s,
Web Worker-spiken från 2026-08-15 fortfarande öppen, se CLAUDE.md). Det
nya kartläget får inte förvärra den. Om render-loopen blir tung vid
pan/zoom används samma chunk/yield-till-webbläsaren-mönster som
`recompute()` redan använder, snarare än att blockera huvudtråden i ett
svep.

## Testning

- Enhetstest (om testramverk finns för `app.js`-moduler; annars manuell
  E2E-verifiering i browser, samma nivå som redesignens egen
  verifiering 2026-08-16):
  - Växling karta↔byggnader byter hero-innehåll, listan under orörd.
  - Läges-minne överlever sidladdning (`localStorage`).
  - Filter/sök påverkar synliga punkter på kartan precis som kortlistan.
  - Klick på en kart-punkt fokuserar samma kort som klick i listan gör.
  - "Visa mig" ritar en prick, ny knapptryckning flyttar den, ingen
    kontinuerlig uppdatering utan tryck.
  - Gatunamn/Maps-länk/avstånd syns korrekt i expanderat kort, gatunamn
    utelämnas tyst när taggen saknas.
  - 375px mobilbredd (appens primära bredd per PRODUCT.md).
- Visuell verifiering i Browser-panelen (screenshot) — redesignen
  2026-08-16 kunde inte göra detta samma session; gör det här.

## Explicit uteslutet (YAGNI)

- Ingen väggeometri/gatukarta-rendering (se "Beslut" ovan).
- Ingen kontinuerlig positionsspårning (`watchPosition`).
- Ingen dubblering av resultatlistan i kartläget — en lista, två
  hero-vyer ovanför den.
- `taggning.html` berörs inte (samma undantag som redesignen 2026-08-16).
