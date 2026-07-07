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

### motion4rent-web (`AiCheckoutController` + `AiOrderDataBuilder`) — ✅ FET
2. ✅ **Accepta `options_id`** (array d'ints); només rebutja `options` en text lliure.
3. ✅ **Carrega+valora server-side:** helper `fetchOption()` → `GET /options/product/{ips}/option/{id}/store/{is}`; si no existeix → **400 `option_not_available`**. Preu convertit amb el `rate` (reusat del bloc de moneda; 1 si mateixa moneda). `type==1` fix / else `× dies` (`$days` de `content->days`).
4. ✅ **Integrat al càlcul:** builder amb nou 4t paràmetre `$optionsTotal` sumat a `$total` abans del bloc de fees. `priceProduct` NO inclou opcions. Verificat e2e: base 10 → +opcions(1710+1711, 1/dia, 2 dies) = 14; comissió inclou opcions.
5. ✅ **Persisteix:** `$data['options']` amb `{id,name,price,image,type}`; `/order` (order.js:990) insereix a `sales_order_item` amb `type=1` (marca opció) i `typeOpt`=price-type. Verificat al hold.
6. ✅ **Test:** `testOptionsAddToTotalNotPriceProduct` (4/4) — total 130, comissió inclou opcions, priceProduct 110 sense opcions.

### webs/mcp — ✅ FET
7. ✅ **Descoberta:** `getProductOptions()` + tool `list_product_options` → `[{id, name, price, price_basis}]`. Verificat: 559→2 (Leg Rest L/R), 8621→1 (Basket).
8. ✅ **`create_booking`:** paràmetre `options_id: number[]` opcional → enviat a `/ai/checkout`. Descripció actualitzada (treta la restricció "sense extres"; manté "sense lliurament"). E2e: total 14 amb `options_id:[1710,1711]`.
9. ✅ **Moneda:** el preu de l'opció al booking es converteix amb el mateix `rate` (server-side). Verificat: opcions+USD → 17.1. A `list_product_options` no es converteix (informatiu).

### ⏳ PENDENT
- **Pas 5 — e2e amb pagament real (Stripe TEST):** pagar una reserva amb opcions (i una amb opcions+moneda) i confirmar que Stripe cobra el total compost i el webhook confirma. Baix risc (mateix camí que ja validat; la Stripe session ja es crea amb el total correcte). Fer-ho en `ENVIRONMENT=development`, NO a producció.
- **Desplegar:** web per pipeline GitLab; MCP manual (`git pull`+`npm run build`+`restart`).

## e2e (Stripe TEST, entorn dev)
- Producte de proves Sevilla + una opció → `total` = base + (opció fixa o ×dies), comissió recalculada, hold correcte, `body.options` inserides, i pagament TEST → webhook confirma. Provar també amb `currency` no-EUR (opció convertida).

## Preguntes obertes a resoldre en implementar
- **id_product vs id_product_store** al fetch d'opcions: payAction passa `id_product_store` com a segment `{id_product}` (L1763). Verificar amb el producte de proves.
- Confirmar que aplicar comissió sobre el preu de l'opció (com fa payAction) és el comportament desitjat també per al headless (ho és si volem paritat amb el web).
- Camps exactes que espera `order.js` a `body.options[i]` (vist: `name, price, image, type`) — assegurar que l'objecte convertit els porta tots.

## Ordre suggerit
(1) API: exposar opcions a `/details` → (2) MCP: mostrar-les a `get_rental_details` → (3) web: `options_id` + builder + test → (4) MCP: `create_booking` amb `options_id` → (5) e2e Stripe TEST (amb i sense moneda). Desplegar: web per pipeline, MCP manual (`git pull`+build+restart); **API també per pipeline** (verificar-ho).
