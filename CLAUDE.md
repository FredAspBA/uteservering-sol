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

- [ ] **Synka in Fredriks OSM-taggningar.** Fredrik taggar löpande i OSM
      (konto `FredAspBark`) — hittills bl.a. `alcohol=yes` på Hygge Mat & Bar.
      När en omgång är gjord: vänta ~1 h (Overpass-uppdatering), kör sedan
      `npm run fetch-data` → `npm run build-tagging-list` → commit → push.
      Verifiera efteråt att de nya värdena syns i appen/listan.
- [ ] **Fyll byggnadsluckor.** Senaste `fetch-data`-körningen hoppade över
      2–3 rutor pga Overpass-504. Kör om `npm run fetch-data` vid tillfälle
      för att täppa till (påverkar bara skuggprecision i de områdena).
- [ ] **Lägg till saknade ställen i OSM.** "Andy's" (och ev. fler) finns inte
      alls i OSM och kan därför inte visas i appen förrän de läggs till där.
      Fredrik lägger till dem i OSM; sedan plockas de upp vid nästa datasynk.
- [ ] **(Ev.) Web Worker för skuggberäkningen.** Backades ut eftersom
      testbrowsern inte kunde leverera worker-postMessage. Kan tas upp igen
      om det testas i en vanlig browser — skulle ta bort den lilla frysningen
      vid kall laddning helt.
- [ ] **Löpande:** verifiera att "Dölj i appen" / "Uteservering: Nej" fortsatt
      döljer rätt ställen när listan växer, och håll `data/geocode-cache.json`
      med (ny geokodning sker bara för nya dubblettfilialer).

(Tidigare förslag — kopiera-taggar, dubblett-badge, framstegsstapel, dölj
klara, direkt-till-redigeraren — är alla byggda och live.)

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
- `taggning.html` + `src/tagging.js` + `taggning.css` — gemensam
  taggningslista (se nedan).
- `scripts/fetch-data.js` — hämtar terrasser + byggnader från Overpass →
  `data/terraces.geojson`, `data/buildings.geojson`.
- `scripts/build-tagging-list.js` — bygger `data/tagging-list.json` (+ geokodar
  dubblettfilialer, cachar i `data/geocode-cache.json`).
- `database.rules.json` — Firebase-regler (måste publiceras manuellt, se nedan).

## Datapipeline (OSM → appen)

Data hämtas EN gång och sparas som statiska filer (Overpass är
hastighetsbegränsat, hämtas inte vid sidladdning). När OSM-taggar ändrats
och du vill synka in dem:

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

- **"Andy's" (och andra ställen som saknas helt i OSM)** kan inte dyka upp i
  appen förrän de läggs till i OSM av någon. Fredrik taggar i OSM (konto
  `FredAspBark`); när nya taggar gjorts, vänta ~1 h (Overpass-uppdatering)
  och kör om datapipelinen.
- En Espresso House-filial fick ingen adress vid geokodning (Nominatim tom
  träff) — OSM-länken skiljer den ändå.
- Byggnadshöjd gissas till 15 m när OSM saknar `height`/`building:levels`.
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
