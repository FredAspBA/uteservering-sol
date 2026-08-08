# Overture-höjdvalidering — design

**Datum:** 2026-08-08
**Status:** Godkänd, redo för implementationsplan
**Relaterat:** `PLAN-datakvalitet.md`, fas 4

## Syfte

Fas 4 i `PLAN-datakvalitet.md` föreslår att hämta riktiga byggnadshöjder
från Overture Maps och lägga dem ovanpå OSM:s (som saknar höjd för ~80 %
av byggnaderna och idag gissas via typmedian → grannskapsmedian → 15 m,
se fas 1). Innan vi bygger in det i produktionspipelinen
(`refresh-data.yml`) validerar vi om Overture-höjder faktiskt slår
nuvarande gissningsmodell — annars är det bortkastat arbete.

Till skillnad från osmium (som inte gick att installera i
utvecklingsmiljön under fas 3) finns nätverk och Python 3.12 tillgängligt
här, så detta kan testas live mot riktig data snarare än byggas blint.

## Omfattning

**Ingår:** ett fristående experimentscript som mäter matchningsgrad och
träffsäkerhet. Inga sidoeffekter på riktiga datafiler
(`data/buildings.geojson` etc.) eller på `refresh-data.yml`.

**Ingår INTE:** produktionsintegrationen (DuckDB-steg i workflowet,
`data/heights-overture.json`, ändringar i `shadow.js`). Den specas separat
om valideringen visar att Overture är värt att bygga in.

## Dataflöde

1. **Hämta Overture-byggnader för Malmö-bbox.** DuckDB med `httpfs`- och
   `spatial`-extensions läser Overtures publika `buildings`-tema-parquet
   direkt från S3 (`s3://overturemaps-us-west-2/release/.../theme=buildings/`),
   filtrerat på samma bbox som `fetch-data-geofabrik.js` använder för
   Malmö. Overtures schema har bbox-kolumner gjorda för predicate
   pushdown, så bara en bråkdel av den globala parquet-filen faktiskt
   läses.
2. **Extrahera** `id`, `height`, `sources` (innehåller ofta
   OSM-referenser i formatet `dataset=OpenStreetMap`,
   `record_id=<typ>/<osm-id>`) och centroid per Overture-byggnad.
3. **Matcha mot OSM-byggnader** i `data/buildings.geojson`:
   - **Primärt:** OSM-id extraherat ur Overtures `sources`-fält, mot
     `@id`/OSM-id i vår data.
   - **Sekundärt** (om inget id-match): centroid-närhet inom några meter
     (samma `centroid()`-hjälpare som redan finns i
     `height-experiment.py`/`impact-experiment.py`).
4. **Hold-out-validering**, samma teknik som `height-experiment.py`: ta de
   OSM-byggnader som redan HAR känd höjd (`height`/`building:levels`),
   låtsas att de är okända, och jämför tre strategier på exakt samma
   hold-out-set:
   - nuvarande modell (typmedian → grannskapsmedian)
   - Overture-höjd (bara för de byggnader som fick en matchning)
   - platt 15 m-fallback (referenspunkt, redan i `height-experiment.py`)
5. **Rapportera:**
   - matchningsgrad: andel av OSM-byggnaderna (i hold-out-setet) som fick
     en Overture-matchning alls
   - MAE (medelabsolutfel) och median-absolutfel per strategi, i meter
   - uppdelat på id-match vs. centroid-match, om skillnaden är stor nog
     att vara intressant

## Beslutsregel

- Om Overture-MAE **slår** nuvarande modell **och** matchningsgraden är
  hög nog att påverka en meningsfull andel byggnader → gå vidare med en
  ny spec för produktionsintegrationen (DuckDB-steg i workflowet).
- Om Overture inte slår nuvarande modell, eller matchningsgraden är för
  låg för att spela roll → dokumentera resultatet i
  `PLAN-datakvalitet.md` fas 4 och stäng den fasen utan att bygga
  pipelinen.

## Felhantering

- Om S3-anropet mot Overture failar (nätverk, ändrat schema/release-path)
  ska scriptet ge ett tydligt felmeddelande och avsluta — inget att falla
  tillbaka på här, det är ett engångsexperiment, inte produktionskod.
- Om `sources`-fältets format skiljer sig från det dokumenterade
  (`dataset=OpenStreetMap`, `record_id=...`) hanteras det defensivt: räkna
  det som "inget id-match", fall tillbaka till centroid-matchning, logga
  hur många rader det gällde.

## Testning

Manuell körning och granskning av output (matchningsgrad + MAE-siffror) —
samma sorts verifiering som `height-experiment.py` redan fick i fas 1.
Inga automatiska tester: det är ett engångsexperiment vars enda konsument
är den här sessionens beslut, inte kod som körs igen.
