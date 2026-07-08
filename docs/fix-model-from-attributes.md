# Model + specs reals del producte: vénen de `products/load`, no de `/details`

## Símptoma
El llistat del MCP mostrava "Electric wheelchair" (tipus genèric) i unes poques
dimensions, en lloc del MODEL real ("Librecar Mistral", "Martinika", "Totalcare
Kittos Country"…) i les specs que ensenya el web (pes màx, autonomia, plegable, tipus).

## Causa
El web carrega la fitxa de cada producte amb l'endpoint
`products/load/{id_product_store}/{id_virtual}/{radius}/{type_att}/{same_city}/{id_virtual_real}`
(`ResultsController::loadProductAction`). Aquest endpoint retorna els atributs REALS
del producte, inclosos `brand` i `model` (varchar) i `max_weight`, `autonomy`,
`folding`, `type`, `material`… i la imatge real.

El MCP, en canvi, treia el model de `/details` (camp top-level buit) i les specs dels
atributs de `/details`, que corresponen al FILL (dimensions: vehicle_width/large/
seat_width) — no al producte que mostra el web.

⚠️ El path param `:id_product` de `products/load` és en realitat `stores_products.id`
(= `id_product_store`), NO `products.id`.

## Fix (MCP)
- **m4rApi.ts**: `getProductLoad()` nou → crida `products/load` i extreu
  `brand`/`model` (→ `title`), la imatge real i les specs (label: value, resolent
  select/multiple/yesno). `Producto` i `DetallProducto` guarden `type_att`,
  `same_city`, `id_virtual_real` (params de products/load).
- **tools.ts / search**: cada producte s'enriqueix EN PARAL·LEL amb `/details`
  (preu/lliurament/pickup/cancel·lació) **i** `products/load` (model + specs + imatge).
  `name` = brand+model; `attributes` = specs de products/load; `image_url` = imatge real.
- **tools.ts / get_rental_details**: després de `/details`, crida `products/load`
  (type_att derivat del detail) i afegeix `product.name` (model), `product.attributes`.

## Verificat (dades prod via Docker)
- 14183 → **Librecar Mistral** · Max weight 91-100 · Range 18 · Folding Yes · Type Standard · Aluminum
- 3185 → **Martinika** · 1632 → **Totalcare Kittos Country**
- `npm run build` net.

## Cost
Ara cada producte del llistat fa 2 crides (/details + products/load), en paral·lel.
Sostre 25 → fins a 50 crides paral·leles per cerca; assumible en prod.

## Desplegament (MCP)
```
cd /var/www/mcp && git pull && npm ci && npm run build && sudo systemctl restart motion4rent-mcp
```
