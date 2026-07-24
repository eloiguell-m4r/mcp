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
- Autenticació: **OAuth 2.1** (AS = WorkOS AuthKit; DCR/CIMD + PKCE S256). Verificat en prod
  (veure `docs/publicar-directori-claude.md` → «Verificació OAuth»). El rate-limit per IP queda
  com a backstop. (Ja NO és públic: tota crida a `/mcp` requereix un token vàlid.)

## Instruccions de prova per als revisors

### ▶ PER ENGANXAR AL FORMULARI (anglès)

```
AUTHENTICATION
This connector uses OAuth 2.0 (Streamable HTTP). When you add it, you'll be redirected to a
sign-in screen (WorkOS). Please sign in with this dedicated test account:

    email:    anthropic-review@motion4rent.com
    password: 2cC29ptI,[8y3D"=

The connector has no per-user data or accounts of its own — the login only issues the OAuth
token. No personal data of yours is stored or used.

WHAT IT DOES / SAFETY
All discovery tools are read-only. The one write tool, create_booking, only creates an UNPAID
hold and returns a Stripe payment LINK — no one is notified and no money moves unless that link
is opened and paid. Please do NOT open/pay the link. You can book ANY available product. Please
enter "Anthropic Test" as the first name (and your own name as the last name) so we can identify
the booking as a review test.

SUGGESTED WALKTHROUGH (any city/dates work — this is just a known-good example)
1) Coverage — "Do you operate in Barcelona?"  → confirms coverage (asks for the country if the
   city name is ambiguous, e.g. Valencia ES/VE).
2) Search — "Search mobility equipment in Barcelona from 2026-08-10 to 2026-08-11, pickup at
   11:00 and return at 16:00."  → products with the FINAL price (taxes + management fee
   included), photo, specs, delivery options and extras.
3) Details — "Show full details of the first one."  → deposit, delivery options, extras, photo,
   map link.
4) Booking (optional) — "Book that one for Anthropic Test <your surname>, reviewer@example.com,
   +34600000000, Spain."  → create_booking returns a Stripe payment link (unpaid hold; nobody is
   charged or notified; just ignore the link).
5) Other tools — list_currencies ("Which currencies can I see prices in?"),
   list_product_options ("Any add-ons for that product?"), Policies & FAQ ("What is the
   cancellation policy? And the deposit?").

Tip: search also accepts a currency ("show prices in USD") and a product-type filter
("only mobility scooters in Barcelona").
```

### Notes internes (no enganxar)

**Compte de prova (OAuth / WorkOS):** cal CREAR-lo abans d'enviar el formulari i posar-hi els valors
reals a `<TEST_ACCOUNT_EMAIL>` / `<TEST_ACCOUNT_PASSWORD>`. Es crea a l'entorn **Production** de WorkOS
(Users → Create user, o registre normal des de la pantalla de login d'AuthKit). No dona accés a res
nostre: només emet el token OAuth.

**Reserva de prova — qualsevol producte és segur.** Un _hold_ NO notifica ningú (ni el proveïdor) i NO
cobra res mentre no s'obri i es pagui l'enllaç Stripe (confirmat). Per això el guió deixa reservar
qualsevol producte i només demana posar **"Anthropic Test"** al nom → així identifiquem la reserva com
a prova. (Ja no cal restringir-ho a la botiga de test ni a la finestra divendres/23:00.)

**Exemple known-good (verificat 2026-07-24 contra prod):** Barcelona, 2026-08-10→2026-08-11, recollida
11:00 / tornada 16:00 → 122 opcions de tots els tipus. Alternatives igual de bones: València (65),
Màlaga (41), Madrid (36). Hores diürnes qualssevol (10–16h) van bé; les dates només han de ser futures
(actualitza-les si cal quan enviïs).

## Notes

- ⚠️ **DOMINI (evitar "bikes").** Abans de connectar, l'assistent només veu aquesta fitxa; si el text és
  vague extrapola i inventa categories (bug real: deia _"scooters and bikes"_). Per això la descripció
  esmenta **només ajudes de mobilitat** i inclou l'**exclusió explícita** (no bicis/e-bikes/motos/cotxes),
  i les taglines diuen **"mobility scooters"**, no "scooters" pelat. Mantén-ho en publicar i en qualsevol
  camp lliure (tags/casos d'ús): res de "bikes"/"scooters" genèric ni icona de vehicle de dues rodes.
  En runtime ja ho reforcen `SERVER_INSTRUCTIONS` (`src/server.ts`) i la descripció de
  `search_mobility_rentals` (`src/tools.ts`) — la fitxa ha de dir el mateix (capa pre-connexió).
- Les **anotacions** de tools ja hi són (`readOnlyHint` a les de lectura; `create_booking` marcada
  com a escriptura no destructiva). Vegeu `docs/publicar-directori-claude.md`.
- ChatGPT demana a més **logo/icona**, **captures de pantalla** i **prompts de prova amb la resposta
  esperada** (reutilitza els casos d'ús d'aquí). Vegeu `docs/publicar-chatgpt.md`.
