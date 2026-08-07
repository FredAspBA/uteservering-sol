# Datakällor — inventering

Referensmaterial från genomgången 2026-08-07 av vilka källor som finns för
byggnader, solposition, skuggor, alkohol och uteservering. Handlingsplanen
ligger i `PLAN-datakvalitet.md`; det här är underlaget bakom den.

## Byggnader — geometri och höjd

Höjd är appens största felkälla (~80 % av byggnaderna saknar höjdtagg i
OSM), så det är här källvalet spelar mest roll.

| Källa | Höjddata | Licens | Kostnad | Status |
|---|---|---|---|---|
| [OpenStreetMap](https://www.openstreetmap.org) via Overpass | `height` 0,4 %, `building:levels` 19,3 % | ODbL | Gratis | **Används idag** |
| [Overture Maps](https://docs.overturemaps.org/guides/buildings/) | height + levels, ML-härledd där OSM saknar | ODbL/CDLA per tema | Gratis | Fas 4 |
| [Lantmäteriet Laserdata NH](https://www.lantmateriet.se/sv/geodata/vara-produkter/produktlista/laserdata-nedladdning-nh/) | Verklig taknock via LiDAR, 0,5–1 pkt/m² | CC0 | Gratis | Fas 6 |
| [Lantmäteriet Byggnad Nedladdning, vektor](https://www.lantmateriet.se/sv/geodata/vara-produkter/produktlista/byggnad-nedladdning-vektor/) | Byggnadsyta + ändamål; höjd oklart | CC0 | Gratis | Outforskad |
| [Lantmäteriet Ythöjdmodell (DSM)](https://www.lantmateriet.se/sv/geodata/vara-produkter/produktlista/ytmodell-fran-flygbilder/) | Bäst — ytmodell inkl. tak | — | **Avgift** via Geotorget | Uteslutet |

Byggnaderna hämtas i praktiken via
[Overpass API](https://overpass-api.de/) idag, men
[Geofabrik-extrakt](https://download.geofabrik.de/europe/sweden.html) +
[osmium](https://osmcode.org/osmium-tool/) är planerat (fas 3) eftersom
Overpass ger 504-timeouts och luckor i datan.

## Solposition

**Ingen åtgärd behövs.** [SunCalc](https://github.com/mourner/suncalc)
ligger inom ~0,01° från NOAA:s referensalgoritm i både azimut och
elevation. Båda bygger på Jean Meeus *Astronomical Algorithms*. Vårt fel
från byggnadshöjder är storleksordningar större — att byta solalgoritm
vore att slipa på fel ände.

Alternativ som övervägdes och valdes bort: NREL SPA (overkill, avsett för
solcellsanläggningar), astronomy-engine (ingen mätbar vinst här).

## Väder

**Ingår medvetet inte.** Appen visar *geometriskt möjligt solljus vid klar
himmel*, inte en väderprognos. Ingen molntäckning, ingen nederbörd. Är det
mulet stämmer appens "sol" inte med verkligheten — det är ett scope-val,
inte en bugg.

## Skuggmetod

Nuvarande: raycasting från terrassens punkt mot byggnadspolygoner, med
spatialt rutnätsindex (`src/shadow.js`).

Alternativ som finns:

- **GPU/WebGL shadow mapping** — så gör [ShadeMap](https://shademap.app/about/).
  Snabbare, men löser inte vårt faktiska problem (höjddata).
- **2.5D-skuggalgoritm direkt på DSM-raster** —
  [metodbeskrivning](https://www.mdpi.com/2220-9964/10/9/583).
- **[Googles Solar API](https://developers.google.com/maps/documentation/solar/data-layers)**
  levererar färdiga GeoTIFF:er med DSM *och* `hourlyShade`, alltså inga
  egna skuggberäkningar alls. **Betalt per anrop** → uteslutet.

Kända blinda fläckar i vår metod, oavsett datakälla:

1. **Träd saknas helt.** Stort för uteserveringar — halva Malmös terrasser
   står under en lönn i juli. LiDAR fångar trädkronor; `natural=tree` i
   OSM är glest.
2. **Terrass = punkt, inte yta.** En stråle från en koordinat; halva
   uteserveringen kan ligga i sol.
3. **Marklutning ignoreras.** Försumbart i Malmö.

## Alkohol — serveringstillstånd

| Källa | Innehåll | Åtkomst |
|---|---|---|
| [Malmö stads restaurangregister](https://restaurang.malmo.se/AlktWebbforms/Restaurants) | Gällande serveringstillstånd, serveringstider, uppdateras varje natt | **Publikt**, detaljsidor på `/Show/{id}` |
| Malmö stad, begäran om allmän handling | Samma data som fil | `tillstandsenheten@malmo.se`, gratis digitalt |
| [Folkhälsomyndighetens Alkoholregistret](https://www.folkhalsomyndigheten.se/nyheter-och-press/nyhetsarkiv/2017/november/register-for-uppgifter-om-alkoholtillstand-byter-namn/) | Nationellt, alla tillstånd sedan 2008 | **Kräver registrering** — ej öppna data |
| Kommersiella restaurangregister | Nationellt | Betalt |

**Viktigt:** ett serveringstillstånd säger att stället får servera
alkohol — inte att det har uteservering.

## Uteservering

Ingen öppen datakälla löser detta. Malmö stad ger tillstånd för
uteservering på offentlig plats, men det publiceras inte som en lista.
**OSM-taggning (`outdoor_seating`) via taggningslistan förblir vägen.**

## Licenser — vad de betyder för oss

- **CC0** (Lantmäteriet): "no rights reserved". Använd hur som helst, även
  kommersiellt, utan attribution, utan att licensen smittar. Mest
  tillåtande som finns.
- **ODbL** (OSM, delar av Overture): *share-alike för databaser*.
  Attribution krävs, och härledda **databaser** måste släppas under ODbL.
  Oproblematiskt för en karta i en hobbyapp — vi anger OSM som källa —
  men relevant om vi någon gång distribuerar en sammanslagen databas.

Notera: CC0 betyder inte att *åtkomsten* är gratis eller friktionsfri.
Lantmäteriet kräver konto för nedladdning, och vissa produkter i samma
familj är avgiftsbelagda trots att andra är öppna. Licens och prislapp är
två olika saker.

## Mall — begäran om allmän handling

Skickad till `tillstandsenheten@malmo.se` 2026-08-07. Sparad för
återanvändning (påminnelse, eller andra kommuner).

> **Ämne:** Begäran om allmän handling – förteckning över stadigvarande
> serveringstillstånd
>
> Hej,
>
> Jag vill med stöd av offentlighetsprincipen begära ut en förteckning
> över de stadigvarande serveringstillstånd som Malmö stad har beviljat
> och som är gällande i dag.
>
> Om möjligt önskar jag följande uppgifter per tillstånd:
>
> - serveringsställets namn
> - besöksadress
> - tillståndshavare och organisationsnummer
> - typ av tillstånd (allmänheten/slutet sällskap, samt omfattning)
> - uppgift om tillståndet omfattar uteservering, om det framgår
>
> Jag tar tacksamt emot uppgifterna i maskinläsbart format, exempelvis
> Excel eller CSV, om det finns tillgängligt utan merarbete. Annars går
> PDF bra.
>
> Bakgrunden är att jag driver ett ideellt hobbyprojekt — en öppen webbapp
> som visar vilka uteserveringar i Malmö som har sol just nu. Uppgifterna
> skulle användas för att visa korrekt information om vilka ställen som
> serverar alkohol.
>
> Om begäran medför en avgift ber jag er återkomma med besked om
> kostnaden innan handlingen expedieras.
>
> Med vänlig hälsning
> Fredrik Asplund

Bra att veta: man har rätt att vara anonym vid begäran om allmän handling,
men här är det enklare att uppge namn eftersom de ska mejla tillbaka en
fil. Avgift tas normalt ut först från och med tionde sidan på papper —
digitalt är det i regel gratis.

Kontaktuppgifter i övrigt: telefon 040-34 55 50 (vardagar 13–15),
besöksadress Fänriksgatan 1 (endast bokade besök), postadress
Arbetsmarknads- och socialförvaltningen, 205 80 Malmö.
