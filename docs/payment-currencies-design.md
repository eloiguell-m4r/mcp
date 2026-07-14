# Disseny: monedes de PAGAMENT del client — font única (compartida)

Document de **disseny per valorar** (sense codi encara). Objectiu: centralitzar en un sol lloc
les **monedes en què el client final pot pagar** (EUR, USD, GBP, CNY, JPY) perquè web, MCP i la
IA de time2desk/chatv2 les consultin des d'una única font, i deixar de barrejar-les amb les
monedes de tarifa/proveïdor.

## 1. Problema actual
Hi ha DOS conceptes de moneda que ara es barregen:
- **Moneda de tarifa / proveïdor**: en què el proveïdor posa preus i M4R el paga (per supplier/
  store; p. ex. JPY). Ja existent.
- **Moneda de PAGAMENT del client**: les que el web permet triar per pagar → **EUR, USD, GBP, CNY, JPY**.

No hi ha cap repositori/enum únic per a les de pagament:
- Al **web** estan **hardcodejades i duplicades**: `$_currencyOrder = ['EUR','USD','GBP','CNY','JPY']`
  a `module/Application/view/layout/layout.phtml` (×2) i `layout/checkout.phtml`, més els símbols
  `$_liLabels`. La lògica de **decimals** (`=== 'JPY' ? 0 : 2`) apareix duplicada a desenes de vistes/
  controllers del Backend. `CurrencyHelper::currencyForCountry()` mapeja país → moneda per defecte.
- El **MCP** llegeix un set DIFERENT: `GET /exchange/rates-to-eur` retorna **7** monedes amb tipus
  de canvi (`AUD, CNY, EUR, GBP, JPY, NZD, USD`). Per tant `list_currencies` ofereix **AUD i NZD**,
  que el client **NO pot pagar** al web. ← bug/confusió actual.

## 2. Abast
**Inclou:** definició única del conjunt de monedes de pagament + el seu **símbol**, **label**,
**decimals** i **ordre**. Endpoint per consultar-les. Consum per web, MCP, chatv2.
**No inclou:** els **tipus de canvi** (segueixen a `/exchange/rates-to-eur`); la moneda de
proveïdor/tarifa (per supplier/store, un altre eix); la lògica país→moneda per defecte
(`currencyForCountry`) — es pot migrar després (F2 opcional).

## 3. Arquitectura
- **Font de veritat: una taula a la BD** (`payment_currencies`), a la BD de la marca
  (motion4rent). El web la llegeix directament (mateix MySQL); l'API l'exposa per als
  consumidors externs (MCP, chatv2).
- **Per marca**: taula + endpoint a `motion4rent-api`; patró replicable a `rent4riders-api`
  (NO es toca aquí). chatv2 (multi-tenant) crida l'API de la marca del tenant.
- Dades **públiques i read-only** → sense auth, molt cachejables.

## 4. Taula `payment_currencies`
```
payment_currencies
- code       VARCHAR(3)  NOT NULL   -- 'EUR','USD','GBP','CNY','JPY'  (PK)
- symbol     VARCHAR(8)  NOT NULL   -- '€','$','£','¥','¥'
- label      VARCHAR(40) NOT NULL   -- 'Euro', 'US Dollar', ...
- decimals   TINYINT     NOT NULL   -- 2 (o 0 per JPY)
- sort_order INT         NOT NULL   -- ordre al selector (EUR primer)
- active     TINYINT(1)  NOT NULL DEFAULT 1
- updated_at TIMESTAMP
- PRIMARY KEY (code)
```
Seed inicial:
```
EUR  €  Euro         2  1
USD  $  US Dollar    2  2
GBP  £  Pound         2  3
CNY  ¥  Yuan          2  4
JPY  ¥  Yen           0  5
```
Centralitza 3 coses avui duplicades: **quines** monedes, el **símbol/label**, i els **decimals**.
Afegir/treure una moneda o activar/desactivar-la = un UPDATE/INSERT, sense desplegar codi.

## 5. Endpoint `GET /exchange/payment-currencies`
(al costat de `/exchange/rates-to-eur`, a `motion4rent-api/routes/exchange.js`.)
```json
{
  "currencies": [
    { "code": "EUR", "symbol": "€", "label": "Euro",      "decimals": 2, "sort_order": 1 },
    { "code": "USD", "symbol": "$", "label": "US Dollar",  "decimals": 2, "sort_order": 2 },
    { "code": "GBP", "symbol": "£", "label": "Pound",      "decimals": 2, "sort_order": 3 },
    { "code": "CNY", "symbol": "¥", "label": "Yuan",       "decimals": 2, "sort_order": 4 },
    { "code": "JPY", "symbol": "¥", "label": "Yen",        "decimals": 0, "sort_order": 5 }
  ]
}
```
- Origen: `SELECT ... FROM payment_currencies WHERE active = 1 ORDER BY sort_order`.
- Cache: `public, max-age=3600` (canvia rarament) + cache en memòria als clients.

## 6. Com ho consumeix cada projecte
- **Web**: substitueix `$_currencyOrder`/`$_liLabels` hardcodejats per una lectura de la taula
  (helper/model petit; el web ja parla amb el mateix MySQL). Els **decimals** de formatació surten
  de `decimals` (s'elimina el `=== 'JPY' ? 0 : 2` escampat).
- **MCP** (`src/m4rApi.ts`): `getActiveCurrencies()` passa a cridar `/exchange/payment-currencies`
  (en lloc de `/exchange/rates-to-eur`). Així `list_currencies` i les validacions de moneda a
  `search`/`get_rental_details`/`create_booking` només accepten les **5 pagables**. La **conversió**
  (`getExchangeRate`) segueix usant `/exchange/rates-to-eur` (allà hi ha els tipus). El client MCP
  també pot usar `decimals` per arrodonir correctament.
- **chatv2 (IA)**: mateix endpoint, per marca del tenant, quan necessiti oferir/validar monedes.

## 7. Formatació (decimals)
El `decimals` de la taula és la font per arrodonir/mostrar imports (JPY sense decimals, la resta 2).
El web, el MCP i chatv2 l'usen igual → formatació consistent i fi de la lògica duplicada.

## 8. Compatibilitat i seguretat
- Endpoint nou i additiu (no toca `rates-to-eur`). Retrocompatible.
- Mentre el MCP no s'actualitzi, seguiria usant `rates-to-eur` (com ara). En desplegar el canvi,
  passa a oferir només les pagables.
- Read-only i públic (noms/símbols de moneda, no dada sensible).

## 9. Fases
1. **F1** — taula `payment_currencies` (+ seed) + endpoint `GET /exchange/payment-currencies`.
   MCP: `getActiveCurrencies` → nou endpoint (ofereix només les 5). *Impacte alt, cost baix.*
2. **F2** — web deixa de hardcodejar (`$_currencyOrder`/`$_liLabels` i decimals → taula).
3. **F3** (opcional) — moure `currencyForCountry` (país→moneda per defecte) a dades (columna o taula).

## 10. Alternatives considerades
- **Enum/constant al codi de cada projecte**: ràpid però es duplica (és el que ja passa). ❌
- **Config JSON a l'API**: millor que hardcode a cada client, però canviar-la vol desplegar. Acceptable
  si es prefereix no tocar BD; perd l'edició sense deploy.
- **Taula + endpoint (aquesta proposta)**: centralitza codi+símbol+decimals+ordre, editable sense
  deploy, mateix patró que `city_homonyms`. ✅

## 11. Decisions per prendre
- Taula vs config a l'API (recomanat: taula).
- Migrar ja el web (F2) o només MCP a curt termini (F1) i el web després.
- Incloure `currencyForCountry` a dades ara o deixar-ho per F3.

## F1 — IMPLEMENTAT (pendent de desplegar)

Fitxers:
- **API** `motion4rent-api/sql/2026-07-13-payment-currencies.sql` — taula `payment_currencies` + seed (idempotent).
- **API** `motion4rent-api/routes/exchange.js` — endpoint `GET /exchange/payment-currencies`
  (llegeix la taula; try/catch → si no existeix, retorna `DEFAULT_PAYMENT_CURRENCIES`, les 5).
- **MCP** `src/m4rApi.ts` — `PaymentCurrency` + `getActiveCurrencies()` ara crida
  `/exchange/payment-currencies` i retorna `{code,symbol,label,decimals}[]`. Si l'endpoint falla
  (API no desplegada), retorna les 5 per defecte (**mai error**).
- **MCP** `src/tools.ts` — `list_currencies` mostra `símbol + code` i diu "pay in".

Ordre de desplegament (compatible cap enrere en cada pas):
1. **Migració BD**: executar `sql/2026-07-13-payment-currencies.sql` (EU replica a USA). ⚠️ Executar
   amb client **utf8mb4** perquè els símbols `€ £ ¥` es desin bé.
2. **API**: desplegar `motion4rent-api`. Verificar: `curl …/exchange/payment-currencies` → 5 monedes.
3. **MCP**: desplegar. Fins llavors ja funciona amb els defaults (no dóna AUD/NZD).

Manteniment: afegir/treure/activar una moneda = `INSERT/UPDATE` a `payment_currencies` (sense desplegar codi).

## F2 — IMPLEMENTAT (web deixa el hardcode)

Fitxers (`motion4rent-web`):
- **`module/Application/src/View/Helper/PaymentCurrencies.php`** (nou) — view helper que crida
  `GET /exchange/payment-currencies` via `CallApi` (**cache Redis 1h**, memo per-request) i retorna
  `['order'=>[...], 'labels'=>['EUR'=>'€ EUR',...], 'decimals'=>[...]]`. Fallback a les 5 si l'API falla.
- **`module/Application/config/module.config.php`** — registrat a `view_helpers` (factory + alias `paymentCurrencies`).
- **`view/layout/layout.phtml`** i **`view/layout/checkout.phtml`** — s'han substituït els
  `$_currencyOrder = [...]` i `$_liLabels = [...]` hardcodejats per `$this->paymentCurrencies()['order']`
  / `['labels']`. La lògica de reordre per `$_optimalCurrency` es manté.

Notes:
- Segur de desplegar sol: amb el fallback, el web mostra les 5 encara que l'endpoint no hi sigui.
- `symbolCurrency` (icones SVG) i `CurrencyHelper::currencyForCountry` (país→moneda per defecte) NO
  s'han tocat: són presentació / F3.

## F3 (pendent, opcional)
- Moure `currencyForCountry` (país→moneda per defecte) a dades (columna/taula) si es vol centralitzar també això.

## Relacionat
- Patró equivalent: `docs/coverage-endpoint-design.md` (city_homonyms).
- MCP monedes: `getActiveCurrencies`/`getExchangeRate` a `src/m4rApi.ts`.
- Web (hardcode actual): `module/Application/view/layout/{layout,checkout}.phtml`, `View/Helper/CurrencyHelper.php`.
- API: `motion4rent-api/routes/exchange.js` (`/exchange/rates-to-eur`).
