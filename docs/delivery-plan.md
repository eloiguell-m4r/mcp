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
### Fase A — Lliurament a ciutat (domicili `1` + hotel `2`) — RECOMANAT primer
La més comuna i simple: preu pla `details.delivery_price`, sense match d'aeroport.
- **MCP:** exposar `delivery_price` (i si cal disponibilitat) a `get_rental_details`; a `create_booking` afegir `delivery_type` (1|2) + `delivery_address` (+ `hotel_name` si 2). Treure de la descripció "només recollida".
- **Web (`AiCheckoutController` + builder):** acceptar `delivery` 1/2; validar `delivery_price>0` i `id_virtual==0`; `deliveryPrice = exchange(details.delivery_price → $currency)`; sumar a `$total` (nou paràmetre builder `$deliveryPrice`, com `$optionsTotal`); omplir `delivery`, `delivery_address`, `deliveryPrice`, i (tipus 2) `hotelReservation=1`/`nameHotelReservation`. Validar camps requerits (adreça obligatòria; hotel → nom).
- **Test:** estendre `AiOrderDataBuilderTest` amb un cas amb `deliveryPrice` (suma a total, no a priceProduct? verificar com ho fa payAction — sembla que sí suma a total i el comissiona; confirmar si va a priceProduct).
- **e2e:** Sevilla + `delivery_type=1` + adreça → total = base + delivery_price; +USD; hold amb `delivery`/`delivery_address`/`delivery_price` correctes.

### Fase B — Aeroport (`5`)
`get_rental_details`/nova tool exposa `airports_list` (nom + preu). `create_booking` accepta `delivery_type=5` + `airport_place_id` (millor que el nom, per evitar el match fràgil per string — ⚠️ verificar si payAction pot casar per place_id en lloc del nom) + `flight_number`. El servidor tria el preu de l'aeroport.

### Fase C — Creuer (`3`), event (`4`), `closed_service`
Casos vora: recàrrec `closed_service`/`closed_price` (L1834, L1917), `deliveryPriceIncluded`, `delivery_hotel_on_closed`. Deixar per al final.

## Preguntes obertes (verificar en implementar)
- El `deliveryPrice` va **només a `$total`** (i es comissiona) o també a `priceProduct`/`deliveryPriceIncluded`? Mirar L1834-1835 i el bloc de fees.
- **Antelació mínima** `advanceDays_delivery` (L637 datepicker): el delivery pot requerir més dies d'antelació que el pickup → validar-ho o deixar que `/details` ho reflecteixi.
- Aeroport: es pot seleccionar per `place_id` (estable) en lloc del nom? Si no, el match per nom exacte és fràgil amb traduccions.
- `id_virtual > 0` (botiga virtual): payAction desactiva el delivery de ciutat → mantenir el guardrail.
- Recàrrec `closed_service` quan la botiga està tancada el dia del lliurament.

## Ordre i desplegament
Fase A → B → C. Web per pipeline GitLab; MCP manual (`git pull`+build+restart). API: cap canvi (dada ja a `/details`).
