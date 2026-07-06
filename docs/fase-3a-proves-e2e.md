# Fase 3A — Guió de proves e2e (staging + Stripe TEST)

> Objectiu: validar `POST /ai/checkout` (web) i la tool `create_booking` (MCP) de punta a punta,
> sense risc de diners reals. Es fa **tot en Stripe TEST**. Ordre recomanat: 0 → 7.

## Prerequisits
- **Stripe en mode TEST** al web de staging (claus `sk_test_…`, webhook TEST apuntant a `…/callback`).
- **.env del web (staging/Virgínia):**
  - `AI_CHECKOUT_SECRET=<secret-fort>`
  - `M4R_API_INTERNAL_URL=http://localhost:3000` (o el port real de l'API local)
  - Stripe TEST + `ENVIRONMENT` segons staging.
- **.env de l'API (staging):** `REGION_CUD_CONNECTION_URL` → primari Irlanda (default EU), `REGION_READ_CONNECTION_URL` → rèplica local.
- **.env del MCP:** `M4R_CHECKOUT_BASE_URL=<url-del-web-staging>` + `M4R_CHECKOUT_SECRET=<mateix-secret>`.
- Variables de conveniència per als curl:
  ```bash
  WEB=https://<web-staging>        # p. ex. https://www.motion4rent-test.com
  API=http://localhost:3000        # API local (des del host del web)
  SECRET=<AI_CHECKOUT_SECRET>
  # Producte conegut (Manresa, validat a la Fase 3B): id_product_store=265, id_store=63, id_virtual=0
  ```
- **Targetes Stripe TEST:** èxit `4242 4242 4242 4242` · 3DS `4000 0025 0000 3155` · rebutjada `4000 0000 0000 9995`. Data futura qualsevol, CVC qualsevol.

---

## 0) Pre-check: `/details` retorna el que espera el builder
Abans de res, mira que la resposta crua de `/details` porti els camps que fem servir (contracte).
```bash
curl -s "$API/details/265/63/0/2026-08-10/2026-08-12/1000/1000/es?radius=0&lat=0&lon=0&delivery_hotel=0&delivery_closed_service=0&pickup_closed_service=0&landing=search&event=0&id_virtual_real=0&productQty=1&splitSup=0" | python3 -m json.tool | less
```
**Comprova a `body.data[0]`:** `totalWithOutExtra`, `comission`, `extraM4R`, `feeGestionM4R`, `extraSup`, `prepayment`, `percent_discount`, `cancellation_refundable`, `cancellation_days`, `currency`, i **on ve `bail`** (a `details.bail`?). A `body.store`: `id, name, address, city, email, zip, state, country, phone, timezone`, i `city_en/es/...`.
- Si `bail` NO és a `details.bail` → ajustar `AiOrderDataBuilder::parseBail` / el mapatge al controlador.
- Si al `store` hi falten camps (address/zip/...) → afegir un fetch a `/stores` al controlador.

També pots reexecutar el test unitari del builder:
```bash
cd motion4rent-web && vendor/bin/phpunit --bootstrap vendor/autoload.php module/Application/test/Service/AiOrderDataBuilderTest.php
```

## 1) Auth — sense/ amb secret dolent → 401
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$WEB/ai/checkout" -H 'Content-Type: application/json' -d '{}'
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$WEB/ai/checkout" -H 'Authorization: Bearer dolent' -H 'Content-Type: application/json' -d '{}'
```
**PASS:** `401` als dos.

## 2) Validació d'acotament → 400
```bash
# camps que falten
curl -s -X POST "$WEB/ai/checkout" -H "Authorization: Bearer $SECRET" -H 'Content-Type: application/json' -d '{}'
# delivery no suportat
curl -s -X POST "$WEB/ai/checkout" -H "Authorization: Bearer $SECRET" -H 'Content-Type: application/json' \
  -d '{"id_product":265,"id_store":63,"id_virtual":0,"start":"2026-08-10","end":"2026-08-12","sh":"1000","eh":"1000","locale":"es","delivery":1,"customer":{"firstName":"A","lastName":"B","email":"a@b.com","phone":"600","country":"ES"}}'
# options no suportades
curl -s -X POST "$WEB/ai/checkout" -H "Authorization: Bearer $SECRET" -H 'Content-Type: application/json' \
  -d '{"id_product":265,"id_store":63,"id_virtual":0,"start":"2026-08-10","end":"2026-08-12","sh":"1000","eh":"1000","locale":"es","options_id":"5","customer":{"firstName":"A","lastName":"B","email":"a@b.com","phone":"600","country":"ES"}}'
```
**PASS:** `400` amb `missing_fields` / `delivery_not_supported` / `options_not_supported`.

## 3) Happy path — crear el `hold` i obtenir `urlTpv`
```bash
curl -s -X POST "$WEB/ai/checkout" -H "Authorization: Bearer $SECRET" -H 'Content-Type: application/json' -d '{
  "id_product":265,"id_store":63,"id_virtual":0,
  "start":"2026-08-10","end":"2026-08-12","sh":"1000","eh":"1000","locale":"es",
  "customer":{"firstName":"Test","lastName":"MCP","email":"test+mcp@example.com","phone":"600000000","prefix":"+34","country":"ES"}
}' | python3 -m json.tool
```
**PASS:** `status:"200"`, un `increment_id`, un `urlTpv` (`https://checkout.stripe.com/...`), i el desglossament `total` / `pay_now` / `pay_at_pickup` / `prepayment_pct`.
- **Si torna error de camp de `/order`** (ex. camp requerit que falta com `storeStreet`, `supplierId`, `customerTypeDis`): és el contracte a afinar → afegir/renombrar el camp al `$data` del controlador i repetir.
- Verifica el hold creat (estat inicial):
  ```bash
  curl -s "$API/order/increment_id/<INCREMENT_ID>" | python3 -m json.tool | grep -i '"state"'   # → "hold"
  ```

## 4) Pagar en TEST → webhook → confirmació
1. Obre la `urlTpv` al navegador, paga amb `4242 4242 4242 4242`.
2. Stripe dispara `checkout.session.completed` → `…/callback`.
3. Verifica la transició:
   ```bash
   curl -s "$API/order/increment_id/<INCREMENT_ID>" | python3 -m json.tool | grep -i '"state"'
   ```
   **PASS:** `state` passa de `hold` a **`accept`** (si `diff > advanceConfirm && advanceConfirm>0`) o **`pending_confirm`** (altrament). Comprova també que arriba l'email de reserva.
- Si el webhook TEST no arriba: revisa la config de l'endpoint de webhook a Stripe (URL + signing secret TEST) i els logs del web.

## 5) Supplier diferit o split → 409 fallback
Fes servir un producte d'un supplier amb `hasDeferredPayments=1` o `hasStripeSplitPayments=1`.
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$WEB/ai/checkout" -H "Authorization: Bearer $SECRET" -H 'Content-Type: application/json' -d '{...ids d'aquest supplier...}'
```
**PASS:** `409` amb `{"status":"fallback_deeplink"}`. (L'assistent ha d'oferir el `booking_link` de `search_mobility_rentals`.)

## 6) Hold no pagat → caduca (cron)
- Crea un hold (pas 3) i **no** el paguis.
- Executa/espera el cron d'expiració (`motion4rent-web/cron/delete-old-holds.php`).
- **PASS:** el hold s'esborra i el payment link Stripe es desactiva. *(Nota: confirmar que el cron identifica els holds d'origen IA — venen amb `utm_source="mcp"`; si cal una finestra més curta, ajustar-la.)*

## 7) Costat MCP — tool `create_booking`
Amb `M4R_CHECKOUT_BASE_URL` + `M4R_CHECKOUT_SECRET` al `.env` del MCP:
- **MCP Inspector:** `npx @modelcontextprotocol/inspector node dist/server.js` → `tools/list` ha d'incloure `create_booking` → cridar-la amb els mateixos ids i un `customer`.
  **PASS:** retorna `payment_link` (urlTpv) + desglossament; obrir-lo dona el checkout Stripe TEST.
- **Client real (Claude Desktop / connector):** conversa "cadira a Manresa 10-12 agost, recollida a botiga" → l'assistent demana dades → crida `create_booking` → presenta l'enllaç i el desglossament (X ara / Y a la recollida) i avisa si queda pendent de confirmació.

---

## Checklist de tancament (Fase 3A → producció)
- [ ] Pre-check `/details` OK (contracte de camps + `bail` + `store` complet).
- [ ] 401 / 400 / 409 correctes.
- [ ] Happy path: hold creat a Irlanda (`state=hold`) + `urlTpv`.
- [ ] Pagament TEST → `accept`/`pending_confirm` (webhook OK).
- [ ] Hold no pagat caduca (cron).
- [ ] Tool `create_booking` e2e des d'un client MCP.
- [ ] Passar Stripe a **LIVE** només després de validar tot l'anterior en TEST.
