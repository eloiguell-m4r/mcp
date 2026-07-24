# Checklist d'enviament al directori de Claude — els 11 passos

Valors exactes a introduir a cada pas del formulari
(`https://claude.ai/admin-settings/directory/submissions/new`).
Font dels textos: `docs/listing-directori.md`. Estat tècnic: `docs/publicar-directori-claude.md`.

> Requisits previs: pla **Team/Enterprise** + rol **Owner** (o "Directory management"). ✅

---

## Pas 1 — Introducció
Reconeixes que llistar el connector el fa **descobrible** per a qualsevol usuari de Claude.
→ Llegeix i accepta. Res a omplir.

---

## Pas 2 — Connexió
| Camp | Valor |
|---|---|
| Server URL | `https://mcp.motion4rent.com/mcp` |
| Transport | **Streamable HTTP** |
| Model de connexió d'usuari | **OAuth** (cada usuari s'autentica en afegir el connector) |

---

## Pas 3 — Tools
Es **sincronitzen soles** des del servidor. Només cal verificar que apareixen amb títol i les
anotacions correctes (ja estan al codi, `src/tools.ts`):

| Tool | Anotació |
|---|---|
| `check_city_coverage` | read-only |
| `find_nearby_cities_with_coverage` | read-only |
| `list_coverage_cities` | read-only |
| `search_mobility_rentals` | read-only |
| `get_rental_details` | read-only |
| `list_product_options` | read-only |
| `list_currencies` | read-only |
| `mobility_policies` | read-only |
| `create_booking` | **escriptura** (no destructiva) — crea reserva + link de pagament |

---

## Pas 4 — Listing
| Camp | Valor |
|---|---|
| **Nom** (≤100) | `Motion4Rent` |
| **Tagline** (≤55) | `Rent wheelchairs & mobility scooters, delivered` |
| **Descripció** (≤2000) | ⬇️ (bloc de sota) |
| **Categories** | Principal **Travel**; secundàries **Shopping** i/o **Health & Wellness / Accessibility** (tria del desplegable real) |
| **URL de documentació** | `https://www.motion4rent.com/connector` |
| **URL de política de privadesa** | `https://www.motion4rent.com/privacy` |
| **Icona** (512×512) | `https://www.motion4rent.com/favicon-512x512.png` |

**Descripció (enganxar):**
```
Motion4Rent lets you rent mobility equipment — manual and electric wheelchairs, mobility scooters, knee walkers, rollators and similar mobility aids — in cities around the world, through a network of trusted local partners. It rents mobility aids only: not bicycles, e-bikes, motorbikes or cars.

Tell the assistant your city and travel dates and it finds available equipment with the FINAL price (taxes and management fee already included — no surprises), product photos, key specs (max weight, range, folding, type) and the delivery options that actually apply: store pickup, delivery to your home, hotel or apartment, airport, or cruise port. When you're ready, it prepares the booking and returns a secure Stripe payment link you open to pay — the assistant never sees or handles your card details.

No account needed: you simply provide the booking details (name, email, phone, country) in the conversation, like filling in a booking form. Free-cancellation windows and deposit terms are shown up front, and prices can be displayed in the currency you choose.

Ideal for travelers with reduced mobility, people recovering from surgery, families arranging equipment for an elderly relative, or anyone who needs mobility gear at their destination without carrying their own.

Operated by Motion4Rent (TimetoMobility S.L.). Payments are processed by Stripe under its own privacy policy.
```
⚠️ **DOMINI:** en qualsevol camp lliure (tags, casos d'ús), digues sempre **"mobility scooters"**, mai
"scooters" a seques, i mai "bikes" — el connector NO lloga bicis/e-bikes/motos/cotxes.

---

## Pas 5 — Casos d'ús
Escenaris principals (enganxar):
```
Find and rent an electric wheelchair in Valencia for 14–15 August, delivered to my hotel.
What mobility scooters are available in Seville next weekend, and how much with delivery?
Book a manual wheelchair in Barcelona and give me the payment link.
Rent a rollator for my mother in Lisbon, with airport delivery.
```
- **Operacions de dades:** lectura (cerca de disponibilitat i preus) + **escriptura** (crear una reserva).
- **Dades personals recollides:** nom, email, telèfon, país (per crear la reserva).
- **Pagament:** el processa **Stripe** (no rebem ni guardem dades de targeta).

---

## Pas 6 — Empresa
| Camp | Valor |
|---|---|
| Empresa | **TimetoMobility S.L.** (marca **Motion4Rent**) |
| NIF | B10698660 |
| Web | `https://www.motion4rent.com` |
| Contacte principal | `info@motion4rent.com` |
| Adreça | Passeig Gallifa 1, 08250 Sant Joan de Vilatorrada (Barcelona), Espanya |

---

## Pas 7 — Autenticació
| Camp | Valor |
|---|---|
| Mètode | **OAuth 2.0** |

Detall (si el demana): AS = WorkOS AuthKit (`https://dazzling-tradition-17.authkit.app`), OAuth 2.1
amb **PKCE S256** + **DCR/CIMD**; redirect dinàmic (no cal registrar cap redirect URI). Desplegat i
verificat en prod (`docs/publicar-directori-claude.md` → «Verificació OAuth»).

---

## Pas 8 — Tractament de dades
| Pregunta | Resposta |
|---|---|
| Propietat de l'API | **Pròpia** — `motion4rent-api` és nostra (TimetoMobility S.L.). |
| Proxy de partners / dades de tercers | **Sí, inventari de partners:** disponibilitat, preus i dades de botiga vénen de proveïdors locals de confiança. NO es comparteixen dades personals de l'usuari amb tercers tret de l'estrictament necessari per gestionar la reserva. |
| Dades de tercers | El pagament el processa **Stripe** (sota la seva pròpia política); no rebem dades de targeta. |
| Dades de salut | **No** es recullen dades mèdiques/de salut (només nom, email, telèfon, país per a la reserva). ⚠️ Verifica com ho formula el formulari: el producte és material de mobilitat/accessibilitat, però no demanem cap diagnòstic ni dada clínica. |
| Contingut patrocinat | **No.** |

---

## Pas 9 — Test & launch
- **Compte de prova (OAuth/WorkOS):** email + contrasenya → **veure `docs/listing-directori.md`**
  (secció "Instruccions de prova per als revisors", credencials reals ja posades).
- **Instruccions pas a pas per als revisors:** enganxa el bloc en anglès de `docs/listing-directori.md`
  → secció **"▶ PER ENGANXAR AL FORMULARI"** (auth amb el compte de prova + walkthrough Barcelona +
  qualsevol producte + nom "Anthropic Test"; el hold no cobra ni notifica ningú).

---

## Pas 10 — Compliment (acceptar les 7 polítiques)
- [ ] Guidelines de disseny de tools (títols + hints; domini estricte "mobility aids").
- [ ] APIs (propietat pròpia; partners declarats al pas 8).
- [ ] **Transaccions** (aplica a `create_booking`: crea reserva + link Stripe; descrita com a escriptura).
- [ ] Media (fotos: CloudFront; mapes: google.com/maps).
- [ ] Injection.
- [ ] Dades (privadesa a `/privacy` amb la secció del connector d'IA).
- [ ] Documentació (`/connector`).

---

## Pas 11 — Revisió i enviament
- [ ] Repassa tots els camps.
- [ ] Envia.
- Estat: `https://claude.ai/admin-settings/directory/submissions` · Escalat: `mcp-review@anthropic.com`.

---

## Pendents abans de clicar "Submit"
1. ✅ Compte WorkOS creat i login verificat.
2. ✅ `/privacy` i `/connector` → 200 (regla Cloudflare desplegada, cobreix les dues rutes).
3. ⏳ Triar les **categories** del desplegable real (pas 4).
4. ⏳ Confirmar la formulació exacta de la pregunta de **dades de salut** (pas 8) i respondre-hi amb precisió.
