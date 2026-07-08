# Fix: no oferir "recollida a botiga" quan no està disponible

## Problema
El MCP deia sempre "recollida a botiga gratuïta" (Store pickup, free), fins i tot per
productes de **botiga virtual**, on la recollida física NO existeix. El web ho mostra
correctament: "Pickup at store: **No**".

## Causa
A `get_rental_details` (tools.ts) l'opció `{ delivery_type: 0, label: "Store pickup" }`
s'afegia **sempre**, sense mirar si la botiga en té.

## Senyal correcte
`/details` → `store.pickup`:
- Botiga virtual (p.ex. 14183 València): `store.pickup = 0` → **sense** recollida.
- Botiga física (p.ex. 1487 Barcelona): `store.pickup = 1` → **amb** recollida.

## Canvis
1. **m4rApi.ts** — `DetallProducto.pickup_available` nou camp;
   `normalizeDetails` el calcula: `(store.pickup ?? data[0].pickup) > 0`.
2. **tools.ts** (`get_rental_details`) — l'opció `delivery_type: 0` (Store pickup)
   només s'afegeix si `detail.pickup_available`.
3. **AiCheckoutController.php** — guard nou: si es reserva amb `delivery_type = 0`
   (pickup) i la botiga no en té → **400 `pickup_not_available`** (hint: triar
   lliurament domicili/hotel/aeroport). Evita reservar pickup inexistent (era el
   valor per defecte).

## Verificat
- 14183 (virtual): `pickup_available = false`, `delivery_available = true`, `price_total = 104`.
- 1487 (físic): `pickup_available = true`.
- `npm run build` net, `php -l` net.

## Desplegament
- **Web** (AiCheckoutController): via pipeline GitLab (`git push`).
- **MCP** (manual):
  ```
  cd /var/www/mcp && git pull && npm ci && npm run build && sudo systemctl restart motion4rent-mcp
  ```
