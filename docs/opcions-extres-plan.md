# Pla — Opcions/extres a la reserva headless (MCP)

Expansió acotada següent, després de moneda. Objectiu: que `create_booking` (i la descoberta) permetin **afegir opcions/extres triables pel client** (casc, bateria extra, etc.), mantenint la regla d'or: **el preu de l'opció el posa el servidor per ID, mai el caller**.

## Per què és viable i segur
El preu de cada opció NO es confia del caller: es llegeix de la BD per ID. El caller només envia **IDs d'opció**. Per tant afegir opcions no reobre el risc financer (igual que la moneda: recalculat al servidor).

## Com funciona avui (verificat al codi)
- **Preu per ID (servidor):** `GET /options/product/{id_product_store}/option/{id_option}/store/{id_store}` (`motion4rent-api/routes/options.js`) → `{ number, response:[ row ] }`. La `row` (JOIN `product_options` + `library_extras`) porta `id`, `price`, `type`, `name`, `image`, `id_library_extras`. `status=1`.
- **Tipus de preu:** `type == 1` → preu **fix**; altrament → `price × dies` (`payAction` L1786-1790).
- **Conversió de moneda:** `payAction` converteix el preu de l'opció amb `exchange(price, product->currency, $currency)` (L1780) — mateix `rate` que ja fem servir a la moneda.
- **Integració financera:** `payAction` **suma les opcions a `$total`** (L1787/1789) ABANS del bloc de fees/comissió/prepagament (L1885-1966). O sigui: el total amb opcions passa pel mateix recompute de comissió/`pay`/`pendingPayment` que el builder ja replica. ⚠️ Conseqüència: en payAction, **les opcions entren dins la base sobre la qual es calcula la comissió** (`comission_total = total * comissionPct/100`). Cal replicar-ho igual (i el test de comparació ho verifica).
- **Persistència:** `payAction` posa `$data['options'] = $options` (objectes sencers). `motion4rent-api/routes/order.js` (L987-999) recorre `body.options` i fa INSERT de cada opció (`name`, `price`, `image`, `type`) → **ja funciona**; el builder headless només ha d'omplir `$data['options']`.
- **Llista d'opcions disponibles:** NO s'exposa avui. `/details` (`details.js:13`) ja consulta `SELECT ... product_options ... WHERE id_product = ?` (totes les opcions del producte) però **no les retorna** a la resposta (només s'usa per al comptador `details.extra`). Cal exposar-les.

## Canvis necessaris (per repo)

### motion4rent-api — ✅ JA FET (no cal canvi)
1. **Exposar la llista d'opcions:** ja existeix `GET /details/options/{id_product_store}` (`details.js:7-29`, registrat abans del catch-all). Retorna `{ number, response:[{id, name, price, type, id_store, id_supplier, image, ...}] }`. `id` = `product_options.id` (el que anirà a `options_id`); `type` 0/1 (1=fix, 0=×dies). Verificat: `559`→2 opcions (Elevating Leg Rest L/R, price 1, type 0), `8621`→1 (Basket).
   - **Decisió:** usar aquest endpoint dedicat des del MCP. NO modificar el `/details` principal (pesat i compartit amb el web de prod → risc innecessari).

### motion4rent-web (`AiCheckoutController` + `AiOrderDataBuilder`)
2. **Acceptar `options_id`** (array d'ints) al body de `/ai/checkout`; treure el rebuig `options_not_supported` (mantenir-lo per a `options` en text lliure no validat).
3. **Carregar+valorar opcions (server-side):** per cada id, `GET /options/.../option/{id}/store/{id}`; si no existeix → ignorar (o 400). Convertir `price` amb `exchangeRate(productCurrency→$currency)` (ja tenim l'helper). Sumar amb `type==1` fix / else `× dies`.
4. **Integrar al càlcul:** passar la suma d'opcions al builder (nou paràmetre `$optionsTotal`) i afegir-la a `$total` a l'inici de `build()`, ABANS del bloc de fees — mirall exacte de payAction. **`priceProduct` NO ha d'incloure opcions** (les opcions són línies a part); només `$total`/comissió/`pay`.
5. **Persistir:** omplir `$data['options']` amb els objectes d'opció convertits (`name/price/image/type`) perquè `/order` els insereixi (ja ho fa).
6. **Test:** estendre `AiOrderDataBuilderTest` amb un cas amb opcions, comparant els imports amb el que dona payAction (mateixa aritmètica).

### webs/mcp
7. **Descoberta d'opcions:** ✅ FET. `getProductOptions(apiBase, idProductStore)` a `m4rApi.ts` (crida `GET /details/options/{id}`) + tool **`list_product_options`** → `[{id, name, price, price_basis: fix|per_dia}]`. Preu en moneda del producte (nota que el total es recalcula en reservar); verificat: 559→2 opcions (Leg Rest L/R, 1/dia), 8621→1 (Basket, 1/dia).
8. **`create_booking`:** ⏳ afegir paràmetre `options_id: number[]` (opcional). Descripció: "IDs de list_product_options; el servidor valida i recalcula el preu". Treure de la descripció el "SENSE extres/opcions".
9. **Moneda:** el preu de l'opció al booking es converteix amb el mateix `rate` (server-side, pas web). A `list_product_options` no es converteix (informatiu; per no fer una crida extra a /details per saber la moneda del producte).

## e2e (Stripe TEST, entorn dev)
- Producte de proves Sevilla + una opció → `total` = base + (opció fixa o ×dies), comissió recalculada, hold correcte, `body.options` inserides, i pagament TEST → webhook confirma. Provar també amb `currency` no-EUR (opció convertida).

## Preguntes obertes a resoldre en implementar
- **id_product vs id_product_store** al fetch d'opcions: payAction passa `id_product_store` com a segment `{id_product}` (L1763). Verificar amb el producte de proves.
- Confirmar que aplicar comissió sobre el preu de l'opció (com fa payAction) és el comportament desitjat també per al headless (ho és si volem paritat amb el web).
- Camps exactes que espera `order.js` a `body.options[i]` (vist: `name, price, image, type`) — assegurar que l'objecte convertit els porta tots.

## Ordre suggerit
(1) API: exposar opcions a `/details` → (2) MCP: mostrar-les a `get_rental_details` → (3) web: `options_id` + builder + test → (4) MCP: `create_booking` amb `options_id` → (5) e2e Stripe TEST (amb i sense moneda). Desplegar: web per pipeline, MCP manual (`git pull`+build+restart); **API també per pipeline** (verificar-ho).
