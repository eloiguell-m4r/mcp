# Fix: la cerca només mostrava 3 d'un tipus quan n'hi ha molts més

## Símptoma
Buscant "cadires elèctriques a València" el MCP en mostrava **3**, quan a la
BD n'hi ha **15**.

## Causa (dos factors combinats)
1. **La cerca no filtrava per tipus.** El paràmetre `product_type` només s'usava
   per al deep-link; a l'API es cridava sempre amb `type: 0` (tots els tipus).
   València té 101 resultats barrejats i el rànquing el dominen els scooters (44).
2. **Sostre d'enriquiment = 10.** Només s'enriquien/retornaven els 10 primers.
   D'aquests 10 barrejats, només **3** eren cadires elèctriques (posicions 3, 8, 9);
   les altres 12 quedaven més enllà del 10 i no sortien mai.

## Per què hi ha un sostre (no és arbitrari)
Cada producte mostrat dispara **una crida `getDetails` pròpia** (model, preu exacte
amb fees, atributs, opcions de lliurament). N mostrats = N crides a l'API per cerca.
Sense sostre, un llistat de 101 = 101 crides + allau de fitxes al context del client.

## Decisió
- Mostrar TOTS els 101 sense filtrar: incoherent (lent, sorollós, irrellevant).
- Mostrar tots els **del tipus demanat** (15 cadires): coherent — és el que fa el web
  quan filtres. 15 és assumible.

## Canvis (només MCP, tools.ts)
1. Quan es passa `product_type`, els **resultats** es filtren a aquest tipus:
   - Es resol el tipus canònic contra `typesProducts` per solapament de tokens.
   - Es filtren els productes el `name` dels quals coincideix amb aquest tipus.
   - Si no hi ha coincidència (p. ex. query en un idioma diferent al dels noms),
     **fallback**: es mostra tot (millor que amagar-ho).
2. Sostre pujat de 10 → **`MAX_PRODUCTS` (25)**: es mostren TOTS els del tipus
   fins a 25; si n'hi ha més, nota "showing 25 of 44, obre el link".
3. Sortida nova: `count` (del tipus filtrat), `total_all_types`, `type_filter`.

## Verificat (offline, dades prod via Docker)
- "electric wheelchair" → 15 · "scooter" → 44 · "manual" → 10 (abans: 3).
- `npm run build` net.

## Nota de rendiment
- La cerca en LOCAL triga ~46 s (Docker parla amb la BD de producció per xarxa);
  en producció (BD co-localitzada) és ràpida. No és un problema de codi.
- El sostre 25 implica fins a 25 `getDetails` en paral·lel per cerca; assumible en prod.

## Desplegament (només MCP)
```
cd /var/www/mcp && git pull && npm ci && npm run build && sudo systemctl restart motion4rent-mcp
```
