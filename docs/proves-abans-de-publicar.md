# Proves pròpies abans de publicar (self-review)

Guió per provar **totes les tools** i **tot el que revisaran** Anthropic/OpenAI, i detectar
problemes abans d'enviar. Fes-ho contra **producció** (`https://mcp.motion4rent.com/mcp`).

## Com provar (tria una)
- **Claude Desktop** (ja connectat via `mcp-remote` + bearer) — el més realista.
- **MCP Inspector** contra prod: `npx @modelcontextprotocol/inspector` → Transport *Streamable HTTP*,
  URL `https://mcp.motion4rent.com/mcp`, header `Authorization: Bearer <MCP_AUTH_TOKEN>`
  (el bearer salta el rate-limit). Veus la resposta JSON crua de cada tool. Vegeu `docs/mcp-inspector.md`.

⚠️ Producció usa Stripe **LIVE**: pots cridar `create_booking` (només torna l'enllaç, no cobra),
però **no paguis** i fes-ho **només amb l'Invacare Leo** de Sevilla (vegeu més avall).

---

## Part 1 — Provar cada tool (7)

| # | Tool | Prompt / crida | Què has de veure (OK) |
|---|------|----------------|------------------------|
| 1 | `check_city_coverage` | "Do you operate in Barcelona?" | Confirma cobertura; si és homònima (p. ex. "Valencia" ES/VE) demana el país. |
| 2 | `search_mobility_rentals` | "Electric wheelchairs in Valencia, 14–15 Aug, pickup/return 10:00" | ~15 resultats **del tipus**, cada un amb **model real** (Librecar Mistral…), specs (pes màx, autonomia, plegable, tipus), **preu final**, foto, `delivery_options`, cancel·lació gratuïta. |
| 3 | `get_rental_details` | "Full details of the first one" | Preu = mateix que la cerca; dipòsit; `delivery_options` correctes; foto; `map_url` (sense nom de botiga); specs. |
| 4 | `list_product_options` | "Any add-ons/extras for that product?" | Llista d'extres amb preu (o buida sense error). |
| 5 | `list_currencies` | "Which currencies can I see prices in?" | Llista de monedes actives del web. |
| 6 | `mobility_policies` (FAQ) | "What is the cancellation policy? And the deposit?" | Resposta de política/FAQ coherent. |
| 7 | `create_booking` | **NOMÉS Invacare Leo** (vegeu Part 3) | Torna `urlTpv` (Stripe). Reserva en *hold*, **no cobra**. |

Prova també **moneda** ("show prices in USD") i **filtre per tipus** ("only scooters in Valencia").

---

## Part 2 — El que revisaran (checklist de compliment)

- [ ] **Cada tool funciona** i no peta / no penja (proven totes, fins i tot amb dades mínimes).
- [ ] **Anotacions correctes**: les de lectura marcades `readOnlyHint`; `create_booking` com a
      escriptura (no destructiva). (A `tools.ts`; es veuen a `tools/list` a l'Inspector.)
- [ ] **Auth**: `/mcp` públic (o el que declaris al formulari) + **rate-limit** actiu.
- [ ] **Política de privadesa** accessible (`/privacy`) i amb la secció del connector d'IA
      (què recollim, Stripe, retenció).
- [ ] **Descripcions exactes**: el que diu la tool = el que fa (res enganyós ni "from/approx").
- [ ] **No exposar dades internes**: mai `id_store`/`id_product_store`/`id_supplier` ni el
      **nom de la botiga** a l'usuari (només `map_url`).
- [ ] **Enllaços externs** només als dominis esperats: mapa (google.com/maps), imatge
      (cloudfront), pagament (Stripe / motion4rent). Cap altre.
- [ ] **Preus = web**: el `total` coincideix amb el web (inclou fee de gestió + taxes; i
      recàrrec de festiu `closed_service` quan aplica).
- [ ] **Fotos**: `image_url` vàlid i clicable.
- [ ] **Es comporta bé quan es criden TOTES les tools** seguits (sense estat compartit trencat).
- [ ] **Latència raonable** (sense timeouts).

---

## Part 3 — Casos límit i correctesa (els que fallen més)

- [ ] **Ciutat homònima**: "wheelchair in Valencia" sense país → ha de demanar el país (ES/VE).
- [ ] **Sense disponibilitat**: dates/ciutat sense estoc → missatge clar + `booking_link`, sense petar.
- [ ] **Pickup NO disponible** (botiga virtual, p. ex. València): a `get_rental_details` **NO**
      apareix "Store pickup"; i si forces `create_booking` amb pickup → **400 `pickup_not_available`**.
- [ ] **Filtre per tipus complet**: "electric wheelchairs in Valencia" → mostra'ls tots (≈15),
      no només 3; "scooters" → fins al sostre 25 amb nota "showing X of Y".
- [ ] **Festiu (`closed_service`)**: el preu amb recollida/entrega en dia festiu inclou el recàrrec
      (p. ex. l'exemple 14–15 Ago València: 104 €, no 84 €).
- [ ] **Moneda**: demanar USD → preus convertits; el dipòsit es manté en la moneda del proveïdor.
- [ ] **Reserva de prova (Sevilla, divendres 23:00→23:00):**
  - Cerca "mobility scooters in Seville for Friday <divendres futur>, pickup/return 23:00".
  - **`create_booking` NOMÉS del "Invacare Leo" (id 8621)** → torna `urlTpv`. **NO paguis.**
  - ⚠️ **NO reservis** el "Manual wheelchair" (id 559) ni cap altre → seria reserva REAL.
- [ ] **Rate-limit** (sense bearer): >30 peticions/min per IP → `429`.

---

## Resultat
Anota aquí què falla per corregir-ho abans d'enviar:

| Prova | OK / KO | Nota |
|-------|---------|------|
| Tools 1–7 | | |
| Compliment (Part 2) | | |
| Casos límit (Part 3) | | |

## Relacionats
- `docs/listing-directori.md` (textos + instruccions de prova per als revisors, en anglès)
- `docs/publicar-directori-claude.md` · `docs/publicar-chatgpt.md` · `docs/mcp-inspector.md`
