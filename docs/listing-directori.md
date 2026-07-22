# Textos del listing (directori Claude + ChatGPT)

Esborrany dels camps de la fitxa per als dos directoris (els camps es solapen molt). Anglès
com a idioma principal. Retoca lliurement.

## Camps bàsics

**Nom** (≤100)
```
Motion4Rent
```
(marca; evitem noms genèrics d'una paraula que no siguin marca — aquest ho és)

**Tagline** (≤55) — tria'n una. ⚠️ Digues **"mobility scooters"**, no "scooters" a seques (evita que
s'entengui com a patinets/motos):
```
Rent wheelchairs & mobility scooters, delivered
```
(47 car.) · alternatives:
```
Mobility equipment rentals in cities worldwide       (50)
Wheelchairs & mobility scooters, delivered on trips  (51)
```

**Descripció** (≤2000)
```
Motion4Rent lets you rent mobility equipment — manual and electric wheelchairs, mobility scooters, knee walkers, rollators and similar mobility aids — in cities around the world, through a network of trusted local partners. It rents mobility aids only: not bicycles, e-bikes, motorbikes or cars.

Tell the assistant your city and travel dates and it finds available equipment with the FINAL price (taxes and management fee already included — no surprises), product photos, key specs (max weight, range, folding, type) and the delivery options that actually apply: store pickup, delivery to your home, hotel or apartment, airport, or cruise port. When you're ready, it prepares the booking and returns a secure Stripe payment link you open to pay — the assistant never sees or handles your card details.

No account needed: you simply provide the booking details (name, email, phone, country) in the conversation, like filling in a booking form. Free-cancellation windows and deposit terms are shown up front, and prices can be displayed in the currency you choose.

Ideal for travelers with reduced mobility, people recovering from surgery, families arranging equipment for an elderly relative, or anyone who needs mobility gear at their destination without carrying their own.

Operated by Motion4Rent (TimetoMobility S.L.). Payments are processed by Stripe under its own privacy policy.
```

**Categories** (tria del desplegable real; suggeriment)
- Principal: **Travel**
- Secundàries: **Shopping** i/o **Health & Wellness / Accessibility**

## Casos d'ús (pas "Use cases")
- "Find and rent an electric wheelchair in Valencia for 14–15 August, delivered to my hotel."
- "What mobility scooters are available in Seville next weekend, and how much with delivery?"
- "Book a manual wheelchair in Barcelona and give me the payment link."
- "Rent a rollator for my mother in Lisbon, with airport delivery."

**Operacions de dades:** lectura (cerca de disponibilitat i preus) + escriptura (crear una reserva).
**Dades personals recollides:** nom, email, telèfon, país (per crear la reserva). El pagament el
processa **Stripe** (no rebem ni guardem dades de targeta).

## Empresa / contacte
- Empresa: **TimetoMobility S.L.** (marca **Motion4Rent**) · NIF B10698660
- Web: `https://www.motion4rent.com`
- Contacte: `info@motion4rent.com`
- Política de privadesa: `https://www.motion4rent.com/privacy` (inclou la secció del connector d'IA)
- Adreça: Passeig Gallifa 1, 08250 Sant Joan de Vilatorrada (Barcelona), Espanya
- **Icona** (quadrada 512×512, de marca amb el símbol de cadira de rodes): `https://www.motion4rent.com/favicon-512x512.png`
  (NO usar `logo-c1.png`: és un wordmark horitzontal 285×74, no serveix d'icona. Opcional futur: versió simplificada només-símbol per a més nitidesa a mida petita.)

## Connexió (dades tècniques)
- URL MCP: `https://mcp.motion4rent.com/mcp`
- Transport: **Streamable HTTP**
- Autenticació: **cap (públic)** + rate-limit per IP (o OAuth més endavant)

## Instruccions de prova per als revisors

### ▶ PER ENGANXAR AL FORMULARI (anglès)
```
No login is required to browse — this is a public connector (OAuth is used when adding it
via the directory). You can exercise ALL tools freely with ANY city or product; there are
no side effects and no one is charged.

Suggested walkthrough:
1) Search — "Electric wheelchairs in Valencia from 2026-08-14 to 2026-08-15, pickup and
   return at 10:00." Returns products with the final price (taxes and fee included), photo,
   specs, delivery options and extras.
2) Details — "Show full details of the first one." Deposit, delivery options, extras, photo.
3) Booking (optional) — "Book it for John Tester, john@example.com, +34600000000, Spain."
   create_booking returns a Stripe PAYMENT LINK (urlTpv). It NEVER charges anyone: the
   booking stays an unpaid hold (an internal note on our side only — no third party is
   notified and no money moves unless the link is opened and paid). Just ignore the link.

Other tools: check_city_coverage ("Do you operate in Barcelona?"), list_currencies,
list_product_options, Policies & FAQ ("What is the cancellation policy?").
```

### Notes internes (no enganxar)
> No cal cap compte ni login (connector públic).

⚠️ **MOLT IMPORTANT — quin producte reservar.** La reserva de prova s'ha de fer NOMÉS amb el
**"Mobility scooter — Invacare Leo"** de Sevilla (és de la botiga de proves). La cerca de Sevilla
també retorna una **"Manual wheelchair"** que és d'una botiga REAL: **NO** s'ha de reservar (crearia
una reserva real amb notificacions al proveïdor). No diguis mai "reserva el primer resultat".

Finestra de prova: **qualsevol divendres**, recollida i tornada a les **23:00** (aquesta franja fa
que Sevilla mostri disponibilitat encara que sigui fora d'horari). Exemple: divendres 2026-07-24
(usa un divendres futur).

1. **Descoberta:** *"Search mobility scooters in Seville for Friday 2026-07-24, pickup and return at
   23:00."* → retorna productes amb preu final, foto, specs i lliurament.
2. **Detall:** *"Show full details of the Invacare Leo mobility scooter."* → dipòsit, lliurament, extres.
3. **Reserva (només l'Invacare Leo):** *"Book the Invacare Leo mobility scooter for John Tester,
   john@example.com, +34600000000, Spain."* → `create_booking` retorna un **enllaç de pagament Stripe
   (urlTpv)**. ⚠️ La reserva neix en *hold* i **no es cobra res** si no s'obre i es paga l'enllaç;
   es pot ignorar/deixar caducar.

## Notes
- ⚠️ **DOMINI (evitar "bikes").** Abans de connectar, l'assistent només veu aquesta fitxa; si el text és
  vague extrapola i inventa categories (bug real: deia *"scooters and bikes"*). Per això la descripció
  esmenta **només ajudes de mobilitat** i inclou l'**exclusió explícita** (no bicis/e-bikes/motos/cotxes),
  i les taglines diuen **"mobility scooters"**, no "scooters" pelat. Mantén-ho en publicar i en qualsevol
  camp lliure (tags/casos d'ús): res de "bikes"/"scooters" genèric ni icona de vehicle de dues rodes.
  En runtime ja ho reforcen `SERVER_INSTRUCTIONS` (`src/server.ts`) i la descripció de
  `search_mobility_rentals` (`src/tools.ts`) — la fitxa ha de dir el mateix (capa pre-connexió).
- Les **anotacions** de tools ja hi són (`readOnlyHint` a les de lectura; `create_booking` marcada
  com a escriptura no destructiva). Vegeu `docs/publicar-directori-claude.md`.
- ChatGPT demana a més **logo/icona**, **captures de pantalla** i **prompts de prova amb la resposta
  esperada** (reutilitza els casos d'ús d'aquí). Vegeu `docs/publicar-chatgpt.md`.
