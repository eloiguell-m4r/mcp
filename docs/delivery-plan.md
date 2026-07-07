# Pla — Delivery (lliurament) a la reserva headless (MCP)

Expansió després d'opcions/moneda. Permetre triar **tipus de lliurament** (no només recollida a botiga). Regla d'or intacta: **el preu del delivery el posa el servidor** (de `/details`), el caller només envia el TIPUS + dades (adreça/hotel/aeroport/vol).

## Viabilitat: SÍ (dada ja disponible, preu server-side)
- `/details` (que el MCP ja crida) porta: `data[0].details.delivery_price` (lliurament a ciutat) i `data[0].details.airports_list=[{price, place_id, name:{locale}}]`. **No cal endpoint nou** (com les opcions).
- El preu no es confia del caller → compatible amb la regla de seguretat.

## Codis de delivery (verificat: view `index2.phtml` + payAction)
| Codi | Tipus | Preu | Camps requerits |
|---|---|---|---|
| `0` | Recollida a botiga | 0 | — (cas actual) |
| `1` | Domicili/apartament (ciutat) | `details.delivery_price` (convertit) | `delivery_address` |
| `2` | Hotel (ciutat) | `details.delivery_price` | `delivery_address` + nom hotel (`nameHotelReservation`), opc. `returnAnotherHotel` |
| `3` | Creuer | `details.delivery_price` | `delivery_address`/port |
| `4` | Esdeveniment | especial (flux event) | — (fora d'abast MVP) |
| `5` | Aeroport | preu de l'aeroport dins `airports_list` | `delivery_address` = **nom exacte** de l'aeroport + `flight_number` |

## Com ho fa payAction (referència, CheckoutController)
- Preu ciutat (1/2/3): `deliveryPrice = exchange(details.delivery_price, product->currency, $currency)` (L1615-1616), només si `delivery_price>0` i `id_virtual==0`.
- Aeroport (5): recorre `airports_list`, compara `airport->name->{locale}` (normalitzat) amb `delivery_address`; si coincideix → `deliveryPrice = exchange(airport->price, ...)` (L1620-1638). Si no coincideix → error.
- Suma al total: `if ($deliveryPrice > 0) $total += $deliveryPrice;` (L1693-1695) — ABANS del bloc de fees/comissió.
- Camps a `$data`: `delivery`, `delivery_address`, `deliveryPrice`, `deliveryPriceIncluded` (L1834-1835), `hotelReservation`/`nameHotelReservation`, `returnAnotherHotel`, `flight_number`. `/order` els persisteix (ja llegeix `delivery`, `deliveryAddress`, `deliveryPrice`, `deliveryPriceIncluded`, `hotelReservation`, etc.).

## Estat actual del headless (a desfer amb cura)
`AiOrderDataBuilder` fixa `delivery='0'`, `deliveryPrice=0`, `deliveryPriceIncluded=0`; `AiCheckoutController` rebutja `delivery` ∉ {0,pickup,''} amb `delivery_not_supported`, i posa `hotelReservation=''`, `flight_number` etc. a buit. Cal parametritzar-ho.

## Fases proposades
### Fase A — Lliurament a ciutat (domicili `1` + hotel `2`) — ✅ FET
Preu pla `details.delivery_price`, sumat a `$total` (comissionat, com payAction L1693), NO a `priceProduct`. Confirmat: `deliveryPrice` va a `$total` i es comissiona; `priceProduct` no l'inclou (payAction L1866).
- ✅ **MCP:** `get_rental_details` exposa `city_delivery_price` (convertit si `currency`). `create_booking` accepta `delivery_type` (1|2) + `delivery_address` (+ `hotel_name` si 2). Descripció actualitzada.
- ✅ **Web:** `AiCheckoutController` normalitza `deliveryType` (accepta 0/1/2; 3/4/5 → 400); city delivery valida `id_virtual==0` i `delivery_address` (si no → 400 `missing_fields`/`delivery_not_available`); `deliveryPrice = delivery_price × rate`; builder amb 5è param `$deliveryPrice`; omple `delivery`/`deliveryAddress`/`deliveryPrice`/`deliveryPriceIncluded` (+ `nameHotelReservation` per hotel).
- ✅ **Test:** `testDeliveryPriceAddsToTotalNotPriceProduct` (5/5): total 118, comissió inclou delivery, priceProduct 110 sense delivery.
- ✅ **e2e (Docker local, Sevilla):** pickup 10 → domicili(1)+adreça 11 (delivery_price 1, pla); hotel(2)+hotel_name 11; +USD 13.44; sense adreça → 400; **combo delivery+opcions = 15** (10+1+4); hold persisteix `delivery=1`/`delivery_address`/`delivery_price=1`.

**Nota:** el `hotelReservation` (flag de programa hotel-partner) NO es toca; per a hotel només es desa `nameHotelReservation` (informatiu) + `delivery_address`.

### Fase B — Aeroport (`5`) — ✅ FET
- ✅ **Selecció per `place_id`** (robust; payAction casa per nom, però al headless controlem el match → usem `place_id` d'`airports_list` i produïm el mateix preu). `flight_number` normalitzat (`strtoupper`, alfanumèric), obligatori.
- ✅ **MCP:** `get_rental_details` exposa `airports: [{place_id, name, price}]` (preu convertit si `currency`; buit si `airport_delivery=0`). `create_booking` accepta `delivery_type=5` + `airport_place_id` + `flight_number`.
- ✅ **Web:** `AiCheckoutController` accepta delivery 5; busca l'aeroport per `place_id` dins `details.airports_list` (si no → 400 `airport_not_available`); `flight_number` buit → 400; `deliveryPrice = airport.price × rate`; `deliveryAddress` = nom aeroport (locale); `flight_number` desat (línia 373, ja no forçat a '').
- ✅ **e2e (Docker, Sevilla):** Nuremberg (place_id …2903, 3€) + vol → total 13; hold `delivery=5`/`delivery_address="Aeropuerto de Núremberg"`/`delivery_price=3`/`flight_number=FR1234`; Barcelona (10€)+USD → 24.44; sense vol → 400; place_id fals → 400.
- ✅ **Fix de float:** la resposta arrodoneix `total`/`pay_now`/`pay_at_pickup` a la moneda (el soroll de float de la conversió es veia com 24.4399…; Stripe ja cobrava bé perquè `toStripeAmount` fa `round`).

### Fase C — Creuer (`3`), event (`4`), `closed_service` — ✅ FET
- ✅ **Creuer (`3`):** es valora igual que ciutat (`delivery_price`, id_virtual==0, delivery_address = port/moll). Afegit a la branca de ciutat i a l'override. Verificat e2e: total 11; sense adreça → 400.
- ✅ **Event (`4`): NO suportat (intencional).** És el flux de reserva d'esdeveniment (query `event=1`, `landing=event`), que el MCP no fa (sempre `event=0`). Es rebutja amb 400 `delivery_not_supported`. Verificat.
- ✅ **`closed_service`: cap acció necessària (no és risc).** El recàrrec `delivery_closed_price`/`pickup_closed_price` (payAction L1913-1930) **NO s'afegeix a `$total`/`$pay`** — és una columna separada a `sales_order` (order.js:942), no forma part del cobrament Stripe. A més, només es fixa quan es passa `closed_service=1` a `/details`, i el flux headless passa sempre `0`. El builder els deixa null (open-service) → cap infravaloració del pagament.

## Estat delivery: A + B + C FETES. Codis suportats: 0 pickup, 1 domicili, 2 hotel, 3 creuer, 5 aeroport. (4 event fora d'abast.)

## Preguntes obertes (verificar en implementar)
- El `deliveryPrice` va **només a `$total`** (i es comissiona) o també a `priceProduct`/`deliveryPriceIncluded`? Mirar L1834-1835 i el bloc de fees.
- **Antelació mínima** `advanceDays_delivery` (L637 datepicker): el delivery pot requerir més dies d'antelació que el pickup → validar-ho o deixar que `/details` ho reflecteixi.
- Aeroport: es pot seleccionar per `place_id` (estable) en lloc del nom? Si no, el match per nom exacte és fràgil amb traduccions.
- `id_virtual > 0` (botiga virtual): payAction desactiva el delivery de ciutat → mantenir el guardrail.
- Recàrrec `closed_service` quan la botiga està tancada el dia del lliurament.

## Ordre i desplegament
Fase A → B → C. Web per pipeline GitLab; MCP manual (`git pull`+build+restart). API: cap canvi (dada ja a `/details`).
