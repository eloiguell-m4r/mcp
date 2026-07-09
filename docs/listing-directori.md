# Textos del listing (directori Claude + ChatGPT)

Esborrany dels camps de la fitxa per als dos directoris (els camps es solapen molt). Anglès
com a idioma principal. Retoca lliurement.

## Camps bàsics

**Nom** (≤100)
```
Motion4Rent
```
(marca; evitem noms genèrics d'una paraula que no siguin marca — aquest ho és)

**Tagline** (≤55) — tria'n una:
```
Rent wheelchairs & scooters worldwide, delivered
```
(48 car.) · alternatives:
```
Mobility equipment rentals in cities worldwide      (50)
Wheelchairs & scooters, delivered where you travel   (51)
```

**Descripció** (≤2000)
```
Motion4Rent lets you rent mobility equipment — manual and electric wheelchairs, mobility scooters, knee walkers, rollators and more — in cities around the world, through a network of trusted local partners.

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

## Connexió (dades tècniques)
- URL MCP: `https://mcp.motion4rent.com/mcp`
- Transport: **Streamable HTTP**
- Autenticació: **cap (públic)** + rate-limit per IP (o OAuth més endavant)

## Instruccions de prova per als revisors
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
- Les **anotacions** de tools ja hi són (`readOnlyHint` a les de lectura; `create_booking` marcada
  com a escriptura no destructiva). Vegeu `docs/publicar-directori-claude.md`.
- ChatGPT demana a més **logo/icona**, **captures de pantalla** i **prompts de prova amb la resposta
  esperada** (reutilitza els casos d'ús d'aquí). Vegeu `docs/publicar-chatgpt.md`.
