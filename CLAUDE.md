# CLAUDE.md — projektkontext för uteservering-sol

Den här filen läses automatiskt av Claude Code i nya konversationer. Den
sammanfattar vad projektet är, hur det hänger ihop, vilka beslut som tagits
och vad som är kvar att göra — så att en ny session kan fortsätta utan att
tappa tråden. Uppdatera den när något väsentligt ändras.

## Vad det är

En statisk webbapp som visar vilka uteserveringar i Malmö som har direkt
solljus just nu (eller vid valfri tid/datum), med hänsyn till skuggor från
riktiga byggnaders läge och höjd — inte bara om solen är uppe.

- **Live sol-app:** https://fredaspba.github.io/uteservering-sol/
- **Live taggningslista:** https://fredaspba.github.io/uteservering-sol/taggning.html
- **Repo:** https://github.com/FredAspBA/uteservering-sol (konto `FredAspBA`)
- **Hosting:** GitHub Pages från `main`-branchen (rot). Push till `main` →
  bygg + deploy automatiskt (~30–60 s).
- **Språk i UI och kommentarer mot användaren:** svenska.

## Att göra härnäst (uppdatera i takt med att saker blir klara)

Prioriterat överst. Bocka av / ta bort rader när de är gjorda.

- [x] **Datakvalitetsarbete — se `PLAN-datakvalitet.md`.** Alla sex faser
      avslutade. **Fas 1–2:** byggnadshöjder gissas via typmedian →
      grannskapsmedian istället för platt 15 m; appen hittar 2,8–8,2 %
      fler soliga uteserveringar. **Fas 3:** Geofabrik+osmium-pipeline i
      GitHub Actions ersätter tiled Overpass, mergad och verifierad med
      tre riktiga körningar. **Fas 4:** Overture som höjdkälla utvärderad
      och avslutad **NO-GO** (2026-08-08) — slår inte nuvarande modell på
      byggnader utan känd höjd (MAE 2,56 m mot 1,89 m), täcker bara
      51,4 %. **Fas 5:** Malmö stads serveringstillstånd-register —
      **del A** (2026-08-08) löser 175 `alcohol=unknown`-ställen till
      "ja", hint i taggningslistan. **Del B** (2026-08-11) geokodar och
      visar 246 registerställen som saknas i OSM direkt på kartan
      (streckad markör, tydligt OSM-overifierade, länk till att lägga
      till i OSM) — bl.a. "Andys Burgers", det konkreta "Andy's"-stället.
      **Klart 2026-08-11:** del A+B inkopplade i `refresh-data.yml`
      (`continue-on-error` på alla tre steg, så en tillfällig Malmö-
      server/Nominatim-störning aldrig blockerar kärn-pipelinen), och
      "Dölj i appen"-stöd för del B-platser i taggningslistan (egen
      radtyp, ingen Ja/Nej-toggling — verifierat end-to-end mot riktig
      Firebase: kryssat döljer platsen på solkartan, avkryssat visar
      den igen). `fetch-serving-permit-details.js` fick även en cache
      (samma mönster som geocode-cache.json) eftersom scriptet nu körs
      månadsvis istället för en gång. **Fas 6** (träd, terrass-som-yta,
      Lantmäteriet LiDAR) mätt och avslutad **NO-GO** 2026-08-11 för alla
      tre — se `PLAN-datakvalitet.md` för siffrorna (bl.a. bara 1,2 % av
      terrasserna har ett OSM-taggat träd inom skuggavstånd). Samma dag
      byggdes utanför planen ett **alkoholfilter på kartan** (🍷 Endast
      alkohol-kryssruta, samverkar med sökningen) och en **utökad
      uteservering-hint** (samma register-mönster som alkohol-hinten,
      nu även för OSM-matchade platser — 130 nya hints). Se
      `PLAN-datakvalitet.md` för alla siffror och detaljer.
- [x] **Väder (SMHI:s öppna API) — klart 2026-08-12.** `src/weather.js`
      hämtar en molntäckningsprognos en gång per sidladdning (täcker hela
      ~10-dagarsfönstret i ett anrop, cachas i minnet — verifierat live:
      exakt 1 SMHI-anrop trots flera popup-öppningar/datumbyten). Visas
      som en badge i popupen, bara vid status "Sol" och bara när valt
      datum ligger inom prognosfönstret (annars tyst utelämnad — verifierat
      med ett datum 30 dagar fram). **OBS för framtida sessioner:** det
      gamla API:t (`pmp3g`) jag mindes från träningsdata avvecklades
      2026-03-31 — rätt endpoint är `snow1g`, verifierat live, inte
      antaget. Attribution (CC BY 4.0, till skillnad från CC0-källorna) i
      sidfoten, `#data-credits`.
- [x] **Fixa de 12 anomaly-fallen — klart 2026-08-12.** Hypotesen från
      fas 6 (stor way-polygons centroid i fel byggnad) visade sig vara
      **fel** vid närmare diagnos — verkliga orsaken: punkten låg
      genuint innanför två olika OSM-byggnadsvägar för samma fysiska
      byggnad samtidigt (t.ex. "Studio Malmö" + "Story Hotel Studio
      Malmo"). `findHomeBuilding()` i `src/shadow.js` returnerar nu en
      `Set` av alla byggnader som genuint innehåller punkten, inte bara
      den närmaste. Verifierat: exakt 12 terrasser gick anomaly→sol,
      inget annat ändrades. Se `PLAN-datakvalitet.md` fas 6 för hela
      diagnosen.
- [x] **Favoriter — klart 2026-08-15.** Lätt localStorage-stöd för att spara
      favoritställen (★/☆ knapp i popupen), med filtrering ("Endast favoriter"
      checkbox). Samma mönster som röstloggen, ingen Firebase-integrering. E2E
      testad: toggle, filter, unfilter.
- [ ] **Synka in Fredriks OSM-taggningar.** Fredrik taggar löpande i OSM
      (konto `FredAspBark`) — hittills bl.a. `alcohol=yes` på Hygge Mat & Bar.
      När en omgång är gjord: vänta ~1 h (Overpass-uppdatering), kör sedan
      `npm run fetch-data` → `npm run build-tagging-list` → commit → push.
      Verifiera efteråt att de nya värdena syns i appen/listan.
- [x] **Fyll byggnadsluckor.** Löst strukturellt av fas 3 (Geofabrik+osmium
      ersätter tiled Overpass, som var källan till 504-rutorna) —
      byggnader gick 23 251 → 25 099 i samma veva. Ta bort den här raden
      helt vid nästa städning av listan.
- [ ] **Lägg till saknade ställen i OSM (numera "trevligt att ha", inte
      blockerande).** Fas 5 del B visar redan 246 sådana ställen (bl.a.
      "Andys Burgers") direkt på kartan, tydligt OSM-overifierade — men de
      blir en riktig, kvalitetsgranskad OSM-post (och en exakt position
      istället för en ungefärlig geokodning) först när någon faktiskt
      lägger till dem i OSM. Fredrik lägger till i OSM (konto
      `FredAspBark`); stället flyttas då automatiskt över till att vara en
      vanlig terrass vid nästa datasynk (försvinner ur unverified-venues,
      dyker upp i terraces.geojson).
- [ ] **(Ev.) Web Worker för skuggberäkningen.** Spike 2026-08-15 (vanlig
      browser): **PROVEN MÖJLIG** — postMessage fungerar perfekt. Backades ut
      tidigare pga testbrowser-begränsning. Framtida implementering: flytta
      terrass-loop + spatial index till worker, huvudtråd blir responsive.
      Skulle ta bort kall-laddningsfrysningen helt (~8.6s → ~5-6s). Arbetsomfattning:
      refaktor shadow.js arkitektur + Turf.js-serialisering (~2-3 h).
- [ ] **Löpande:** verifiera att "Dölj i appen" / "Uteservering: Nej" fortsatt
      döljer rätt ställen när listan växer, och håll `data/geocode-cache.json`
      med (ny geokodning sker bara för nya dubblettfilialer).

(Tidigare förslag — kopiera-taggar, dubblett-badge, framstegsstapel, dölj
klara, direkt-till-redigeraren — är alla byggda och live.)

## Dokumentation i repot

- `PLAN-datakvalitet.md` — handlingsplanen för datakvalitet (fas 1–6),
  med uppmätta siffror, utmaningar och motåtgärder per fas.
- `DATAKALLOR.md` — inventering av datakällor för byggnader, sol, skuggor,
  alkohol och uteservering: licenser, kostnad, länkar, och vad som valdes
  bort och varför. Innehåller även mejlmallen för begäran om allmän handling.
- `PRODUCT.md` — produktschema (plattform, användare, syfte, positionering,
  principer) enligt `impeccable`-skillets format. Läs vid produktbeslut
  (t.ex. nya funktioner) för att stämma av mot syfte och principer.

## Kör och deploya

```
npm install
npm start           # startar scripts/static-server.js på http://localhost:5500
```
Måste köras via server (inte file://) eftersom appen hämtar .geojson med fetch.
Deploy = `git add -A && git commit && git push` (Pages bygger om automatiskt).
`gh` CLI finns på `C:\Program Files\GitHub CLI\gh.exe` (inte i PATH).

## Filkarta

- `index.html` + `src/app.js` — sol-appen (Leaflet-karta, tidsreglage, sök,
  "nära mig"-knappar, tumme upp/ner, popup med sol/skugga + typ + alkohol).
- `src/shadow.js` — skuggberäkning (raycasting mot byggnader, spatialt
  rutnätsindex). `src/sun.js` — SunCalc-wrapper. `src/dataLoad.js` — laddar
  geojson + förbereder byggnader/terrasser.
- `src/votes.js` + `src/cloudVotes.js` — tumme upp/ner (lokalt i
  localStorage + delat till Firebase). `cloudVotes.js` har även
  `fetchExcludedKeys()` som sol-appen använder för att dölja ställen.
- `src/weather.js` — SMHI-molntäckningsprognos, ett anrop per sidladdning
  (cachas i minnet, hela ~10-dagarsfönstret på en gång). Badge i popupen
  bara vid status "Sol" och bara inom prognosfönstret.
- `taggning.html` + `src/tagging.js` + `taggning.css` — gemensam
  taggningslista (se nedan).
- `scripts/fetch-data.js` — hämtar terrasser + byggnader från Overpass →
  `data/terraces.geojson`, `data/buildings.geojson`. Manuellt
  reservalternativ sedan fas 3 (se nedan); inte längre huvudvägen där.
- `scripts/fetch-data-geofabrik.js` + `.github/workflows/refresh-data.yml`
  — fas 3, huvudvägen för datahämtning (Geofabrik + osmium, se
  `PLAN-datakvalitet.md` fas 3 för status). `scripts/check-data-drift.js`
  är ±20 %-grinden mellan dem och en commit.
- `scripts/lib/slim-building.js`, `scripts/lib/terrace-categories.js` —
  delade regler (taggar att behålla, vilka ställen som räknas som
  terrass) mellan `fetch-data.js` och `fetch-data-geofabrik.js`, så de
  två hämtningsvägarna inte kan divergera. `scripts/lib/write-geojson-
  lines.js` — en feature per rad, sorterat på OSM-id (håller `.git` litet).
- `scripts/build-tagging-list.js` — bygger `data/tagging-list.json` (+ geokodar
  dubblettfilialer, cachar i `data/geocode-cache.json`).
- `scripts/fetch-serving-permits.js` — fas 5 del A: hämtar Malmö stads
  serveringstillstånd-register, matchar mot `data/terraces.geojson` →
  `data/serving-permits.json`. Se `PLAN-datakvalitet.md` fas 5.
- `scripts/fetch-serving-permit-details.js` — fas 5 del B-underlag: hämtar
  detaljsidor för de omatchade registerställena → `data/serving-permit-
  details.json` (uteservering- och allmänhet-flaggorna), cachad per
  registerId i `data/serving-permit-details-cache.json` (radera filen för
  att tvinga en fullständig omhämtning).
- `scripts/geocode-unverified-venues.js` — fas 5 del B: geokodar
  registerställen utan OSM-motsvarighet (Nominatim, cachad i `data/
  geocode-forward-cache.json`) → `data/unverified-venues.geojson`, som
  `src/dataLoad.js` slår ihop med `terraces.geojson` i minnet. Rör aldrig
  `terraces.geojson` själv. Se `PLAN-datakvalitet.md` fas 5 för
  precisions-förbehållet (Sveriges glesa OSM-adresstäckning).
- `scripts/overture-height-experiment.py` — engångs-valideringsskript (Python,
  se `PLAN-datakvalitet.md` fas 4) som jämförde Overture Maps' byggnadshöjder
  mot nuvarande gissningsmodell; slutsats NO-GO, byggs inte in i pipelinen.
  Kräver `pip install -r scripts/requirements.txt` (repots enda Python-
  beroende, `duckdb`) — körs med `python scripts/overture-height-experiment.py`.
- `database.rules.json` — Firebase-regler (måste publiceras manuellt, se nedan).
- `src/favorites.js` — favoriter i localStorage (`isFavorite`,
  `toggleFavorite`, `getAllFavorites`, `clearAllFavorites`). Används av
  popupens ⭐-knapp och av "Endast favoriter"-filtret i `app.js`.

### Karta över `src/app.js`

~720 rader, men uppdelad i tydliga block. **Läs bara det block du ska ändra
i** — hela filen behöver sällan läsas. Blocken ligger i denna ordning uppifrån
och ner; radnummer utelämnas med flit (de ruttnar vid varje ändring, använd
`grep -n "function namnet" src/app.js`).

| Block | Innehåll |
|-------|----------|
| Konstanter & DOM | `MALMO_CENTER`, `STATUS_LABELS`, `STATUS_COLORS`, `VOTE_STROKE_COLORS`, `cssVar()`, DOM-referenser, modultillstånd (`terraces`, `buildings`, `markers`, `cloudForecast`) |
| Tid & beräkning | `minutesToHHMM()`, `dateFromInputs()`, `setInputsToNow()`, `predictionSnapshot()`, `computeOne()` |
| Mini-dagstidslinje | `TIMELINE_STEP_MINUTES`, `computeTimeline()`, `timelineHtml()`, `timelineSectionHtml()`, `ensureTimeline()` |
| Verksamhetstyp & alkohol | `VENUE_LABELS`, `venueInfo()`, `venueLineHtml()`, `unverifiedNoticeHtml()` |
| Popup | `weatherHtml()`, `popupHtml()` (bygger även ⭐-knappen), `escapeHtml()` |
| Röster & favoriter | `updateMarkerVoteStroke()`, `updateVoteCount()`, `wireVoteButtons()` (kopplar både tumme upp/ner och favoritknappen) |
| Markörer & omberäkning | `renderMarkers()`, `CHUNK_SIZE`, `yieldToBrowser()`, `recompute()` — se **Prestanda** nedan innan du rör dessa |
| Filter | `applyFilters()` — text + "Endast alkohol" + "Endast favoriter" i ett svep |
| "Närmast mig" | `EARTH_RADIUS_M`, `haversineMeters()`, `findNearestMatching()`, `findNearestSunny()`, `findNearestSunnyWithAlcohol()` |
| Start | `downloadVotesJson()`, `debounce()`, `init()` + alla `addEventListener`-kopplingar sist i filen |

## Datapipeline (OSM → appen)

Data hämtas inte vid sidladdning, utan sparas som statiska filer. Sedan
fas 3 sköts det automatiskt: `refresh-data.yml` körs månadsvis (och kan
triggas manuellt via `workflow_dispatch`) och kör i tur och ordning
Geofabrik+osmium (terrasser/byggnader) → ±20 %-grinden → fas 5 del A
(serveringstillstånd) → fas 5 del B (detaljsidor + geokodning av
OSM-saknade ställen) → `build-tagging-list` → committar bara vid faktisk
ändring. De tre fas 5-stegen har `continue-on-error`, så en tillfällig
Malmö-server/Nominatim-störning aldrig blockerar terrass-/
byggnadsuppdateringen.

`scripts/fetch-data.js` (Overpass) finns kvar som manuellt
reservalternativ — för en engångskörning, eller om Geofabrik/osmium av
någon anledning inte går att använda:

```
npm run fetch-data           # ~20–40 min: Overpass i rutor, tål 429/504 med backoff
npm run build-tagging-list   # regenererar tagging-list.json (geokodning cachad)
git add -A && git commit -m "Refresh OSM data" && git push
```

Detaljer:
- Bbox täcker centrala Malmö + Limhamn, Slottsstaden, Fridhem, Erikslust,
  Fågelbacken, Nobel, Dalaplan. Byggnadsfrågan delas i rutor (annars 504).
- Terrasfrågan tar caféer/restauranger/barer/pubbar/glass/snabbmat/bagerier
  m.m. som INTE har `outdoor_seating=no` (de flesta saknar taggen helt i
  Malmö — ~877 av 938 har "okänd" alkohol, ~760 saknar uteservering-tagg).
- Byggnadsgeometrin bufras ~0,5 m och förenklas redan i fetch-scriptet
  (inte i webbläsaren) — annars frös sidan i 60–90 s vid ~900 terrasser.

## Prestanda (viktigt — lätt att råka regressa)

Med ~938 terrasser och ~23 000 byggnader måste allt tungt undvikas i
hot-path. Nuvarande läge: kall laddning ~8,6 s, omberäkning (tidsreglage)
<1 s. Nycklar i `src/shadow.js`:
- Spatialt rutnätsindex, cellstorlek `GRID_CELL_DEG = 0.001` (~100 m). Större
  celler = fler kandidatbyggnader per stråle = mycket långsammare.
- Byggnader bufras i fetch-scriptet, inte i browsern.
- Billig cirkel-mot-strålsegment-förfiltrering före dyra `turf.lineIntersect`.
- `src/app.js` kör omberäkning i CHUNK_SIZE-bitar med `await` mellan, så
  huvudtråden inte fryser.
- OBS: en Web Worker testades men den automatiserade testbrowsern kunde inte
  leverera worker-postMessage alls, så det gick inte att verifiera → backades
  ut till chunking. Kan tas upp igen om det testas i en vanlig browser.

## Firebase (delad data)

- Projekt: `uteservering-040-sol`, Realtime Database (INTE Firestore —
  Firestore-API:t är avstängt). Config i `src/firebase-config.js` (publika
  identifierare, inte hemligheter).
- Noder: `/votes` (append-only tumme upp/ner, ej läsbar utifrån) och
  `/tagging` (delad taggningslista, läs- och skrivbar utan inloggning).
- **Reglerna i `database.rules.json` måste publiceras manuellt** av
  kontoägaren: Firebase Console → Build → Realtime Database → fliken "Rules"
  → klistra in hela filen → Publish. (Publish-knappen syns bara när något
  ändrats i rutan.) Claude kan INTE publicera regler (kräver inloggning),
  men kan verifiera via REST (`curl` mot `...firebasedatabase.app/<nod>.json`).
- Alla nuvarande regler ÄR publicerade och verifierade per 2026-07-22.

## Taggningslistan (taggning.html)

Gemensamt verktyg för att beta av vilka ställen som behöver uppdateras i
OSM. Delas via länk (ingen inloggning) — tänkt för att jobba tillsammans med
en vän. Kryssläget synkas live via Firebase `/tagging`.

- Per ställe: Ja/Nej för **Alkohol** och **Uteservering** (visas bara när
  värdet är okänt i OSM), **OSM uppdaterat** (Ja/Nej), en **"Dölj i
  appen"**-kryssruta, **"⧉ Kopiera taggar"** (kopierar t.ex.
  `outdoor_seating=yes` att klistra in i OSM), och namnet länkar direkt till
  OSM:s redigerare (`/edit?node=…`).
- Dubbletter (kedjor som Espresso House, 17 st) får gatuadress + "Flera
  lokaler"-badge. Adress kommer från `addr:street` där den finns, annars
  reverse-geokodad via Nominatim (cachad).
- Framstegsstapel ("X av N klara"), snabbfilter, "Dölj klara"-kryssruta.
- **Koppling till sol-appen:** ett ställe göms från kartan om det i
  `/tagging` har `outdoor: "no"` (Uteservering: Nej) ELLER `exclude: true`
  (Dölj i appen). Sol-appen läser `/tagging` en gång vid start
  (`fetchExcludedKeys`) och filtrerar bort dem. Syns vid nästa sidladdning.

## Säkerhet — beslut som tagits

- **XSS:** all OSM-data (namn, byggnadsnamn) escapas / sätts via textContent
  före DOM-inmatning. Aldrig innerHTML med data.
- **SRI:** CDN-scripten (Leaflet/SunCalc/Turf) är versionslåsta med
  integrity-hashar.
- **Firebase `/votes`:** append-only, ej läsbar, strikt validerad.
- **Firebase `/tagging`:** avsiktligt öppen (länkdelning utan konto), men
  hela noden saknar `.write` (går ej att radera i en begäran), varje
  skrivning valideras till exakta yes/no/boolean-fält, och innehåller bara
  kryssrutestatus för publika platser — inga personuppgifter.

## Kända begränsningar / att göra

- **Ställen som saknas helt i OSM** (t.ex. "Andys Burgers") visas sedan
  fas 5 del B ändå, om de har ett serveringstillstånd hos Malmö stad —
  men bara med en **ungefärlig** geokodad position (streckad markör,
  tydlig ⚠️-notis, se `PLAN-datakvalitet.md` fas 5). Ställen som varken
  finns i OSM eller i det registret syns fortfarande inte alls. Fredrik
  taggar i OSM (konto `FredAspBark`) för att ge dem en exakt position;
  när nya taggar gjorts, vänta ~1 h (Overpass-uppdatering, om
  `fetch-data.js` används) eller till nästa månatliga `refresh-data.yml`-
  körning (Geofabrik-vägen).
- En Espresso House-filial fick ingen adress vid geokodning (Nominatim tom
  träff) — OSM-länken skiljer den ändå.
- Byggnadshöjd gissas när OSM saknar `height`/`building:levels` (~80 % av
  byggnaderna): först uppmätt median för byggnadstypen, annars medianen för
  omgivande höjdtaggade byggnader, och först i sista hand 15 m (~1 500 st).
  Gissningarna är ungefärliga — riktiga höjder kommer först med Overture
  eller LiDAR, se `PLAN-datakvalitet.md`.
- Skuggor längre än 500 m (mycket låg sol) fångas inte.
- `npm audit`: `@xmldom/xmldom` (via osmtogeojson) flaggas, men används bara
  lokalt i fetch-scriptet mot JSON — låg risk. Se README.

## Fallback

Git-taggen `v1-classic-design` är en ögonblicksbild av den tidigare, svalare
designen (före sommarträdgårds-omdesignen) om man vill jämföra/återgå.

## Arbetssätt som fungerat bra

Fredrik vill att man bygger på och redirectar vid behov, verifierar i
webbläsaren (via preview/Chrome-verktygen) och är ärlig om vad som testats
kontra inte. Testa gärna i en NY flik om en flik blivit seg (händer efter
många tunga sidladdningar i samma session). Skärmbilder kan ibland timeouta
i testmiljön — DOM-frågor via javascript_tool är då pålitligare.
