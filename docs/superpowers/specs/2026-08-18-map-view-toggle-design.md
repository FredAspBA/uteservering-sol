# Design: Kart-/byggnadsvy-växling

**Datum:** 2026-08-18 (reviderad 2026-08-19 efter `/impeccable critique`)
**Status:** Godkänd av Fredrik i chatt, redo för implementationsplan.
Reviderad efter en `/impeccable critique`-granskning (22/40) som hittade
en icke-implementerbar arkitekturformulering (avsnitt 1) och flera
obehandlade UX-frågor (standardvy, tryckytor, felhantering) — alla
korrigerade nedan, markerade "post-critique 2026-08-18". Grundbesluten
(uppdelning karta/navigering, inget väggeometri) står oförändrade.

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
- Terrasser: punkter färgade efter status. **Korrigering (post-critique
  2026-08-18):** den tidigare formuleringen "samma `STATUS_COLORS`-konstant
  som redan används i kortlistan och `isoHero.js`" var fel på två sätt —
  kortlistan använder inte `STATUS_COLORS` alls (den färgar status via
  statiska CSS-klasser, `.card-status-label.sun/.shade/.night/.anomaly`),
  och `isoHero.js` har sin egen hårdkodade `"#d4af37"`-fallback istället
  för att slå upp konstanten. `mapView.js` ska istället importera
  `STATUS_COLORS` från `app.js`s modul (kräver att den exporteras — se
  nedan) och slå upp den direkt, likadant som `isoHero.render()` tar emot
  den som parameter idag — så att alla tre ställen (kortlista, isoHero,
  mapView) faktiskt delar en sanning istället för att två av tre bara
  påstår det.
- Pan/zoom inom hero-boxen (samma yta `isoHero.js` upptar i dag, inte
  helskärm — se avsnitt 2, "Standardvy").

**Datamodell — korrigerad (post-critique 2026-08-18):** den ursprungliga
formuleringen ("modulet läser samma `buildings`/`entries`/
`filteredSorted`-modultillstånd som `app.js` redan håller") är fel:
`app.js` har inga `export`-satser, `buildings`/`entries`/`filteredSorted`
är privata `let`-bindningar, osynliga för ett syskonmodul. Rätt mönster
är detsamma som `isoHero.js` redan använder — en factory som `app.js`
anropar in i, inte en modul som läser `app.js`s state:

```js
// src/mapView.js
export function createMapView(canvas) {
  let scene = null; // { buildings, terraces, focusedTerraceId }
  function setData({ buildings, entries, focusedTerraceId }) { ... }
  function render({ statusColorFor }) { ... } // ritar aktuell pan/zoom
  function panTo(terraceId) { ... }           // t.ex. vid kortklick
  return { setData, render, panTo, hasScene: () => scene !== null };
}
```

`app.js` importerar `createMapView` precis som den redan importerar
`createIsoHero`, anropar `mapView.setData({ buildings, entries:
filteredSorted, focusedTerraceId })` varje gång `recompute()` eller
filter/sök ändrar `filteredSorted` (samma ställen som redan anropar
`renderVisibleList()`), och `mapView.render(...)` vid varje tidslinje-tick
— data skickas in som parametrar, den läser aldrig `app.js`s interna
state direkt. Detta kräver att `STATUS_COLORS` (redan beräknad i `app.js`,
se ovan) exporteras från `app.js`, vilket är den enda nya export som
behövs där.

Ingen ny geojson, inget nytt pipeline-steg.

## 2. Växling och läges-minne

Två textknappar ("Karta" / "Byggnader") ovanför hero-ytan, minst
44×44px tryckyta vardera (se "Tryckytor" under avsnitt 6). Ingen ny
emoji-ikon — DESIGN.md dokumenterar redan emoji-ikoner som ett känt,
oåtgärdat gap och nya UI-element ska inte utöka det gapet.

**Omfattning:** knappen byter *bara* innehållet i hero-boxen (dagens
`isoHero.js`-yta). Resultatlistan under är identisk i båda lägena — samma
sortering, filter, sol-status, kort-expansion. Ingen dubblering av
listlogik.

**Standardvy (korrigering, post-critique 2026-08-18):** den ursprungliga
specen sa inget om vilket utsnitt kartan visar först, vilket underminerade
avsnitt 5:s eget prestandaresonemang (culling hjälper bara om
startutsnittet är mindre än hela datamängden). Beslut: kartan öppnas
centrerad på samma terrass `isoHero.js` senast hade i fokus (eller,
saknas fokus, kortlistans första synliga träff), zoomad till ett
"grannskaps"-utsnitt (~1 km radie) — inte hela täckningsområdet. Det
betyder att hero-boxens befintliga 280px/220px-yta *inte* behöver bli
större: ett grannskap på ~1 km innehåller en hanterbar mängd terrasser,
jämförbar med hur många byggnader `isoHero.js` redan visar i sin lokala
scen. Att zooma ut till hela Malmö är en användarhandling (samma
pan/zoom-gester som annars), inte startläget. Detta löser samtidigt
"för mycket att rita första framen"-problemet i avsnitt 5, eftersom
viewport-culling faktiskt gör nytta redan vid första render.

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

Knapp ("Visa mig") i `mapView.js`s kontrollrad, minst 44×44px tryckyta
(se "Tryckytor" under avsnitt 6). Hämtar position **en gång per tryck**
via `navigator.geolocation.getCurrentPosition` — samma engångsmönster och
samma dokumenterade löfte som befintlig `findNearestMatching()` i
`app.js` ("aldrig lagrad, loggad eller skickad"). Ingen `watchPosition`,
ingen bakgrundsspårning. Man kan trycka knappen igen (t.ex. efter att ha
gått en bit) för att uppdatera pricken — positionen hålls bara i
modulets lokala state tills nästa tryck eller sidladdning, aldrig i
`localStorage`.

**Status/fel-hantering (tillägg, post-critique 2026-08-18):** den
ursprungliga specen beskrev bara den lyckade vägen. `mapView.js` får en
egen statusrad i sin kontrollrad (motsvarande `#search-status` i
huvudappen, men lokal för kartan) som återanvänder exakt samma
meddelandemönster som `findNearestMatching()` redan har i `app.js`:

- Under hämtning: "Hämtar din plats…"
- `err.code === err.PERMISSION_DENIED`: "Platsdelning nekades — kan
  inte visa din position."
- Annat fel/timeout: "Kunde inte hämta din plats just nu."

Knappen inaktiveras (`disabled`) medan en förfrågan pågår, så att
upprepade snabba tryck inte staplar flera samtidiga
`getCurrentPosition`-anrop — samma skydd som avsnitt 5:s prestandaarbete
redan bryr sig om, fast här ett UI-tillstånd snarare än en renderingsfråga.

Prickens färg: en egen, ny CSS-token (inte guld — guld är reserverat för
"solen själv, primärknappen, fokuserat kort" per "The One Gold Rule" i
DESIGN.md). Läggs till DESIGN.md:s färgtabell som del av implementationen.

## 5. Prestanda

Täckningsområdet är ~940 terrasser / ~25 000 byggnader — för mycket för
att rita allt varje frame när kartan pannas/zoomas. Tack vare avsnitt 2:s
"Standardvy"-beslut (öppnar zoomad till ett grannskap, inte hela
täckningen) gör culling nytta redan från första render, inte bara vid
inzoomning.

**Korrigering (post-critique 2026-08-18):** den ursprungliga
formuleringen ("samma spatiala rutnätsindex `shadow.js` redan bygger …
ingen ny indexstruktur att underhålla parallellt") stämde inte helt.
`shadow.js`s `buildGrid()`/`queryNearby()` är privata idag och byggs
bara för byggnadslistan — inget i koden rutnätsindexerar terrasser.
Det som faktiskt stämmer, och det som ska göras: `buildGrid(list)` och
`queryNearby(index, bbox)` är redan generiska (de kräver bara att varje
listobjekt har en `.bbox`), så de kan exporteras från `shadow.js` och
återanvändas rakt av — men `mapView.js` bygger sitt *eget* andra
grid-index för terrasser genom att anropa samma exporterade `buildGrid()`
på en egen lista med `{ terrace, bbox }`-objekt. Det är alltså inte "noll
nytt arbete": `shadow.js` får två nya exports (`buildGrid`, `queryNearby`)
och `mapView.js` håller ett andra, litet grid-index vid sidan av
byggnadsindexet — men det är återanvänd algoritm/kod, inte en
parallell implementation att underhålla.

Appen har sedan tidigare en känd kall-laddningsfrysning (~8.6s,
Web Worker-spiken från 2026-08-15 fortfarande öppen, se CLAUDE.md). Det
nya kartläget får inte förvärra den. Om render-loopen blir tung vid
pan/zoom används samma chunk/yield-till-webbläsaren-mönster som
`recompute()` redan använder, snarare än att blockera huvudtråden i ett
svep.

## 6. Tryckytor

**Tillägg (post-critique 2026-08-18).** PRODUCT.md:s
Accessibility & Inclusion-avsnitt flaggade 44px WCAG-tryckytor som en
öppen, obekräftad fråga ("behandla som öppen fråga tills bekräftad").
Den frågan stängs härmed för den här funktionen: alla nya interaktiva
kontroller som den här specen inför — "Karta"/"Byggnader"-knapparna och
"Visa mig" — ska ha minst 44×44px tryckyta, samma mått som
`.card-summary` redan använder i kortlistan. PRODUCT.md uppdateras som
en del av den här implementationen för att spegla beslutet (se separat
ändring i `PRODUCT.md`).

Detta gäller *inte* retroaktivt de befintliga `.vote-btn`/
`.favorite-btn`-knapparna (idag 44×40px, en existerande avvikelse) —
att åtgärda dem är utanför den här specens omfattning och en egen,
framtida uppgift.

Kartans klickbara punkter (terrasser på canvas) har per definition ingen
DOM-baserad tryckyta att mäta i px; se avsnitt "Testning" och
`Persona-anteckning` nedan för hur tangentbords-/skärmläsaranvändare
istället garanteras full funktionalitet via den oförändrade resultatlistan.

**Persona-anteckning (Sam, skärmläsare/tangentbord):** klick på en
kart-punkt är en ren bekvämlighetsgenväg, aldrig den enda vägen till en
terrass. Resultatlistan under hero-ytan är identisk och fullt
tangentbords-/skärmläsartillgänglig i båda lägena (se avsnitt 2,
"Omfattning") — mapView.js:s canvas-interaktion introducerar ingen ny
funktionalitet som saknar en fullvärdig, redan tillgänglig motsvarighet
i listan. `mapView.js`s egna kontroller (växlingsknappar, "Visa mig")
ska själva vara vanliga `<button>`-element (inte canvas-ritade), så de
får tangentbordsfokus och skärmläsar-etiketter gratis via samma mönster
som `#near-me-button` redan använder.

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
  - "Visa mig" visar "Hämtar din plats…" under hämtning, är
    inaktiverad medan förfrågan pågår, och visar rätt
    nekad-/fel-meddelande vid nekat platsdelning respektive annat fel.
  - Kartan öppnas centrerad på fokuserad terrass, zoomad till
    grannskapsnivå (~1 km) — inte hela täckningsområdet — vid första
    växling till "Karta".
  - Gatunamn/Maps-länk/avstånd syns korrekt i expanderat kort, gatunamn
    utelämnas tyst när taggen saknas.
  - Alla nya knappar ("Karta"/"Byggnader", "Visa mig") har ≥44×44px
    tryckyta; resultatlistan förblir fullt tangentbords-/
    skärmläsartillgänglig i båda lägena.
  - 375px mobilbredd (appens primära bredd per PRODUCT.md).
- Visuell verifiering i Browser-panelen (screenshot) — redesignen
  2026-08-16 kunde inte göra detta samma session; gör det här.

## Explicit uteslutet (YAGNI)

- Ingen väggeometri/gatukarta-rendering (se "Beslut" ovan).
- Ingen kontinuerlig positionsspårning (`watchPosition`).
- Ingen dubblering av resultatlistan i kartläget — en lista, två
  hero-vyer ovanför den.
- `taggning.html` berörs inte (samma undantag som redesignen 2026-08-16).
