# Fase 3A — Booking headless acotat (recollida a botiga, sense extres)

> Objectiu: que el MCP pugui **crear una reserva `hold` i tornar un link de pagament Stripe** dins del xat, reutilitzant el flux existent (`hold` → Stripe → webhook), amb un acotament que **elimina el risc financer**.

## 1. Acotament (el que fa que sigui segur)
Només es permet booking headless quan:
- **Recollida a botiga** (`delivery = pickup`, sense lliurament) → cap cost/suplement de delivery.
- **Sense extres/opcions** de checkout → cap preu d'add-ons.
- **Prepagament = % del supplier** (`/details.prepayment`, típicament 15 % o 100 %), **SENSE pagament diferit** (`hasDeferredPayments = 0` sempre) → una sola càrrega Stripe, cap auto-cobrament ni cron.
- **Excloure suppliers amb `hasDeferredPayments = 1`**: necessiten off_session + cron de cobrament (fora d'MVP) → fallback al deep-link.
- **1 equip per reserva**, Stripe (no PayPal, no grups, no multi-store), sense tokens d'agència/hotel.

Amb això el preu es col·lapsa a: **tarifa base (`/details.totalWithOutExtra`) + fees de gestió obligatoris (M4R/supplier, també de `/details`)**. Cap import el posa el caller.

> ⚠️ **`prePayment` ≠ 100 % obligatori.** «Sense diferit» vol dir que Stripe **no** auto-cobra el pendent, NO que el client pagui tot ara. Un supplier no-diferit pot cobrar **15 % online (dipòsit) + 85 % a la recollida**, amb una sola càrrega. El `minPrePayment` del codi calibra el dipòsit perquè cobreixi la comissió M4R (`supplier_payment = pay - comission_total`); el supplier cobra el seu net a botiga.

## 2. Troballes del codi (base del disseny)
Verificat contra el codi real:

- **`GET /details` (motion4rent-api) computa tot al servidor**: `total`, `totalWithOutExtra`, `extraM4R`, `extraSup`, `feeGestionM4R`, `comission %`, `comissionTotal`, `cost` (net proveïdor), `prepayment %`, `bail`, `cancellation_*`. → És la **font de veritat financera**.
- **`POST /order` (motion4rent-api) es fia del payload al 100 %** i **no té auth**. Insereix `total/comission/comission_total/pay/supplier_payment/extraM4R/...` tal qual. → El caller **mai** ha d'enviar imports; els ha de derivar el servidor.
- **`payAction()` (motion4rent-web, `module/Checkout/src/Controller/CheckoutController.php`, ~L1729–1966)** fa l'aritmètica: exchange de moneda → suma opcions/delivery → descompte → `comission_total = total*comission%` → `pay` segons prepayment → `supplier_payment = pay - comission_total`. Assembla ~80 camps a `$data`, posa **`state = "hold"`**, POST a `/order`, i crea la sessió Stripe.
- **`StripeService::createCheckoutSessionFromArray()`** (`module/StripeModule/...`) crea la Checkout Session amb **`metadata.increment_id`** i retorna `$session->url` (= `urlTpv`).
- **Webhook `StripeCallbackWebhookHandler`** (`checkout.session.completed`) **depèn NOMÉS de `metadata.increment_id`**: llegeix la comanda, i si `state == "hold"` la passa a **`accept`** (si `diff > advanceConfirm && advanceConfirm > 0`) o **`pending_confirm`** (altrament). → **Funciona sense canvis per a holds creats headless.**

## 3. Principi de seguretat (innegociable)
1. El **preu i les comissions els recalcula el servidor** cridant `/details` des del propi endpoint de checkout. El MCP envia només: ids de producte, dates, PII del client, flag pickup. **Mai imports.**
2. L'endpoint `/ai/checkout` va **protegit amb secret compartit** MCP↔web (bearer). `POST /order` no té auth → l'abús seria crear holds massius.
3. **Validació estricta de l'acotament**: rebutjar si `delivery != pickup`, si venen `options`, si `prePayment != 100`, o si hi ha tokens d'agència/hotel.
4. **Idempotència** (evitar holds duplicats per reintents) + **rate-limit**.
5. Holds d'origen IA **marcats** i alliberats pel cron existent `cron/delete-old-holds.php` (finestra curta alineada amb l'expiració de la Stripe session).

## 4. On viu l'endpoint (DECISIÓ): al web PHP, NO a l'API
La math financera (~240 línies) i la creació de la Stripe session **ja són PHP** (`payAction` + `StripeService`). Reimplementar-ho a Node (API) duplicaria la lògica de diners en un segon llenguatge → divergència garantida. Per tant: **nou endpoint `POST /ai/checkout` al mòdul `Checkout` del web**, reutilitzant la lògica extreta.

## 5. Arquitectura del flux
```
Claude/ChatGPT (usuari dona consentiment + PII)
  → MCP tool `create_booking`  (M4R_CHECKOUT_BASE_URL + bearer secret)
     → POST /ai/checkout  (web PHP, Irlanda CRUD)
        1. valida acotament + secret
        2. GET /details (server-side, params de pickup)         ← preu del servidor
        3. buildOrderData() [servei compartit extret de payAction] → $data state="hold", prePayment=100
        4. POST /order (API CRUD) → increment_id
        5. StripeService::createCheckoutSessionFromArray(metadata.increment_id) → urlTpv
        6. return { increment_id, urlTpv }
  ← MCP retorna urlTpv → Claude/ChatGPT el presenta a l'usuari
Usuari paga → webhook checkout.session.completed → hold → accept/pending_confirm  (SENSE canvis)
No paga → cron delete-old-holds allibera el hold
```

## 6. Canvis per projecte

### 6.1 motion4rent-web
> ⚠️ **NO es toca `payAction()`.** Zero risc per al checkout del web en producció. El refactor d'extracció s'ha DESCARTAT: l'acotament elimina justament tot el que fa complex `payAction` (opcions, delivery, descomptes, diferit, multi-equip, exchange), i `/details` ja computa els imports → el cas headless és petit i aïllat.

1. **Builder aïllat, nou** (`module/Checkout/src/Service/AiOrderDataBuilder.php`): mapeja la resposta de `/details` → l'array `$data` del cas acotat. **No reutilitza codi de `payAction`; no el modifica.** Càlcul complet:
   ```
   total            = /details.total            (sense opcions ni delivery → ja és el final)
   comission_total  = /details.comissionTotal
   prePayment       = /details.prepayment       (p. ex. 15)
   pay              = round(total * prePayment / 100)
   pendingPayment   = total - pay
   supplier_payment = pay - comission_total
   bail             = /details.bail
   extraM4R/Sup, feeGestionM4R, cancellation_*, prepayment  ← tal qual de /details
   state = "hold";  hasDeferredPayments = 0;  delivery = pickup;  options = [];  currency = store
   ```
2. **Nou endpoint `POST /ai/checkout`** (ruta a `module/Checkout/config/module.config.php` + acció, idealment un controlador nou `AiCheckoutController` per no barrejar amb el formulari web):
   - Auth: bearer secret (env `AI_CHECKOUT_SECRET`).
   - Input JSON: `{ id_product, id_store, id_virtual, start, end, sh, eh, locale, currency?, customer{ firstName, lastName, email, phone, prefix, country }, newsletter?, comments? }`.
   - Validació acotament (pickup, sense options, single equip; **rebutjar si el supplier té `hasDeferredPayments=1`** → resposta que indiqui fallback a deep-link).
   - Crida `/details` amb params de **pickup** (sense delivery/hotel/airport).
   - `AiOrderDataBuilder` (builder aïllat, punt 1) amb `delivery=pickup`, `options=[]`, **`prePayment` = `/details.prepayment`** (NO forçat a 100), **`hasDeferredPayments=0`**.
   - Marca origen IA (p. ex. `utm_source="mcp"` o flag dedicat) per al cron.
   - POST `/order` → `increment_id`.
   - `StripeService::createCheckoutSessionFromArray([... metadata.increment_id ...])` → `urlTpv`.
   - Retorna `{ increment_id, urlTpv }`.
3. **Sense canvis** al webhook. **Confirmar** que `delete-old-holds.php` pot identificar/expirar aquests holds (i, si cal, finestra curta).

### 6.2 webs/mcp
1. `src/config.ts`: afegir `checkoutBaseUrl` (`M4R_CHECKOUT_BASE_URL`, → Irlanda CRUD) i `checkoutSecret` (`M4R_CHECKOUT_SECRET`).
2. `src/m4rApi.ts`: `createBooking(...)` → `POST {checkoutBaseUrl}/ai/checkout` amb bearer.
3. `src/tools.ts`: nova tool **`create_booking`** (o `crear_reserva_i_pagament`):
   - Inputs: ids (de `search_mobility_rentals`), dates, `customer{...}`, locale, currency?.
   - **Description amb guardrails**: només recollida a botiga i sense extres; si l'usuari vol lliurament o extres → fallback al `booking_link` (deep-link) de `search_mobility_rentals`.
   - Retorna `urlTpv` + `increment_id`; l'assistent el presenta i l'usuari paga.
   - Human-in-the-loop: recollir consentiment + PII abans de cridar-la.

### 6.3 motion4rent-api
- **Cap canvi imprescindible.** (Opcional futur, fora d'abast: afegir auth a `POST /order`.)

## 7. Verificació (Stripe TEST)
- **Test de comparació (read-only, xarxa de seguretat):** per a un cas acotat conegut, comprovar que els imports d'`AiOrderDataBuilder` **coincideixen amb el que `payAction` produiria** per als mateixos inputs (mateix `total/comission_total/pay/supplier_payment`). No modifica `payAction`; només compara → si mai divergeixen, el test crida.
- **e2e headless en TEST**: `curl` a `/ai/checkout` amb secret → crea `hold` + retorna `urlTpv`; pagar amb targeta test → webhook → comanda a `accept`/`pending_confirm`.
- **Hold no pagat** → caduca i es desactiva el payment link (cron).
- **Seguretat**: `/ai/checkout` sense secret → 401; amb `delivery!=pickup` o `options` → 400; amb imports al body → ignorats (el servidor recalcula).
- **MCP**: MCP Inspector / client real → `create_booking` retorna `urlTpv` vàlid.

## 8. Decisions
1. ✅ **Prepayment (corregit)**: usar el **% real del supplier** (`/details.prepayment`, p. ex. 15 % dipòsit o 100 %), amb **`hasDeferredPayments=0` sempre** (cap auto-cobrament ni cron). El client paga `prePayment%` online i la resta a la recollida. **Excloure suppliers `hasDeferredPayments=1`** de l'MVP (fallback deep-link). L'assistent comunica el desglossament (X ara / Y a botiga). *(Pagament diferit real amb off_session + cron → iteració posterior.)*
2. ✅ **`pending_confirm`**: **acceptat**. Mateix comportament que el web (es cobra i la botiga confirma disponibilitat). L'assistent **ha d'avisar** l'usuari que la reserva queda pendent de confirmació del punt de recollida quan aplica.
3. **Moneda**: acceptar `currency` al body amb **default EUR/moneda de botiga** (decidit per defecte; ajustable).
4. **Pendent de confirmar en implementar**: marcatge del hold IA + finestra d'expiració al cron (quin camp/flag) i gestió/rotació del secret (env var a banda i banda).

## 9. Nota multi-tenant (rent4riders)
Mateixa estructura a `rent4riders-web`/`-api`/`mcp`. **Complicació**: rent4riders té capa OKMobility (SOAP) → el hold headless ha de passar pel flux de proveïdor (`handleProviderStateAction` → `createReservation`), més complex. **Començar per stock propi** (no-proveïdor) abans d'atacar OKMobility.

## 10. Seqüència d'implementació recomanada
1. ✅ **FET (web)** `AiOrderDataBuilder` aïllat + test de comparació amb `payAction` (read-only). **`payAction` NO tocat.**
   - `module/Checkout/src/Service/AiOrderDataBuilder.php` — port fidel del bloc financer (L1672, L1885–1966) per al cas acotat; classe pura.
   - `module/Application/test/Service/AiOrderDataBuilderTest.php` — 3 fixtures (dipòsit 15%+fees, pagament 100%+fees, sense fees amb bump de minPrePayment), valors calculats a mà. **3/3 OK, 34 assercions** (`vendor/bin/phpunit --bootstrap vendor/autoload.php module/Application/test/Service/AiOrderDataBuilderTest.php`). *(La deprecation de PHPUnit és de `phpunit.xml.dist` `<filter><whitelist>`, preexistent, no del test.)*
2. ✅ **FET (web, pendent validar en staging)** `POST /ai/checkout` + secret + validació + guardrails.
   - `module/Checkout/src/Controller/AiCheckoutController.php` — auth bearer (`AI_CHECKOUT_SECRET`), valida input+acotament (rebutja delivery/options), crida `/details` (pickup), **rebutja suppliers diferits o amb split → 409 `fallback_deeplink`**, usa `AiOrderDataBuilder` (financers), assembla la resta de `$data` (mirall de payAction), POST `/order`, Stripe **branca simple sense split** (`metadata.increment_id`), retorna `{increment_id, urlTpv, total, pay_now, pay_at_pickup, prepayment_pct, free_cancellation_until}`.
   - `module/Checkout/src/Controller/AiCheckoutControllerFactory.php` (deps: StripeService, SupplierRepository).
   - Ruta `ai_checkout` (Literal `/ai/checkout`) + factory a `module/Checkout/config/module.config.php`.
   - **Lint OK** als 3 fitxers; builder test segueix 3/3.
   - ⚠️ **NO provat contra API/Stripe en local** (cal staging). **Validar en staging:**
     1. Contracte de camps de `POST /order` (p. ex. `storeAddress` vs `storeStreet`, `supplierId`, `customerTypeDis`) i que l'objecte `store` de `/details` porti tots els camps (si no, afegir fetch a `/stores`).
     2. Font real de `bail` a `/details`.
     3. `M4R_API_INTERNAL_URL` (o el default `localhost:3000`/`m4rApi:3000`) i `AI_CHECKOUT_SECRET` a l'`.env` del web.
     4. Prova `curl` en Stripe TEST: crear hold → pagar → webhook → `accept`/`pending_confirm`; sense secret → 401; `delivery`/`options` → 400; supplier diferit/split → 409.
3. ✅ **FET (mcp)** `config` + `m4rApi.createBooking` + tool `create_booking`.
   - `src/config.ts` — `checkoutBaseUrl` (`M4R_CHECKOUT_BASE_URL`) + `checkoutSecret` (`M4R_CHECKOUT_SECRET`); `.env.example` actualitzat.
   - `src/m4rApi.ts` — `createBooking()` (POST bearer a `{checkoutBaseUrl}/ai/checkout`, 30s; gestiona 409 `fallback_deeplink`).
   - `src/tools.ts` — tool `create_booking` (recollida a botiga, sense extres; guardrails a la description; demana consentiment+PII; fallback al `booking_link`). **Registrada NOMÉS si hi ha `checkoutBaseUrl`+`secret`** (si no, booking deshabilitat).
   - **typecheck + build OK**; `tools/list` = 5 tools amb config / 4 sense (verificat).
4. **e2e** en TEST (crear hold → pagar → webhook → estat). ← **següent (requereix staging + Stripe TEST)** · **guió: `docs/fase-3a-proves-e2e.md`**
5. **Desplegar** (web + MCP amb `M4R_CHECKOUT_BASE_URL` → **web LOCAL de Virgínia** (co-ubicat, localhost) + secret). El web local escriu el `hold` a Irlanda per la connexió CUD de l'API.

## 11. Xarxa / Cloudflare i enrutament d'escriptura a Europa
**Col·locació decidida:** MCP a **Virgínia** (rèplica read-only).

**Troballa clau — l'escriptura ja va a Irlanda a nivell de BD, NO cal split HTTP.** L'API (`motion4rent-api`) enruta connexions per regió a `lib/mysqlRegionRouting.js`:
- **`REGION_CUD_CONNECTION_URL`** → host dels **CUD (escriptura)**, **default = primari EU/Irlanda** (`m4r…eu-west-1.rds.amazonaws.com`).
- `REGION_READ_CONNECTION_URL` → lectura local (Virgínia); `REGION_EU_READ_CONNECTION_URL` → lectura EU.

`POST /order` fa l'INSERT amb `fastify.mysql.query` (pool d'**escriptura** = `REGION_CUD_CONNECTION_URL`). Per tant l'**API de Virgínia escriu el `hold` al primari d'Irlanda automàticament** — el mateix mecanisme que ja fa servir `payAction` des del web d'USA. **Descartat `M4R_API_WRITE_URL`:** el web crida sempre l'**API LOCAL** (`localhost:3000`), i l'escriptura viatja a Europa per la connexió RDS (no per HTTP).

**Qui crida `/details` i `/order`:** el controlador `AiCheckoutController` al web PHP, servidor-a-servidor cap a l'API **local** per URL interna — **NO** pel domini públic ni per Cloudflare (igual que `payAction`).

| Salt | Passa per Cloudflare? | Acció |
|---|---|---|
| web → API `/details` (lectura) | ❌ No (intern, localhost) | `M4R_API_INTERNAL_URL` o default `localhost:3000` |
| web → API `/order` (escriptura hold) | ❌ No (intern, localhost) | mateixa API local; l'INSERT va a Irlanda via `REGION_CUD_CONNECTION_URL` (BD) |
| API(Virgínia) → RDS primari (Irlanda) | ❌ No | ja resolt per la infra existent (VPC/xarxa segura de l'API) |
| MCP → web `POST /ai/checkout` | ⚠️ Sí, si arriba pel domini públic | co-ubicat → localhost (no toca CF); si públic → allowlist path `/ai/checkout` + bearer/IP |
| Stripe → web `/callback` (webhook) | ✅ Sí (ja funciona) | cap canvi; confirma el hold a Irlanda |
| Claude/ChatGPT → `mcp.*/mcp` | ✅ Sí | permetre l'endpoint MCP |

**Controlador (implementat):** `AiCheckoutController` usa una única base `hostApi` (API local) per a /details i /order. Sense `M4R_API_WRITE_URL` ni crides cross-regió → **cap concern de VPN/IP nou** (la connexió Virgínia→RDS-Irlanda ja existeix per a tota la resta d'escriptures de l'API).

⚠️ **Webhook:** el `/callback` de Stripe confirma el hold via `metadata.increment_id`. Com que el hold viu al primari d'Irlanda i el webhook de producció ja hi escriu, és coherent sense canvis.
