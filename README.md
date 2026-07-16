# Uteservering i solen – Malmö

Visar vilka uteserveringar i Malmö som har direkt solljus just nu,
eller vid valfri tid/datum du väljer — med hänsyn till skuggor från
omkringliggande byggnader (inte bara om solen är uppe eller inte).
Täcker centrala Malmö plus Limhamn, Slottsstaden, Fridhem, Erikslust,
Fågelbacken, Nobel och Dalaplan. Sök på namn, och ge tummen upp/ner på om
sol/skugga-bedömningen stämmer just nu.

**Live:** https://fredaspba.github.io/uteservering-sol/

## Publicera ändringar (GitHub Pages)

Sidan hostas gratis via GitHub Pages direkt från `main`-branchen av det här
repot. Så fort du pushar till `main` byggs och uppdateras den publika sidan
automatiskt (tar oftast under en minut):

```
git add -A
git commit -m "..."
git push
```

## Köra appen lokalt

Appen är statisk (ingen backend), men måste köras via en lokal webbserver
(inte öppnas direkt som `file://`), eftersom den hämtar `.geojson`-filer med
`fetch()`:

```
npm install
npm start
```

Öppna sedan adressen som skrivs ut (`http://localhost:5500`).

## Uppdatera data

Uteserveringar och byggnader hämtas från OpenStreetMap via Overpass API och
sparas som statiska GeoJSON-filer i `data/`, så att appen inte behöver
anropa Overpass vid varje sidladdning (Overpass är hastighetsbegränsat och
kan vara långsamt). Kör om följande när du vill uppdatera datan:

```
npm run fetch-data
```

Byggnadsfrågan delas upp i mindre rutor (tiles) internt eftersom en enda
stor fråga över hela området annars ofta timeoutar (504) på den publika
Overpass-instansen.

## Hur skuggberäkningen fungerar

Se `src/shadow.js` för implementationen. Kortfattat: för varje uteservering
och given tidpunkt räknas solens höjd och riktning ut (`src/sun.js`, via
SunCalc). Om solen är under horisonten är det "mörkt". Annars dras en
tänkt stråle från uteserveringen mot solen (upp till 500 m), och om en
byggnad korsar strålen och är hög nog för att blockera solen vid det
avståndet (`höjd >= avstånd * tan(solhöjd)`), räknas uteserveringen som
skuggad.

Kända förenklingar:
- Byggnadshöjd hämtas från OSM-taggar (`height`, annars
  `building:levels * 3m`, annars ett standardvärde på 15 m om inget finns).
- Max-avståndet på 500 m kan missa mycket långa skuggor vid väldigt låg
  solhöjd (nära soluppgång/solnedgång).
- En uteservering exkluderar sin egen "hem-byggnad" (den byggnad den ligger
  direkt intill) från skuggberäkningen, så att den inte felaktigt räknas
  som skuggad av sin egen vägg.

## Sök och kvalitetssäkring (tumme upp/ner)

Sökfältet filtrerar uteserveringar på namn (fritext, med autocomplete) och
zoomar/öppnar automatiskt om exakt en träff matchar.

Varje popup har 👍/👎 för "stämmer sol/skugga-bedömningen just nu?". Detta
loggar en post (byggnad/terrass-id, exakt visat datum+tid, en ögonblicksbild
av vad algoritmen räknat ut, och ditt svar) till `localStorage` i din
webbläsare — **bara lokalt på din enhet**, inte delat med andra användare.
Tanken är att kunna exportera loggen (knappen "Exportera bedömningar" längst
ner på sidan) och använda den för att i efterhand se var skuggberäkningen
träffar fel, och förbättra `src/shadow.js`. "Rensa mina bedömningar" tömmer
loggen på den här enheten.

## Prestanda: spatialt index för byggnader

Med tusentals byggnader (Malmö-området har f.n. ~22 000) är det för
långsamt att för varje uteservering och varje omberäkning leta igenom hela
byggnadslistan linjärt — testat gav det ~4-5 sekunder per omberäkning, vilket
gör tidsreglaget oanvändbart. `src/shadow.js` bygger därför ett enkelt
rutnätsindex (grid, ~500 m rutor) vid inläsning, så att bara byggnader nära
varje uteservering behöver kollas. Det sänkte omberäkningstiden till under
en halv sekund.

## Känd sårbarhet i utvecklingsberoende

`npm audit` flaggar en kritisk sårbarhet i `@xmldom/xmldom` (transitivt via
`osmtogeojson`). Det paketet används enbart lokalt i `scripts/fetch-data.js`
för att tolka **JSON**-svar från Overpass (inte XML), och körs aldrig i
webbappen eller mot opålitlig indata, så risken bedöms som låg. Uppdatera
gärna `osmtogeojson` om en fixad version släpps.
