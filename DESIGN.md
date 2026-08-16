---
name: Uteservering i solen – Malmö
description: Kartografisk solkarta för Malmö — svart planritningspapper, guld sol, isometrisk skuggfysik
colors:
  bg: "#141412"
  surface: "#1d1d1a"
  surface-raised: "#242420"
  surface-border: "#3c3c35"
  ink: "#f4f3ec"
  ink-muted: "#a8a79c"
  sun: "#d4af37"
  sun-strong: "#e8c766"
  shade: "#85acc9"
  dusk: "#8a6a3a"
  night: "#8f8f88"
  anomaly: "#e2703f"
  confirm: "#82b085"
typography:
  display:
    fontFamily: "IBM Plex Sans, Segoe UI, sans-serif"
    fontWeight: 700
    letterSpacing: "-0.01em"
  body:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontWeight: 400
  mono:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontWeight: 500
rounded:
  sm: "3px"
  md: "5px"
components:
  button-primary:
    backgroundColor: "{colors.sun}"
    textColor: "#141412"
    rounded: "{rounded.sm}"
    padding: "0.5rem 1.1rem"
  button-primary-hover:
    backgroundColor: "{colors.sun-strong}"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.sm}"
---

# Design System: Uteservering i solen – Malmö

## Overview

**Creative North Star: "Malmö Urban Grid"**

Malmös byggnader är inte bakgrund — de är den mekanism som avgör svaret. Varje
yta i det här systemet är kartografisk: koordinatgitter, tunna linjer,
mätvärden skrivna ut istället för gömda bakom ett grönt/rött betyg. Guld
betyder sol, och bara sol — det är den enda mättade färgen på hela ytan, så
när något är guld har det faktiskt uppsåt (solen, ett fokuserat kort, en
primär knapp). Allt annat är svart papper och ljusgrå linjer.

Systemet ersatte en tidigare "svensk sommarterrass"-värld (soltorkat gräs,
marigold, fern-grönt) den 2026-08-15 efter ett `/shape`-beslut där
användaren valde denna riktning framför tre andra. Den gamla världen finns
kvar oförändrad i `taggning-tokens.css` för `taggning.html`, som inte var
del av omdesignen (se den filens egen kommentar).

Bekräftat avvisat: mjuka, glansiga skuggor (`box-shadow`-blur) — världen är
platt, funktionalistisk ritning, inte materialdesign. Emoji-som-ikon i
knappar/filter (📍🍷⭐👍👎☁️⚠️➕) ärvdes oförändrat från den gamla appen och
är INTE en del av detta systems ikonspråk — status-glyferna (sol/löv/
måne/varningstriangel) är de enda auktoriserade egen-ritade ikonerna;
resten är ett känt, oåtgärdat gap mot ett fullt konsekvent system (se
Do's and Don'ts).

**Key Characteristics:**
- Svart koordinatpapper, guld som enda mättade accent, ljusgrå linjer/text
- Kartografiska etiketter: mono för mätvärden, sans för allt annat
- Isometrisk, fysiskt korrekt skuggkastning — inte en dekorativ illustration
- Platt: inga mjuka skuggor, inga glasiga ytor, inga gradienter på text

## Colors

Palettens karaktär: en mörk ritningsyta där guld är det enda som ropar.

### Primary
- **Guld** (`#d4af37`, `--color-sun`): solen själv, primärknappen, fokusram
  runt valt kort, highlight på den byggnad som faktiskt skuggar i
  skuggkartan. `--color-sun-strong` (`#e8c766`) är samma roll vid hover/
  betoning på mörk botten.

### Neutral
- **Koordinatsvart** (`#141412`, `--color-bg`): sidans botten, med ett
  mycket svagt guldrutnät (`repeating-linear-gradient` @ 7% opacitet, 40px
  rutor) — "The Coordinate Paper Rule": bakgrunden är alltid ett rutnät,
  aldrig en ren flat yta.
- **Panelyta** (`#1d1d1a`, `--color-surface`): kort, kontrollrader, legend.
- **Upphöjd yta** (`#242420`, `--color-surface-raised`): hover-state på
  kortets klickbara rad, skuggkartans himmel-gradient.
- **Linjegrå** (`#3c3c35`, `--color-surface-border`): alla 1px-ramar.
- **Text** (`#f4f3ec`, `--color-ink`): brödtext. **Dämpad text**
  (`#a8a79c`, `--color-ink-muted`): etiketter, sekundär info.

### Funktionella statusfärger (inte del av "en mättad accent"-regeln)
- **Skugga** (`#85acc9`, `--color-shade`): kylig blå-grå, läses som
  "skuggad yta på en ritning", aldrig förväxlingsbar med guld-solen.
- **Mörkt** (`#8f8f88`, `--color-night`): neutral grå, "solen är nere".
- **Osäker** (`#e2703f`, `--color-anomaly`): rostorange, varningar och
  overifierad data.
- **Bekräftat** (`#82b085`, `--color-confirm`): 👍-röstringen.
- **Skymning** (`#8a6a3a`, `--color-dusk`): övergångston i tid-slidern
  mellan natt och guld-dag, inget annat.

### Named Rules
**The One Gold Rule.** Guld används bara där något faktiskt är
handlingsbart eller är solen själv: primärknapp, fokuserat kort, den
riktiga skuggande byggnaden i skuggkartan. Status-etiketter för
skugga/mörkt/osäker är medvetet ANDRA färger, aldrig guld i olika
nyanser — annars slutar guld betyda något.

## Typography

**Display Font:** IBM Plex Sans (700, med "Segoe UI" som fallback)
**Body Font:** IBM Plex Sans (400)
**Label/Mono Font:** IBM Plex Mono (500/600)

**Character:** Grotesk, industriell — pinnad av det ursprungliga
`/shape`-beslutet, inte en generisk trend-standard. Ingen display-serif,
ingen script.

### Hierarchy
- **Display** (700, `clamp(1.55rem, 1.2rem + 1.4vw, 2.15rem)`): `<h1>`,
  sidans enda riktiga rubrik.
- **Wordmark** (700, 0.95rem, versaler, 0.06em spårning, sans — INTE
  mono): "☀️ Malmö Solar Grid", en logotyp-rad ovanför h1, inte en kicker
  (se Named Rule nedan för skillnaden).
- **Body** (400, 0.85–0.95rem): brödtext, kort-namn, förklarande stycken.
- **Label** (600, 0.68–0.82rem, versaler, 0.03–0.07em spårning, sans):
  kontrolletiketter, filterknappar, "Visa fler"-knappen.
- **Mono/data** (500, 0.72–0.95rem, `font-variant-numeric: tabular-nums`
  där relevant): ENDAST verkliga mätvärden — klockslag, datum, "Solhöjd:
  4.4°", avstånd i meter, riktningsgrader. Aldrig knapptext, aldrig
  etiketter, aldrig varumärket.

### Named Rules
**The Mono-Is-Measurement Rule.** Monospace används uteslutande för tal
som är riktiga mätvärden (tid, datum, grader, meter) — aldrig som kostym
för "det här är tekniskt". En etikett som "DATUM" eller en knapp som "NU"
är sans, även om de sitter bredvid ett mono-värde. Detta är en medveten
efterkorrigering: den första versionen av detta system använde mono för
etiketter/knappar också och en mekanisk `craft-floor`-granskning
flaggade det som kostym-mono.

**The Wordmark-Not-Kicker Rule.** Wordmarken ovanför `<h1>` är tillåten
för att den namnger PRODUKTEN (annan text än rubriken under), inte för
att den är en dekorativ etikett som upprepar rubriken. En sektion som
lägger en versal-etikett rakt ovanför en egen rubrik utan att den
etiketten namnger något eget (som skuggkartans tidigare "Skuggkarta —
verklig byggnadsgeometri"-rad gjorde) är en kicker och togs bort.

## Layout

Enkolumns, mobil-först flöde (bekräftat first-viewport-bredd: 375px):
header → kontrollrad (datum-stegrare + tid-slider) → sök/filter-rad →
isometrisk skuggkarta → legend → resultatlista (kort) → footer. Ingen
sidopanel, ingen fast navigation. Innehållsbredd är helskärm med
`1.25rem`/`1rem` (mobil) sidopadding — inget maxbredd-containerlås, sidan
är tänkt att fyllas på mobilen den mestadels används på.

Resultatlistan är virtualiserad av prestandaskäl, inte estetik: bara
synliga kort (default 24) finns i DOM, "Visa fler" laddar 24 till.
Rutnätsbakgrunden (40px rutor) är den enda "grid"-referensen i ordets
bokstavliga mening — layouten själv är ett enkelt vertikalt flöde.

## Elevation & Depth

Platt. Inga mjuka `box-shadow`-blurar någonstans i systemet — det skulle
läsa som materialdesign/glas, tvärtemot en ritningsvärld. Den enda
skuggan som finns (`--shadow-sm: 0 1px 0 rgba(0,0,0,0.6)`) är en hård,
oblurrad 1px-offset på tid-sliderns handtag, ett medvetet undantag
grundat i att funktionalistisk ritning tål en skarp kant bättre än en
mjuk glöd. Djup i övrigt kommuniceras genom `--color-surface-raised`
(en ton ljusare vid hover) och 1px-ramar, aldrig genom skugga.

### Named Rules
**The Flat Paper Rule.** Om ett element behöver läsas som "ovanpå"
något annat, lyft det med en ljusare yta eller en guldram — aldrig med
`box-shadow`-blur.

## Shapes

Skarpa, tekniska hörn: `--radius: 3px` (kort, knappar, inputs),
`--radius-lg: 5px` (skuggkartans ram). Inga pill-formade knappar utom
filterchipsen (`border-radius: 999px` på `.alcohol-filter-field`/
`.favorites-filter-field`), vilka medvetet undantogs för att läsas som
"taggar" snarare än knappar. Ramar är genomgående 1px, aldrig tjockare —
se Do's and Don'ts för `border-left`-förbudet.

## Components

### Buttons
- **Shape:** 3px radie, 1px ram.
- **Primary** (`#now-button`): guldfylld, mörk text (`#141412`),
  700-vikt, ingen mono.
- **Secondary** (`#near-me-button` m.fl.): transparent/`--color-bg`-fylld,
  ljusgrå ram, guldram vid hover.
- **Ghost** (`.link-button`): understruken text, ingen bakgrund/ram —
  export/rensa-länkarna i footern.

### Chips (filterfält)
- **Style:** `.alcohol-filter-field`/`.favorites-filter-field` — pill-
  formad, ljusgrå ram, guldram + 12%-guld-bakgrund när kryssrutan är
  ikryssad (`:has()`-selektor).
- **State:** on/off via native checkbox, ingen egen JS-state.

### Cards / Containers (resultatkorten)
- **Corner Style:** 3px.
- **Background:** `--color-surface`, ingen skugga.
- **Border:** 1px `--color-surface-border` runt om — INGEN vänsterkantad
  statusfärg (se Do's and Don'ts, det var den mekaniska granskningens
  enda faktiska fynd).
- **Fokuserat kort** (`.is-focused`, valt i skuggkartan): guldram +
  1px guld `box-shadow`-ring, inte fyllning.
- **Internal Padding:** 0.65–0.75rem.
- **Signature behavior:** klickbar sammanfattningsrad expanderar en
  detaljregion (lazy-byggd, samma mönster som den gamla Leaflet-appens
  popup-on-open) med förklaring, väder, dagslinje, röst-/favoritknappar.

### Inputs / Fields
- **Style:** `--color-bg`-fylld, 1px `--color-surface-border`-ram, 3px
  radie. `#date-input` och tid-avläsningen är mono (verkliga
  datavärden); sökfältet är sans.
- **Focus:** 2px guld `outline` (`:focus-visible`), ingen egen glow.

### Isometrisk skuggkarta (signaturkomponent)
`<canvas id="iso-canvas">`, ritad av `src/isoHero.js`. Visar RIKTIGA
OSM-byggnader inom 200 m från det fokuserade resultatet, extruderade
efter sin riktiga (uppmätta eller uppskattade) höjd, med skuggor
beräknade av exakt samma fysik som `shadow.js` använder för
sol/skugga-betyget (skuggängd = höjd / tan(solhöjd)). Den byggnad vars
skugga faktiskt når fram till terrassen highlightas i guld — samma
byggnad som kortets "Skuggas av X"-rad namnger. Detta är INTE en
dekorativ illustration; det är samma beräkning, bara ritad. Panorering/
zoom finns inte — vyn är alltid centrerad på det fokuserade resultatet,
med ett dynamiskt skalat vy-fönster.

## Do's and Don'ts

### Do:
- **Do** använda guld (`--color-sun`) bara för sol, primärhandling, eller
  "detta är valt/fokuserat" — aldrig som en av flera likvärdiga
  accentfärger.
- **Do** skriva ut mätvärden rakt av ("Solhöjd: 4.4°", "42 m bort") i
  mono istället för att gömma dem bakom bara en färgkodad etikett —
  det är hela produktens poäng (verklig skugga, inte gissning).
- **Do** hålla skuggkartan bunden till RIKTIGA byggnadsdata och samma
  fysik som `computeShading()`; en framtida ändring som gör den till en
  ren illustration bryter systemets kärnlöfte.

### Don't:
- **Don't** lägga en färgad `border-left`/`border-right` tjockare än
  1px på kort eller listrader. Detta är den mekaniska
  `impeccable`-detektorns enda faktiska fynd i denna omdesign
  (side-tab-mönstret) och togs bort medvetet — status läses via ikon +
  färgad etikett istället.
- **Don't** använda `--font-mono` för något som inte är ett verkligt
  mätvärde. Se the Mono-Is-Measurement Rule.
- **Don't** lägga en versal-etikett (kicker) ovanför en rubrik som bara
  upprepar vad rubriken redan säger. Wordmarken är undantaget eftersom
  den namnger produkten, inte sektionen den sitter ovanför.
- **Don't** lägga till nya emoji-som-ikon-mönster. De befintliga
  (📍🍷⭐👍👎☁️⚠️➕) är ärvt innehåll, inte del av detta systems
  ikonspråk — nya statusindikatorer ska rita en SVG i samma stil som
  `STATUS_ICON_SVG` i `src/app.js`.
- **Don't** lägga till mjuka `box-shadow`-blurar. Se the Flat Paper Rule.
- **Don't** styla `taggning.html` om via denna fil — den läser
  `taggning-tokens.css`, en frusen kopia av föregångarpaletten, med
  avsikt (se den filens egen kommentar).
