# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary — allmänheten i Malmö.** Vem som helst i Malmö (eller på besök) som
vill hitta en solig uteservering just nu, eller vid ett valt klockslag/datum
när man planerar att gå ut. Används mest på mobilen, ofta i farten (på plats
eller på väg).

**Sekundär — Fredrik + en vän, datakuratering.** Ett delat, inloggningsfritt
verktyg (`taggning.html`, länkdelning) där de tillsammans beta av vilka
ställen som behöver rättade OSM-taggar (alkohol, uteservering). Deras
ändringar matar tillbaka in i vad allmänheten ser på solkartan.

## Product Purpose

Visar vilka uteserveringar i Malmö som har direkt solljus just nu (eller vid
valfri tid/datum), med hänsyn till verkliga skuggor från omkringliggande
byggnaders position och höjd — inte bara om solen är uppe. Framgång = en
besökare litar på kartan för att faktiskt hitta en solig plats, och
sol/skugga-bedömningen stämmer överens med verkligheten (mätt via
tumme-upp/ner-röster).

## Positioning

Till skillnad från att bara kolla "är solen uppe" eller gissa, räknar appen
faktisk skuggkastning från riktiga byggnaders läge och (uppskattade) höjder
för varje enskild uteservering och tidpunkt — en granularitet ingen enkel
väderapp eller solups-tabell ger.

## Operating Context

- Statisk webbapp (isometrisk skuggkarta + resultatlista, ingen tredjeparts
  kartmotor sedan MALMÖ URBAN GRID-omdesignen 2026-08-15/16), ingen
  backend-server; data hämtas
  månatligen via en automatiserad GitHub Actions-pipeline (Geofabrik/OSM +
  Malmö stads serveringstillståndsregister) och sparas som statiska
  GeoJSON-filer.
- Hostas gratis på GitHub Pages, deploy = push till `main`.
- Delad data (röster, taggningsstatus) via Firebase Realtime Database, utan
  inloggning för någon användare.
- Taggningslistan är ett fristående arbetsflöde: kryssa av Ja/Nej per
  ställe, länk direkt till OSM:s redigerare, synkas live mellan de två som
  använder den.

## Capabilities and Constraints

- Täcker centrala Malmö + Limhamn, Slottsstaden, Fridhem, Erikslust,
  Fågelbacken, Nobel, Dalaplan — ~940 ätställen.
- Skuggberäkning: raycasting mot byggnadspolygoner, spatialt rutnätsindex
  för prestanda (~938 terrasser, ~25 000 byggnader). Max skuggavstånd 500 m
  (missar mycket låg sol nära gryning/skymning).
- Byggnadshöjd är ofta en uppskattning (OSM saknar `height`/
  `building:levels` för ~80 %) — typmedian → grannskapsmedian → 15 m som
  sista utväg. Overture/LiDAR som höjdkälla utvärderat och avfärdat
  (NO-GO).
- Väderbadge (molntäckning) från SMHI:s öppna API, bara när status är "Sol"
  och datumet ligger inom prognosfönstret.
- Alkoholfilter på kartan, baserat på OSM-taggar + Malmö stads register.
- Firebase `/votes` är append-only och oläsbar utifrån; `/tagging` är
  avsiktligt läs-/skrivbar utan inloggning men strikt fältvaliderad och
  saknar `.write` på hela noden.
- Inget konto/inloggning krävs för någon del av appen.

## Brand Commitments

Inget formellt varumärke. Namnet är beskrivande ("Uteservering i solen –
Malmö"). Allt UI-språk och all text mot användaren är svenska — detta är en
bindande begränsning, inte en tillfällig standard.

## Evidence on Hand

Ingen extern evidens (inga testimonials, ingen press). Produktens egen
insamlade data (tumme upp/ner-röster i Firebase) fungerar som löpande
kvalitetssignal för skuggberäkningens träffsäkerhet — framtida arbete får
inte hitta på siffror utöver vad som faktiskt loggats.

## Product Principles

1. **Verklig skugga, inte gissning.** Varje förenkling (byggnadshöjd,
   500 m-gräns) ska vara medvetet vald och dokumenterad, inte en genväg som
   göms för användaren.
2. **Data är opt-in och transparent.** Ovanverifierade ställen (t.ex. från
   serveringstillståndsregistret) visas tydligt markerade som sådana,
   aldrig som om de vore lika säkra som OSM-verifierad data.
3. **Gratis och underhållsfritt i drift.** Statisk hosting, automatiserad
   månatlig datapipeline, inga backend-kostnader — hållbart för ett
   sidoprojekt utan löpande drifttid.
4. **Svenska rakt igenom.** Målgruppen är Malmöbor; inget UI-språkval, ingen
   engelsk text mot slutanvändaren.
5. **Skydda den delade datan.** Öppna, inloggningsfria Firebase-noder
   (taggning, röster) ska vara robusta mot missbruk genom strikt
   fältvalidering och append-only-mönster, inte genom att stänga ute
   samarbete.

## Accessibility & Inclusion

**44px WCAG-tryckytor: bekräftat krav** (2026-08-19, beslutat i samband
med kart-/byggnadsvy-växlingens `/impeccable critique`, se
`docs/superpowers/specs/2026-08-18-map-view-toggle-design.md` avsnitt 6).
Alla nya interaktiva kontroller ska ha minst 44×44px tryckyta, samma mått
som `.card-summary` redan använder. Detta stänger den tidigare öppna
frågan för framtida arbete — inget behöver längre "behandlas som öppet"
här. Kravet är inte retroaktivt: `.vote-btn`/`.favorite-btn` (idag
44×40px) är en känd, oåtgärdad avvikelse, kvar som framtida
städuppgift, inte en blockare för nytt arbete.

Ingen annan formell tillgänglighetsstandard fastställd utöver detta.
