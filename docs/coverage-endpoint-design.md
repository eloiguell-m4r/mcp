# Disseny: endpoint de cobertura de ciutats + homonímia (compartit)

Document de **disseny per valorar** (sense codi encara). Objectiu: centralitzar a l'API la
**cobertura de ciutats** i la **resolució d'homònims** (Córdoba ES/AR…), perquè múltiples
consumidors (MCP, IA de time2desk/chatv2, web, futurs) ho consultin en lloc de duplicar
llistes hardcodejades.

## 1. Problema actual
- El MCP manté un set **hardcodejat** `AMBIGUOUS_CITY_NAMES` (Córdoba, Valencia, Santiago…)
  per decidir quan preguntar el país. Es desactualitza i no és compartible.
- `GET /ai/cities/:city` (motion4rent-api) només coneix **ciutats cobertes** (de `stores` i
  `stores_virtual`): per "cordoba" retorna només la ES (`countries=1`) → els clients assumeixen
  Espanya en silenci. No sap que "Córdoba" també és una ciutat gran a Argentina/Mèxic.
- No hi ha cap endpoint per **llistar** totes les ciutats cobertes (autocompletes, checks).

## 2. Abast
**Inclou:** llista de ciutats cobertes; resolució d'una ciutat per nom amb el seu país; senyal
d'homonímia (encara que l'altra ciutat NO estigui coberta).
**No inclou:** disponibilitat/stock per dates (això és `/search`/`/details`), preus, reserves.

## 3. Arquitectura
- Els endpoints viuen a **`motion4rent-api`** (marca Motion4Rent). Patró replicable a
  `rent4riders-api` per a la seva marca (NO es toca aquí).
- **chatv2 és multi-tenant**: la seva IA cridarà l'API de la marca corresponent segons el tenant
  (motion4rent → motion4rent-api; rent4riders → rent4riders-api). El **contracte JSON és el mateix**.
- Consumidors: **MCP** (aquest repo), **IA time2desk/chatv2**, web, etc.
- Dades **públiques i read-only** (noms de ciutat i països) → sense auth, molt cachejables.

## 4. Endpoints proposats

### 4.1 `GET /ai/coverage/cities`
Llista totes les ciutats on la marca presta servei (per a autocompletes i checks de cobertura).

Query params (opcionals):
- `country` (ISO-2) — filtra per país.
- `locale` — idioma del nom mostrat (default `en`).

Resposta:
```json
{
  "count": 128,
  "cities": [
    {
      "slug": "barcelona",
      "country": "es",
      "name": "Barcelona",
      "name_localized": "Barcelona",
      "lat": "41.3873974",
      "lon": "2.168568",
      "has_physical_store": true,
      "has_virtual_store": true
    }
  ]
}
```
- Origen: `SELECT DISTINCT` de `stores` + `stores_virtual` (país, city_en/es, url slug, c0_city/c1_city).
- Cache: `Cache-Control: public, max-age=3600` (canvia rarament).

### 4.2 `GET /ai/cities/:name` (AMPLIAT — retrocompatible)
Manté el que ja retorna (coincidències cobertes) i afegeix un bloc `homonym`:
```json
{
  "count": 2,
  "countries": 1,
  "places": [ { "country": "es", "city_en": "Córdoba", "url": "cordoba", "lat": "...", "lon": "...", "source": "stores" } ],
  "homonym": {
    "ambiguous": true,
    "countries": ["es", "ar", "mx"],
    "covered_countries": ["es"],
    "note": "Name exists in several countries; only ES is covered."
  }
}
```
- `homonym.ambiguous`: true si el nom apareix a la taula `city_homonyms` (o al gazetteer) amb >1 país.
- `homonym.countries`: tots els països on el nom és una ciutat coneguda (cobrim o no).
- `homonym.covered_countries`: subconjunt que sí cobrim.
- Retrocompatible: els clients actuals que només llegeixen `places` segueixen funcionant.

### 4.3 (Opcional) `GET /ai/coverage/resolve?name=&country=`
Resol una ciutat concreta (nom + país) → coberta o no, amb slug/lat/lon. Útil quan el client ja
sap el país (després de confirmar). Es pot ometre a la v1 (es dedueix de 4.2).

## 5. Taula `city_homonyms` (opció lleugera recomanada)
Font curada dels noms globalment ambigus. Petita i controlada (és on movem el set del MCP).

```
city_homonyms
- id            INT PK
- name_norm     VARCHAR   -- nom normalitzat (minúscules, sense accents): 'cordoba'
- countries     JSON/TEXT -- ["es","ar","mx"]
- note          VARCHAR   -- opcional
- updated_at    TIMESTAMP
```
Exemple:
```
cordoba   → ["es","ar","mx"]
valencia  → ["es","ve"]
santiago  → ["cl","es","do", ...]
guadalajara → ["mx","es"]
merida    → ["mx","ve","es"]
```
Manteniment: l'equip hi afegeix noms quan detecta confusions. Alternativa a futur: substituir per
un **gazetteer (GeoNames)** i calcular l'ambigüitat automàticament (més complet, més manteniment/pes).

## 6. Lògica de resolució (servidor)
1. Normalitza el nom (minúscules, sense accents).
2. Busca coincidències cobertes (stores/stores_virtual) → `places`.
3. Busca el nom a `city_homonyms` → `homonym`.
4. Retorna tots dos. El **client** decideix: si `homonym.ambiguous` i l'usuari no ha donat país →
   confirmar; si no, seguir amb l'única coberta.

## 7. Com ho consumeix el MCP
- **Elimina** `AMBIGUOUS_CITY_NAMES` (hardcodejat) de `tools.ts`.
- `geocodeCity` (o una nova `getCoverage`) crida `/ai/cities/:name` i llegeix `homonym`.
- `search_mobility_rentals`: `confirm_country = homonym.ambiguous && !country`. La resta del flux
  (resum amb país, `resolved_city`, note) igual que ara però amb dada autoritzada.
- Cache al MCP: 30 min (com ara el geocoding).

## 8. Com ho consumeix chatv2 (IA time2desk)
- Mateix contracte. Segons el tenant, apunta a l'API de la marca.
- Casos: "teniu cobertura a X?", desambiguar homònims, autocompletar ciutats en un flux de reserva.
- Evita que cada projecte reimplementi la llista/heurística.

## 9. Rendiment i cache
- Coverage i homonyms canvien rarament → cache HTTP llarg + cache en memòria als clients.
- `/ai/coverage/cities` pot ser una sola query cachejada; `/ai/cities/:name` ja és lleuger.

## 10. Fases proposades
1. **F1** — `city_homonyms` (taula + seed amb el set actual del MCP) i ampliar `/ai/cities/:name`
   amb `homonym`. El MCP passa a llegir-lo (treu el hardcode). *Impacte alt, cost baix.*
2. **F2** — `GET /ai/coverage/cities` (llista) per a autocompletes/checks. chatv2 el consumeix.
3. **F3** (futur, opcional) — substituir la taula per un gazetteer si es vol cobertura global automàtica.

## 11. Alternatives considerades
- **Mantenir hardcode a cada client**: ràpid però es duplica i desactualitza. ❌ no escala.
- **Gazetteer complet ja a la v1**: potent però més pes/manteniment; millor com a F3 si cal.
- **Taula curada + endpoint (aquesta proposta)**: equilibri; centralitza i és reutilitzable. ✅

## 12. Decisions per prendre
- Taula curada vs gazetteer per a l'ambigüitat (recomanat: taula, F1).
- Cal `/ai/coverage/cities` ja ara, o només l'ampliació de `/ai/cities/:name`? (depèn de si chatv2
  vol autocompletes a curt termini).
- Qui manté `city_homonyms` i amb quin criteri d'"ambigu".

## F1 — IMPLEMENTAT (pendent de desplegar)

Fitxers:
- **API** `motion4rent-api/sql/2026-07-13-city-homonyms.sql` — crea `city_homonyms` + seed (idempotent).
- **API** `motion4rent-api/routes/ai.js` — `GET /ai/cities/:city` ara retorna també
  `homonym: { ambiguous, countries, covered_countries }` (try/catch: si la taula no existeix, `homonym: null`).
- **MCP** `src/m4rApi.ts` — `GeocodeResult.homonymAmbiguous` (llegit de `body.homonym.ambiguous`; `null` si l'API no ho dóna).
- **MCP** `src/tools.ts` — `confirm_country = !country && geo.homonymAmbiguous === true`.
  ✅ La llista local `AMBIGUOUS_CITY_NAMES` s'ha **eliminat** (font única = API/`city_homonyms`).

Ordre de desplegament (compatible cap enrere en tot moment):
1. **Migració BD**: executar `sql/2026-07-13-city-homonyms.sql` a la/les BD que llegeix l'API
   (⚠️ si USA i EU són bases **separades** —no rèpliques—, executar-la a **totes dues**).
2. **API**: desplegar `motion4rent-api` (pipeline habitual). Verificar:
   `curl https://…/ai/cities/cordoba` → `body.homonym.ambiguous = true`.
3. **MCP**: desplegar (git pull + build + restart). A partir d'aquí usa el senyal de l'API;
   el fallback local només actua si `homonym` ve `null`.
4. ✅ FET — `AMBIGUOUS_CITY_NAMES` tret del MCP; la font única és l'API/`city_homonyms`.

Manteniment: afegir noms nous és un `INSERT ... ON DUPLICATE KEY UPDATE` a `city_homonyms` (cap desplegament de codi).

## Relacionat
- MCP homonímia (fallback): `AMBIGUOUS_CITY_NAMES` a `src/tools.ts`.
- Endpoint: `motion4rent-api/routes/ai.js` (`GET /cities/:city`).
- Migració: `motion4rent-api/sql/2026-07-13-city-homonyms.sql`.
