# Cobertura de ciutats properes (MCP + reutilitzable per webs/ia)

Resol el missatge recurrent: *"No tinc cap eina per llistar ciutats properes amb cobertura — només puc comprovar ciutats concretes"*. Ara l'MCP pot, donada una ciutat (tingui cobertura o no), retornar les ciutats **cobertes més properes** i la llista de cobertura per país.

## Decisions
- **On:** endpoint read-only a **motion4rent-api** (no motion4rent-web). És una lectura de negoci → font única, desplega a la rèplica read-only de Virgínia, i el reutilitza igual el projecte `webs/ia`.
- **Coordenades d'origen:** les passa el **caller** (Claude/IA sap la lat/lon aproximada d'una ciutat gran). L'API NO geocodifica ciutats sense cobertura → sense dependència de Google.

## Canvis fets

### motion4rent-api — `GET /ai/cities/nearby` (`routes/ai.js`)
Params: `lat`, `lon` (obligatoris), `country` (opc.), `radius` (default 60, màx 300 km), `limit` (default 40, màx 100).
Resposta: `{ origin:{lat,lon}, radius_km, count, places:[{country, city_en, city_es, url, lat, lon, distance_km, stores}] }`.
- Distància amb `ST_Distance_Sphere` (mateixa fórmula que el buscador de prod).
- ⚠️ **Convenció: `c0(_city)`=LATITUD, `c1(_city)`=LONGITUD** — confirmat a `routes/search.js` (`POINT(c1_city, c0_city), POINT(lon, lat)`). El haversine de `/landings_nearby_places` té c0/c1 intercanviats (bug) → **no s'ha replicat**.
- Cobertura = `stores.status=1` o `stores_virtual.deleted_at IS NULL` (igual que `/ai/cities`).
- Dedup per país+ciutat, distància mínima, compta botigues, ordena i talla a `limit`.

### webs/mcp
- `src/m4rApi.ts`: `nearbyCitiesWithCoverage(apiBase, lat, lon, {country,radius,limit})` (no cachejat) i `listCoverageCities(apiBase, {country})` (reutilitza `/statics/city-slug-map`, cachejat 30 min).
- `src/tools.ts`: dues tools noves —
  - **`find_nearby_cities_with_coverage(city, lat, lon, radius_km?, country?)`** — instrueix el client a passar la lat/lon de la ciutat; retorna les ciutats cobertes properes; recorda que el lliurament a la ciutat NO coberta no està disponible (dóna canals de contacte).
  - **`list_coverage_cities(country?)`** — llista ciutats cobertes (agrupades per país).
  - `check_city_coverage`: descripció ampliada perquè, si la ciutat no té cobertura, cridi la tool de properes.

## Verificació

### 1. API (executar a l'entorn amb accés a BD)
```
GET /ai/cities/nearby?lat=53.55&lon=9.99&country=de&radius=300   # Hamburg
GET /ai/cities/nearby?lat=53.55&lon=9.99&radius=300              # sense filtre de país
GET /statics/city-slug-map                                       # ja existent (list_coverage_cities)
```
Esperat: ciutats alemanyes cobertes amb `distance_km` creixent i `stores>0`.

Validació ràpida del SQL/convenció sense arrencar tota l'API (bloquejada al sandbox local; executar a l'entorn):
```
node docs/../../../scratchpad/test-nearby.js   # o copiar el script; compara convenció correcta vs intercanviada
```
(El bloc "SWAPPED" del script ha de donar distàncies absurdes → confirma que la nostra convenció és la bona.)

### 2. MCP
```
npm run build   # OK (sense errors tsc)
```
Provar via stdio/HTTP: `find_nearby_cities_with_coverage` amb coords d'Hamburg → properes cobertes; `list_coverage_cities({country:'de'})`.

### 3. E2E conversacional
"Estic a Hamburg, on puc llogar a prop?" → l'assistent passa coords → llista real (ja no improvisa Berlín/Bremen sense confirmar).

## Pendent
- Validar empíricament contra `m4r_test2` + desplegar l'API a la rèplica de Virgínia.
- (Opcional futur) que `webs/ia` cridi el mateix `/ai/cities/nearby`.
