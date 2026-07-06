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
  - `mobility_policies` — FAQ/polítiques (dataset curat, text ES verbatim del corpus RAG de `webs/ia`; el client tradueix).
  - `create_booking` *(Fase 3A, opcional)* — crea el `hold` + retorna `urlTpv` de Stripe. **Només recollida a botiga, sense extres.** Registrada NOMÉS si `M4R_CHECKOUT_BASE_URL`+`M4R_CHECKOUT_SECRET` estan definits; si no, booking deshabilitat (només descoberta + deep-link).

## Fitxers
- `src/config.ts` — env: `MCP_TRANSPORT`, `PORT`, `MCP_AUTH_TOKEN`, `M4R_API_BASE_URL`, `WEB_BASE_URL`, `TENANT`, i (Fase 3A) `M4R_CHECKOUT_BASE_URL` + `M4R_CHECKOUT_SECRET`.
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
