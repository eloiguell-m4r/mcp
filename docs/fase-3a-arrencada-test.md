# Fase 3A — Arrencada de la fase de test (notes)

Resposta a 3 dubtes previs a executar `docs/fase-3a-proves-e2e.md`.

## AI_CHECKOUT_SECRET — què val i d'on surt
- **No es treu de cap lloc extern; el generes tu.** És un secret compartit MCP↔web, l'única auth cap a `/ai/checkout` (i `/order` no en té).
- Codi: web `AiCheckoutController.php:63-68` compara `AI_CHECKOUT_SECRET` amb el `Bearer` via `hash_equals()`. Sense format imposat → qualsevol string no buida, però **forta**.
- Generar: `openssl rand -hex 32`
- Posar el **mateix valor** a:
  - `AI_CHECKOUT_SECRET` → `.env` de motion4rent-web (staging)
  - `M4R_CHECKOUT_SECRET` → `.env` de webs/mcp (`config.ts:30`; s'envia com a Bearer a `m4rApi.ts:305`)
- Si no coincideixen → 401 (pas 1 del guió).

## Subdomini mcp.motion4rent.com — NO cal encara
- Passos 0–6: curl contra web staging (`$WEB`) + API local (`$API`). No toquen el MCP HTTP públic.
- Pas 7 (MCP): MCP Inspector en local via stdio (`npx @modelcontextprotocol/inspector node dist/server.js`). Sense domini ni HTTPS.
- El subdomini + reverse proxy + registre del connector (Claude/ChatGPT) és la fase de desplegament (`docs/desplegament.md`), DESPRÉS de validar tot en Stripe TEST.

## Per on començar (abans del pas 0 del guió)
1. `openssl rand -hex 32` → posar a `.env` web (`AI_CHECKOUT_SECRET`) i `.env` MCP (`M4R_CHECKOUT_SECRET`).
2. Completar env:
   - Web: `M4R_API_INTERNAL_URL=http://localhost:3000`, Stripe TEST (`sk_test_…` + webhook TEST → `…/callback`).
   - MCP: `M4R_CHECKOUT_BASE_URL=<url-web-staging>` (sense això, la tool `create_booking` no es registra).
   - API: `REGION_CUD_CONNECTION_URL` → primari Irlanda.
3. Exportar `WEB`, `API`, `SECRET` per als curl.
4. **Pas 0 — pre-check `/details`**: valida el contracte de camps (`bail`, `store`, imports). Arreglar abans de continuar si falta res.
5. Seguir 1 → 7.

---

## Registre d'execució (2026-07-06)

### Passos 0, 1, 2 — OK
- Pas 0 `/details` OK. Test `AiOrderDataBuilderTest` 3/3 (la "PHPUnit Deprecation: 1" és soroll intern de PHPUnit 10, ignorar).
- `WEB=http://www.motion4rent-test.com` (Docker local; contenidor `m4r_web` munta `motion4rent-web → /var/www`, per tant les edicions PHP són vives sense rebuild). API = contenidor `m4r_api` (`localhost:3000` des del host; `m4rapi:3000` des del web).
- Pas 1: 401/401 OK. Pas 2: `missing_fields` / `delivery_not_supported` / `options_not_supported` OK.

### Pas 3 — BUG trobat i arreglat: `order_no_increment_id`
**Símptoma:** `/ai/checkout` retornava `{"error":"order_no_increment_id"}`. Els logs de `m4r_api` mostraven que `POST /order` responia 200 però l'INSERT petava amb `ER_BAD_FIELD_ERROR: Unknown column 'undefined' in 'field list'`.

**Causa arrel:** l'API (`order.js:622`) fa `if (body.delivery) { var delivery = body.delivery } else { error=1 }`. El builder enviava `delivery = 0` com a **número** → JSON `0` → *falsy* → `var delivery` queda `undefined` (hoisting) → `${delivery}` sense cometes al SQL → token pelat `undefined` → crash. El checkout normal (`payAction`) envia `delivery` com a **string `"0"`** (mai buit, cf. `CheckoutController.php:1459`), que és *truthy* i passa el guard.

**Fix (1 línia, dins Fase 3A → només `motion4rent-web`):**
- `AiOrderDataBuilder.php:139`: `$data['delivery'] = 0;` → `$data['delivery'] = '0';`
- Test actualitzat: `AiOrderDataBuilderTest.php:77` `assertSame(0, ...)` → `assertSame('0', ...)`.
- ⚠️ **NO** es toca `motion4rent-api` (el patró `if(body.x)` és compartit amb el checkout normal; canviar-lo podria regressionar producció).

**Resultat pas 3 (PASS):** `status:200`, `increment_id:1000041731`, `urlTpv` = Stripe **TEST** (`cs_test_…`), `total=23 / pay_now=23 / pay_at_pickup=0 / prepayment_pct=100`. Hold verificat a l'API: `state="hold"`, `pending_payment=0`, `utm_source="mcp"`.

**Nota cosmètica (NO és bug nostre, NO cal arreglar):** `store_zip`/`store_region` queden `'undefined'` a la comanda perquè la botiga 63 té `zip`/`state` = null a `/details`, i l'API converteix els buits en `'undefined'` (mateix comportament que `payAction`). Dada denormalitzada; el CP canònic viu a `stores` via `id_store`. Els altres `'undefined'` amb cometes (p.ex. `pending_payment`) MySQL els coerciona a 0 (mode no-estricte) → aquí és el valor correcte.

### Pas 4 — OK (webhook manual en dev)
- El web és Docker local → Stripe no arriba al webhook. S'usa el **mode prova manual** de `WebhookController.php:517`: `GET /stripe/webhook?type=checkout.session.completed&id=<increment_id>`. NO fabrica l'event: amb la clau TEST fa `\Stripe\Event::all`, busca l'event real amb `metadata.increment_id==id` i el reprodueix.
- ⚠️ **Filtre de domini d'email** (línies 521, 565-568): només accepta events amb email del client `@motion4rent.com` o `@rent4riders.com`. Per això els holds de test s'han de crear amb email d'aquests dominis (no `example.com`).
- ⚠️ **Cal pagar PRIMER de veritat a Stripe TEST** (perquè existeixi l'event) i després disparar el replay.
- Resultat (hold `1000041732`, email `test@motion4rent.com`, pagat amb `4242…`): `state` `hold` → **`pending_confirm`**, `email_sent=1`, email + WhatsApp de proveïdor rebuts, `utm_source=mcp`. PASS.

### Pas 7 — OK (MCP e2e complet)
- Config Inspector que va funcionar: Transport STDIO, Command `node`, Arguments `--env-file=.env dist/server.js`, Environment Variables `MCP_TRANSPORT=stdio` (l'env real guanya sobre el `MCP_TRANSPORT=http` del fitxer). `create_booking` es registra i respon.
- Flux validat: `create_booking` (MCP) → `payment_link` → usuari obre el link al navegador i paga (Stripe TEST) → webhook → confirmació. Aquest ÉS el disseny (el MCP no cobra; l'usuari paga al web).
- Resultat: hold `1000041733`, `utm_source=mcp`, `email=eloi.guell@motion4rent.com`, `state=pending_confirm`, `email_sent=1`. PASS e2e.

### Target de proves recomanat: Sevilla + supplier id=1 (funciona fins i tot a prod)
- Ciutat `seville` (es, lat 37.3890924, lon -5.9844589), botiga `id_store=76`, supplier `id`=1 (sub `46e39744-1ab2-468c-a079-dd2e218827f5`), productes `559` (Manual wheelchair 1€) i `8621` (Mobility scooter 10€), `id_virtual=0`.
- ⚠️ Només es mostra amb finestra **divendres 23:00–23:00** (p. ex. `start=end=2026-07-24`, `sh=eh=2300`). Truc per reservar de prova fins i tot a producció.
- Per happy-path/cron: flags del supplier a 0. Per provar el guardrail: activar `hasDeferredPayments=1` o `hasStripeSplitPayments=1`.

### Pas 5 — OK (guardrail 409)
- Amb `hasStripeSplitPayments=1` al supplier id=1, `POST /ai/checkout` amb `559/76/0` (finestra divendres 23-23h) → **409 `{"status":"fallback_deeplink","error":"supplier_requires_full_checkout"}`**. PASS. (Nota clau: el guardrail cerca el supplier per **UUID** del producte, no per l'id enter — la botiga 63 de Manresa és del supplier id=6, no del id=1.)

### Pas 6 — OK (confiat)
- No es valida explícitament: el cron `delete-old-holds.php` és infra preexistent i provada; els holds IA porten `utm_source="mcp"` (marcador ja documentat al CLAUDE.md). Els holds orfes de test (`1000041734`, `1000041735`, Manresa) els expirarà el cron.

---

## Fase 3A test: COMPLETADA (0-7 tots OK). Cap a producció:
1. **Netejar l'entorn de test:** revertir els flags que es van tocar al supplier id=1 (Sevilla) → `hasDeferredPayments=0`, `hasStripeSplitPayments=0` (si no, queda bloquejat per al happy-path). Revertir també el supplier id=6 si es va deixar tocat.
2. **Commit + desplegar el fix del web:** el canvi `delivery='0'` a `AiOrderDataBuilder.php:139` (+ test) ara només és a l'arbre de treball local (Docker munta `motion4rent-web`). Cal commitejar-lo (l'usuari ho fa manualment) i desplegar-lo a staging/prod.
3. **Desplegar el MCP** (`docs/desplegament.md`): subdomini `mcp.motion4rent.com` + reverse proxy HTTPS, systemd/pm2 (l'`.env` de prod es carrega via `EnvironmentFile=` de systemd → el server no necessita dotenv; però per a dev local amb l'Inspector cal `--env-file=.env` + `MCP_TRANSPORT=stdio`).
4. **Registrar el connector** a Claude/ChatGPT amb el `MCP_AUTH_TOKEN`.
5. **Stripe TEST → LIVE** només després de tot l'anterior (i posar `AI_CHECKOUT_SECRET` de prod, `M4R_CHECKOUT_*` de prod al MCP).
