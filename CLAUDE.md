# webs/mcp — Servidor MCP de Motion4Rent

## Què és
Servidor **MCP (Model Context Protocol)** que exposa el lloguer de mobilitat de Motion4Rent com a **connector de Claude** i **app de ChatGPT**. Node/TS/ESM, `@modelcontextprotocol/sdk` 1.29, express 5, zod v3.

El "cervell" conversacional és el client (Claude/ChatGPT) — aquestes tools són **primes**: criden l'API pública i construeixen deep-links. **NO usen Bedrock ni l'orquestrador `webs/ia`** (evita el doble-LLM; una única font de veritat de negoci = l'API).

Tenant pilot: **motion4rent**. La maquinària és comuna i es replicarà a **rent4riders** (veure «Multi-tenant» a baix).

## Arquitectura
```
Usuari a Claude/ChatGPT (ha afegit el connector)
   └─HTTPS JSON-RPC→ /mcp (aquest servidor, Node natiu)
        ├─ LECTURA  → motion4rent-api  /ai/cities, /search/results, /details   (read-only)
        └─ deep-link→ web pública (WEB_BASE_URL)  → l'usuari completa i PAGA al web
```

- **Transports:** `stdio` (dev) + **Streamable HTTP** stateless (`POST /mcp`, `GET /health`); auth bearer opcional (`MCP_AUTH_TOKEN`). Stateless → escalable horitzontalment.
- **Tools (read-only, avui):**
  - `check_city_coverage` — cobertura + desambiguació de país (homònimes).
  - `search_mobility_rentals` — ciutat+dates → productes amb preu + `booking_link` (deep-link a resultats amb `start/end/lat/lon/name/url` + hash `#typeProd:`).
  - `get_rental_details` — detall normalitzat d'un producte (`/details`).
  - `mobility_policies` — FAQ/polítiques (dataset curat, text ES verbatim del corpus RAG de `webs/ia`; param `language` → el client tradueix).
  - `list_currencies` — monedes actives (dinàmic, de `/exchange/rates-to-eur`) perquè l'assistent demani a l'usuari en quina moneda vol preus/reserva.
  - `list_product_options` — opcions/extres d'un producte (de `/details/options/{id}`) per oferir-les abans de reservar (`id` → `create_booking.options_id`).
  - `create_booking` *(Fase 3A, opcional)* — crea el `hold` + retorna `urlTpv` de Stripe. **Només recollida a botiga, sense extres.** Registrada NOMÉS si `M4R_CHECKOUT_BASE_URL`+`M4R_CHECKOUT_SECRET` estan definits; si no, booking deshabilitat (només descoberta + deep-link).
  - **Moneda:** `search_mobility_rentals`, `get_rental_details` i `create_booking` accepten `currency` opcional (una de `list_currencies`); el preu es converteix/recalcula **al servidor** (mai al caller). Detall a «Selecció de moneda».

## PREU (crític — no infravalorar)
- **El preu que cobra la reserva = `/details.total`** = base (`totalWithOutExtra`) + `feeGestionM4R` (**9€ fix** + `store.extra_fee`) + `extraM4R` + `extraSup`. Ho confirma el booking (559→10, 8621→19) i coincideix amb el web checkout (payAction).
- **`get_rental_details.price.total` usa `d.total`** (amb fees), NO `totalWithOutExtra`. `d.total ≥ booking` sempre (el descompte només abaixa) → mai infravalora.
- **`search` enriquida:** ara la cerca fa `getDetails` per producte (fins a 10) i mostra `details.total` (= booking = web checkout) + el **model** (brand+model). Així search = detall = booking. (El `managementFeeEur` queda com a fallback si /details falla.)
- **Recàrrec de dia festiu (`closed_service`) — CRÍTIC:** si la recollida/tornada/lliurament cau en dia festiu de la botiga, s'aplica `closed_price` (va a `totalWithOutExtra` de /details → l'agafa el builder). La **cerca** el detecta i posa `pickup_closed_service`/`delivery_closed_service`=1; el flux headless els ha de **transportar** a `/details` i al booking (si no, el `/ai/checkout` passava `closed_service=0` → **infravalorava**). Fix (opció B): `searchResults` captura els flags → `get_rental_details`/`create_booking` els reben (params `pickup_closed_service`/`delivery_closed_service`) → `getDetails` els posa a la URL i `AiCheckoutController` a la seva crida `/details`. **Verificat: 14183 booking amb flag → 104 (abans 84).** ⚠️ L'assistent ha de reenviar els flags de search→details→booking (instruït a les notes). El **web normal NO tenia aquest bug** (el datepicker ja passa els flags); era només el flux headless.
- ⚠️ Botigues virtuals: el lliurament ja va inclòs a la tarifa base (`totalWithOutExtra`); NO sumar-lo a part.
- ⚠️ **NO deixar que l'assistent estimi el preu:** les notes de search/details diuen "quote 'total' as-is; do NOT add/estimate fees". (Bug observat: amb la nota antiga "base, suma ~9€", l'assistent improvisava i mostrava un preu diferent —"des de 95€"— del detall —84€.) La constant 9€ ha de coincidir amb `motion4rent-api/routes/details.js` (feeGestionM4R).

## Convencions de sortida de les tools (UX, revisat amb proves reals)
- **Idioma dels títols/descripcions de tools: ANGLÈS.** El diàleg de permisos del client mostra el `title`/description tal qual (no els tradueix) → en anglès (neutre); l'LLM ja tradueix el CONTINGUT a l'idioma de l'usuari. NO posar títols/descripcions en català.
- **Fotos:** només `image_url` (CloudFront). ⚠️ **Claude Desktop NO pot mostrar fotos inline al xat des d'un MCP** (confirmat): les URL externes demanen clic ("Mostrar imagen", privacitat) i els content-blocks d'imatge base64 queden amagats a l'acordió de la crida de tool (el model els veu, l'usuari no). Per això NO es fa servir base64 (només inflava payload). S'instrueix l'IA a presentar la foto com a markdown clicable `![nom](image_url)` → l'usuari la veu amb un clic. Galeries reals: al web (booking_link).
- **Marca:** els resultats porten `provider: "Motion4Rent"` i els resums diuen "Motion4Rent té…" (que quedi clar qui ofereix el lloguer).
- **Mai IDs interns a l'usuari:** `id_store`/`id_product_store` són per a crides entre tools, NO per mostrar. Les tools instrueixen l'assistent a referir-se a la botiga pel **nom** + **`map_url`** (Google Maps via `place_id`) i als productes pel nom + `image_url`.
- **Fotos:** `image_url` (CDN CloudFront `PRODUCT_IMAGE_BASE`, default `https://d3alzpqy0fqlq2.cloudfront.net/products/cache/w800`) a search i details.
- **Delivery real:** `get_rental_details` només llista els `delivery_options` que el producte ADMET (flags `details.delivery>0` domicili/hotel, `details.cruises>0` creuer, `details.airport_delivery>0` aeroport) — NO segons el preu. El web (`/ai/checkout`) rebutja amb 400 `delivery_type_not_available` si el tipus no és disponible. ⚠️ El preu de lliurament pot ser 0 (gratis) i estar disponible igualment.
- **Botigues VIRTUALS (`id_virtual>0`):** SÍ ofereixen lliurament, però **gratis** (preu 0), igual que payAction L1615 (`delivery_price` només si `id_virtual==0`). NO rebutjar-les. `get_rental_details` mostra el delivery a 0 per a virtuals; el web cobra 0. (Bug corregit: abans es rebutjaven amb `delivery_not_available`.)
- `get_rental_details` retorna en UNA crida: producte+foto, preu+fiança, botiga+mapa, delivery_options disponibles, i opcions/extres.

## Fitxers
- `src/config.ts` — env: `MCP_TRANSPORT`, `PORT`, `MCP_AUTH_TOKEN`, `M4R_API_BASE_URL`, `WEB_BASE_URL`, `TENANT`, `PRODUCT_IMAGE_BASE`, i (Fase 3A) `M4R_CHECKOUT_BASE_URL` + `M4R_CHECKOUT_SECRET`.
- `src/deeplink.ts` — contracte d'URL del web (slugs per idioma + query + `#typeProd:`). Rèplica del que fan `webs/ia` i `cron/sitemap.php`.
- `src/m4rApi.ts` — client HTTP (`geocodeCity`, `searchResults`, `getDetails`+`normalizeDetails`). Timeouts: SEARCH/DETAILS 25 s, default 8 s.
- `src/tools.ts` — registre de les 4 tools.
- `src/knowledge/policies.ts` — 11 polítiques (font: corpus RAG de `webs/ia`).
- `src/server.ts` — `buildServer`, `runStdio`, `runHttp`.
- `docs/desplegament.md` — desplegament **sense Docker**.

**Detall important de `/details` (verificat contra prod):** `data[0]` és la BOTIGA+tarifa; **`data[0].details` és el PRODUCTE**. `normalizeDetails` pren `name/type` de `details`, `deposit` de `data[0].bail`. Les specs (pes/autonomia) **NO** venen a `/details` (viuen a `/products/load`).

## Desplegament i col·locació (DECISIÓ)
**Sense Docker.** Procés Node supervisat amb **systemd** (recomanat) o pm2, darrere reverse proxy HTTPS (`mcp.motion4rent.com` → `127.0.0.1:8787`). Detall a `docs/desplegament.md`.

**Infra (3 servidors):** Irlanda = webs+chatv2+**motion4rent-api CRUD** (primari, escriptures); Virgínia (USA) = webs + **motion4rent-api read-only** (rèplica); un tercer = `webs/ia` (Bedrock, **irrellevant** per al MCP).

**On va el MCP — DECIDIT: Virgínia (rèplica read-only):**
- **LECTURA** (`/ai/cities`, `/search/results` ~12 s, `/details`) → **rèplica read-only de Virgínia** (aïlla la càrrega de cerca del CRUD). MCP: `M4R_API_BASE_URL` = API local de Virgínia.
- **ESCRIPTURA** (booking `hold`, `/order`) → el web crida la **API LOCAL** (localhost); l'INSERT viatja al **primari d'Irlanda a nivell de BD** via `REGION_CUD_CONNECTION_URL` (`motion4rent-api/lib/mysqlRegionRouting.js`, default EU) — el mateix mecanisme que `payAction`. **No hi ha crida HTTP cross-regió** (descartat `M4R_API_WRITE_URL`), per tant cap concern de VPN/IP nou; la connexió Virgínia→RDS-Irlanda ja existeix per a tota escriptura de l'API. Cap d'aquestes crides passa per Cloudflare (web→API internes). Detall a `docs/fase-3a-booking-plan.md` §11.

## Context estratègic — iniciativa GEO → booking (multi-projecte)
Objectiu: (1) que Claude/ChatGPT **destaquin** els productes quan els usuaris pregunten (descoberta orgànica); (2) **guiar a reservar** i acabar amb link de pagament Stripe (reserva `hold` que el webhook existent confirma).

**Mapa de fases (què s'ha fet, a quin projecte):**
| Fase | Projecte | Què | Estat |
|---|---|---|---|
| 1 — GEO orgànic | `motion4rent-web` | robots.txt (bots IA), llms.txt, `ai-catalog.json` (via `cron/sitemap.php`), FAQPage a `/faq`, FAQ a guies (Landings). Cloudflare `verifBots` allowlist. | ✅ Desplegat |
| 2 — Conversa guiada | `webs/ia` | `buildLink` amb `lat/lon/name/url` + hash `#typeProd:` (ciutat→dates→disponibilitat→enllaç robust a resultats). | ✅ Desplegat |
| 3/E — MCP descoberta | `webs/mcp` | Aquest servidor: 4 tools read-only + deep-link. **No crea comanda ni cobra.** | ✅ Bastit, pendent desplegar |
| 3A — Booking acotat | `motion4rent-web` (+ `webs/mcp`) | **PRÒXIM.** Veure sota. | ⏳ A fer |

## Booking headless — opció A ACOTADA (direcció acordada)
**Es fa booking aviat, amb aquestes condicions que eliminen el risc financer:**
- **Recollida a botiga** (sense lliurament → sense cost/suplement de delivery a calcular).
- **Sense extres** de checkout (→ sense preus d'add-ons).
→ El preu es col·lapsa a la **tarifa base del rang de dates**, que el servidor ja calcula.

**Per què cal l'acotament:** `POST /order` (motion4rent-api) **es fia del payload** per a `total/comission/comission_total/pay/supplier_payment/extraM4R`. Amb recollida-a-botiga + sense extres, no hi ha imports "compostos"; queda només la tarifa base.

**Regla de seguretat innegociable:** el **preu i les comissions es recalculen SEMPRE al servidor** (via `/details` / servei compartit), **mai** es confien del caller MCP. Camí previst:
```
MCP → POST /ai/checkout (web PHP, protegit amb secret) → reusa la lògica de payAction
    → assembla $data state="hold" → POST /order (CRUD Irlanda) → StripeService → urlTpv
El webhook checkout.session.completed existent confirma hold→accept SENSE canvis.
```
- **Refactor clau (no duplicar):** extreure de `CheckoutController::payAction()` (a) assemblatge de `$data` i (b) creació de Stripe session a un **servei compartit** que cridin el formulari web i el nou `/ai/checkout`.
- Marcar holds d'origen IA; reusar `cron/delete-old-holds.php` (finestra curta) per alliberar-los.
- El MCP guanya una tool tipus `crear_reserva_i_pagament` → retorna `urlTpv`. Fins llavors, es manté el deep-link (opció E).

**Pla detallat i decisions:** `docs/fase-3a-booking-plan.md` (grounded en el codi real). Decisions preses: **prepagament = % real del supplier** (`/details.prepayment`, p. ex. 15 % dipòsit online + resta a botiga) amb **`hasDeferredPayments=0` sempre** (⚠️ «sense diferit» ≠ «pagar 100 %»; excloure suppliers `hasDeferredPayments=1` → fallback deep-link), **`pending_confirm` acceptat** (la botiga confirma després del pagament; l'assistent hi avisa), endpoint al **web PHP** (`POST /ai/checkout` amb secret), preu **recalculat via `/details`**. ⚠️ **NO es toca `payAction`** (descartat el refactor pel risc de regressió al checkout en producció): l'acotament + `/details` fan que el cas headless sigui petit → **builder aïllat `AiOrderDataBuilder`** + test read-only que compara els seus imports amb els de `payAction`. Ordre: (1) `AiOrderDataBuilder` + test comparació, (2) `/ai/checkout`, (3) tool MCP, (4) e2e Stripe TEST, (5) desplegar. **Estat: 1-3 FETS** (web: `AiOrderDataBuilder`+test 3/3, `AiCheckoutController`+factory+ruta; mcp: `createBooking`+tool `create_booking`). **Pendent: (4) e2e en staging + Stripe TEST** (guió: `docs/fase-3a-proves-e2e.md`) — validar contracte de camps de `/order` i font de `bail`.

## Selecció de moneda (FET) i localització de FAQ
**Moneda dinàmica (implementat).** Les tools demanen/accepten la moneda i el servidor recalcula:
- Font dinàmica de monedes = taula `exchange_rates` via **`/exchange/rates-to-eur`** (si demà s'afegeix una moneda, apareix sola; res hardcodejat). NO és `PlatformCurrencies` (aquella és per pagar proveïdors).
- Tool **`list_currencies`** → llista dinàmica; l'assistent la usa per demanar a l'usuari en quina moneda vol preus/reserva.
- `search_mobility_rentals` i `get_rental_details` tenen `currency` opcional → converteixen els preus amb el **`rate`** de `/exchange/{from}/{to}/1` (mateix que el web a `exchange()`). La **fiança NO es converteix** (es reté en moneda del proveïdor; `get_rental_details` ho marca amb `deposit_currency` + `price_note`).
- `create_booking` té `currency` opcional → s'envia a `/ai/checkout`, que **valida** (moneda activa, si no 400 `currency_not_supported`) i **converteix server-side** (`AiCheckoutController`): imports `totalWithOutExtra/extraM4R/feeGestionM4R/extraSup` × rate; `bail` i % NO; `currencyChange`/`currencyChangeSupplier` amb `rateReal` (exchangeReal), `storeCurrency`=moneda producte, `customerCurrency`=demanada. Port fidel de `payAction`; **el builder NO es toca**.
- **Verificat e2e (Docker local, Sevilla supplier id=1):** EUR base total=10; USD total=12.22 (×1.222166); hold BD `currency_customer=USD`, `currency_supplier=EUR`, `currecy_change_to_eur=0.86`; moneda no activa → 400. ⚠️ **Pendent: re-provar en STAGING + Stripe TEST amb pagament real** (Stripe cobra en la moneda demanada) abans de LIVE.

**FAQ / `mobility_policies`:** té paràmetre `language` (el text font és 'es', s'instrueix el client a traduir-lo a aquest idioma). Millora futura opcional: centralitzar via endpoint **`/ai/faq`** a motion4rent-api amb textos ja localitzats (evita duplicar `policies.ts` i la dependència de la traducció del client).

**Opcions/extres a la reserva (FET, pendent e2e pagament).** Es poden afegir opcions triables (reposapeus, cistella…) a la reserva. Segur: el preu de l'opció el posa el servidor per ID (com la moneda; el caller només envia `options_id`).
- **Descoberta:** endpoint existent `GET /details/options/{id_product_store}` (cap canvi API) → tool MCP **`list_product_options`** (`[{id, name, price, price_basis: fix|per_dia}]`).
- **Reserva:** `create_booking` accepta `options_id: number[]`. El web (`AiCheckoutController`) carrega cada opció per ID (`fetchOption` → `/options/product/.../option/{id}/store/...`; inexistent → 400 `option_not_available`), converteix el preu amb el `rate`, suma `type==1` fix / else `× dies`, i passa `$optionsTotal` al builder (4t param) → sumat a `$total` abans del bloc de fees (comissionat com payAction), **fora de `priceProduct`**. `/order` persisteix via `body.options` (order.js:990, `sales_order_item` type=1 / typeOpt=price-type).
- **Verificat e2e (Docker local):** base 10 → +opcions(1710+1711 Sevilla, 1/dia×2dies)=14; opcions+USD=17.1; opció inexistent→400; test builder `testOptionsAddToTotalNotPriceProduct` 4/4.
- ⏳ **Pendent:** e2e amb pagament real Stripe TEST (baix risc). Pla: `docs/opcions-extres-plan.md`.

**Delivery/lliurament — Fase A (ciutat) FETA; B/C pendents.** Preu de `/details` (`details.delivery_price` ciutat, `airports_list` aeroport; cap endpoint API nou), server-side.
- **Fase A ✅ (domicili `1` + hotel `2`):** `create_booking` accepta `delivery_type` (0 pickup / 1 domicili / 2 hotel) + `delivery_address` (obligatòria si 1/2) + `hotel_name` (opc.). El web valida (`id_virtual==0`, adreça) i suma `delivery_price × rate` a `$total` (comissionat, fora de `priceProduct`; builder 5è param `$deliveryPrice`). `get_rental_details` exposa `city_delivery_price`. Verificat e2e: pickup 10 → domicili 11 → +USD 13.44 → combo amb opcions 15; test builder 5/5. ⏳ pendent e2e pagament real.
- **Fase B ✅ aeroport (`5`):** `create_booking` accepta `delivery_type=5` + `airport_place_id` (de `get_rental_details.airports`) + `flight_number`. El web casa l'aeroport per `place_id` a `details.airports_list` (no per nom, més robust), preu × rate, `flight_number` normalitzat. Verificat e2e: Nuremberg 13, Barcelona+USD 24.44, sense vol/place_id fals → 400.
- **Fase C ✅:** creuer (`3`) = mateix preu que ciutat (verificat total 11). Event (`4`) **fora d'abast** (flux `event=1`, el MCP no el fa) → rebutjat. `closed_service`: cap acció — el recàrrec `*_closed_price` NO és al `$total`/`$pay` (columna separada a `sales_order`, order.js:942), i el flux passa sempre `closed_service=0`; cap infravaloració.
- **Codis delivery suportats:** 0 pickup, 1 domicili, 2 hotel, 3 creuer, 5 aeroport. (4 event, no.)
- **Fix transversal:** la resposta de `/ai/checkout` arrodoneix `total`/`pay_now`/`pay_at_pickup` a la moneda (soroll de float de conversió; Stripe ja cobrava bé via `toStripeAmount`→`round`).
- Pla i detalls: `docs/delivery-plan.md`.

## Multi-tenant — afegir rent4riders (guia de replicació)
`rent4riders` = lloguer de motos (Laminas PHP + Fastify, mateixa família que motion4rent). **Diferència clau:** rent4riders té capa **multi-proveïdor OKMobility (SOAP)** que motion4rent NO té (veure `rent4riders-api/CLAUDE.md`). Per replicar la iniciativa:

- **Fase 1 (GEO) → `rent4riders-web`:** clonar robots.txt (bots IA), llms.txt, generació d'`ai-catalog.json` al seu `cron/sitemap.php`, FAQPage a `/faq`, FAQ a guies/landings, i afegir les rutes a l'allowlist de Cloudflare. Adaptar slugs SEO i copy (motos, no mobilitat).
- **Fase 2 (conversa) → `webs/ia`:** afegir el `BusinessAdapter`/`buildLink` de rent4riders (`src/business/rent4riders/`), amb `lat/lon/name/url`. Probablement ja existeix parcialment — verificar.
- **Fase 3 (MCP) → `webs/mcp`:** el codi és **tenant-aware** via `TENANT` + `M4R_API_BASE_URL`/`WEB_BASE_URL`. Per a rent4riders: (a) desplegar una **instància separada** amb aquestes env apuntant a rent4riders-api/web, o (b) fer el servidor multi-tenant (mapa de config per tenant). Adaptar `deeplink.ts` (slugs de rent4riders) i `policies.ts` (corpus RAG de rent4riders). ⚠️ **Booking amb OKMobility**: el hold headless ha de passar pel flux de proveïdor (`handleProviderStateAction` → OKM `createReservation`) — més complex que motion4rent; començar per productes de stock propi.
- **API:** rent4riders-api ja té `?probe=1` a `/search` i el flux de proveïdor; per al MCP read-only n'hi ha prou amb `/ai/cities`, `/search/results`, `/details`.

## Rules
- **Never commit or stage changes** — l'usuari commiteja manualment.
- **Never touch `rent4riders-web`/`rent4riders-api` ni `motion4rent-web`/`motion4rent-api`** des d'aquest projecte tret que la fase ho requereixi explícitament (p. ex. 3A toca `motion4rent-web`); són projectes separats amb el seu propi CLAUDE.md.
- **Read-only avui**: el MCP NO crea comandes ni cobra. En passar a 3A, el **preu es recalcula al servidor**, mai es confia del caller.
- **Sense secrets al codi** — tot per env vars.
- **Explicacions/resums de pes → desar-los també en un `.md`** (l'usuari no pot copiar fiablement del terminal).
- **Mantenir aquest CLAUDE.md al dia** quan canviïn les tools, el contracte amb l'API/web, les decisions de fase o la col·locació.
