# Publicar el connector al directori de Claude

Com llistar `mcp.motion4rent.com` al **directori de connectors de Claude** (perquè
qualsevol usuari de Claude el pugui descobrir i afegir, no només nosaltres amb la config
manual de Claude Desktop).

> ⚠️ El procés i les URLs són de mitjans 2026 i estan en evolució. Verifica sempre contra
> la documentació oficial: <https://claude.com/docs/connectors/building> i la seva secció
> `/submission`.

## Requisits previs (compte)

- Pla **Team o Enterprise** de Claude (els plans individuals no tenen _admin settings_).
- Rol **Owner / Primary Owner** (o un rol amb permís "Directory management").

## Requisits tècnics del servidor

- **HTTPS** + transport **Streamable HTTP** (l'HTTP+SSE està en desús). ✅ Ja el tenim.
- Límit de resultat ~150.000 caràcters i timeout de 300 s per crida. ✅ Complim de sobres.
- **Autenticació**: el formulari d'alta ofereix **OAuth 2.0 / connexió personalitzada / cap
  (none)**. La regla d'Anthropic és _"si el servei és autenticat, ha de ser OAuth 2.0"_ — NO
  que hagi de ser autenticat. Per tant hi ha dues vies:
  - **(A) Públic ("none")**: no tenim comptes ni dades per usuari (la PII és com un formulari
    públic, el pagament el tanca Stripe) → aquesta via és vàlida i la més ràpida. Cal afegir
    **rate-limiting** perquè `create_booking` (escriptura) queda exposada.
  - **(B) OAuth 2.1 (PKCE S256) + DCR**: metadades `/.well-known/oauth-protected-resource` +
    servidor d'autorització; redirect de Claude `https://claude.ai/api/mcp/auth_callback`.
    Vegeu `docs/oauth-implementation-plan.md`.
  - ❌ **El que NO val en cap cas és el bearer estàtic actual (`MCP_AUTH_TOKEN`)**: el flux del
    directori no deixa que l'usuari l'enganxi. Per publicar cal passar a (A) o (B).
  - Recomanació: **(A) per entrar ràpid**; **(B)** quan afegim funcions per usuari ("les meves
    reserves") o si els revisors ho demanen per la tool de reserva.
  - **Estat real (2026-07-23): anem per la via (B) OAuth 2.1 i està DESPLEGADA i VERIFICADA en
    prod.** AS = WorkOS AuthKit (`https://dazzling-tradition-17.authkit.app`). Vegeu la
    verificació al final d'aquest document.
- **Anotacions de tools**: totes han de tenir `title` i, segons el cas, `readOnlyHint` o
  `destructiveHint`.
  - Read-only (`readOnlyHint: true`): `check_city_coverage`, `search_mobility_rentals`,
    `get_rental_details`, `list_currencies`, `list_product_options`.
  - `create_booking`: NO és read-only (crea reserva + link de pagament) → cau a la política
    de compliment de **transaccions**; anotar-la com a no-read-only i descriure-la bé.

## Materials a preparar

- **URL de documentació** pública del connector.
- **URL de política de privadesa** (recollida/ús/emmagatzematge/retenció/tercers/contacte).
- **Icona** i **captures (carousel)** si exposem MCP Apps.
- **Compte de prova** amb credencials i **passos detallats** perquè els revisors puguin
  provar totes les tools (p. ex. el truc de Sevilla).
- Textos del listing: **nom** (≤100), **tagline** (≤55), **descripció** (≤2000), categories.

## Procés d'enviament (formulari d'11 passos)

Portal: **`https://claude.ai/admin-settings/directory/submissions/new`**

1. **Introducció** — reconeixes que llistar-lo el fa descobrible.
2. **Connexió** — URL del servidor (`https://mcp.motion4rent.com/mcp`), transport (Streamable
   HTTP), model de connexió d'usuari.
3. **Tools** — es sincronitzen soles; assegura títols + `readOnlyHint`/`destructiveHint`.
4. **Listing** — nom, tagline, descripció, categories, URLs, icona.
5. **Casos d'ús** — escenaris principals, prerequisits, operacions de dades (read/write).
6. **Empresa** — nom, web, contacte principal.
7. **Autenticació** — mètode (OAuth 2.0 / custom / cap). Nosaltres: **OAuth**.
8. **Tractament de dades** — propietat de l'API, proxy de partners, dades de tercers, dades
   de salut, contingut patrocinat.
9. **Test & launch** — credencials del compte de prova + instruccions pas a pas.
10. **Compliment** — acceptar les 7 polítiques (guidelines, APIs, transaccions, media,
    injection, dades, documentació).
11. **Revisió** — verificació final i enviament.

## Revisió

- Anthropic fa proves funcionals de cada tool + escaneig de compliment de polítiques
  (disseny de tools, auth, privadesa, enllaços externs permesos, assets, documentació,
  suport, i que es comporti bé quan es criden totes les tools).
- **Temps**: variable segons cua (sense SLA). Estat a
  `https://claude.ai/admin-settings/directory/submissions`.
- Escalat: **mcp-review@anthropic.com**.

## Resum del que ens falta abans d'enviar

1. ✅ **Auth (B) OAuth 2.1 (WorkOS AuthKit)** — DESPLEGADA i VERIFICADA en prod (2026-07-23; veure
   «Verificació OAuth» a baix). El Resource Server (`server.ts`) valida el JWT (JWKS + `iss`/`exp`/`aud`)
   i exposa la metadata RFC 9728. (L'auth (A) públic + rate-limit segueix al codi com a fallback amb
   `OAUTH_ENABLED=false`.)
2. ✅ **Anotacions** afegides a totes les tools (`tools.ts`): lectura → `readOnlyHint: true`;
   `create_booking` → `readOnlyHint: false, destructiveHint: false, idempotentHint: false`. (Falta desplegar.)
3. ✅ **Política de privadesa**: afegida la secció "Booking through our AI assistant (Claude)"
   a `privacy.phtml` en tots els idiomes del web. (Falta desplegar el web.)
4. ✅ **Compte + guió de prova** per als revisors — guió fet a `docs/listing-directori.md` (auth per
   compte WorkOS dedicat; walkthrough **Barcelona** + **qualsevol producte** + nom **"Anthropic Test"**;
   exemple known-good verificat contra prod). Credencials del compte al guió i **login WorkOS verificat OK**.
5. ✅ Tenir pla **Team/Enterprise** amb rol Owner per accedir al portal.
6. ✅ **Textos del listing** (a `docs/listing-directori.md`) — repassats i dins de límit: nom 11/100,
   tagline 47/55, descripció 1388/2000, icona `favicon-512x512.png` (PNG 512×512 quadrada, 200 OK).
   ✅ **URL de privadesa** (`https://www.motion4rent.com/privacy`) — ara **200** també a peticions
   automàtiques (regla Cloudflare "Allow /privacy" Skip → Super Bot Fight Mode + Browser Integrity Check).
   ✅ **URL de documentació del connector** (`https://www.motion4rent.com/connector`) — pàgina nova al
   web (mòdul Cms: ruta `/connector` + `connectorAction` + `connector.phtml`), servint 200 amb el contingut
   (què és, com afegir-lo, tools, booking/Stripe, privadesa, suport). ⏳ Pendent: triar les **categories**
   del desplegable real del formulari.

## Verificació OAuth (2026-07-23)

Comprovació de la via (B) OAuth 2.1 contra **producció** i contra l'AS (WorkOS AuthKit). Tot ✅.

**Codi (Resource Server, `src/server.ts`):** valida el JWT amb el JWKS remot de l'AS (`jose`),
comprova `iss`/`exp`/`aud` (RFC 8707) i scopes; exposa `/.well-known/oauth-protected-resource`
(RFC 9728); retorna 401 + `WWW-Authenticate: Bearer resource_metadata="…"` quan falta token; manté
el bearer intern com a bypass; CORS exposa `WWW-Authenticate`.

| Comprovació                 | Comanda                                                                                 | Resultat                                                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Protected-resource metadata | `curl https://mcp.motion4rent.com/.well-known/oauth-protected-resource`                 | ✅ `resource`=`https://mcp.motion4rent.com/mcp`; `authorization_servers`=`["https://dazzling-tradition-17.authkit.app"]` |
| `POST /mcp` sense token     | `curl -i -X POST …/mcp`                                                                 | ✅ **401** + `www-authenticate: Bearer resource_metadata="…"`                                                            |
| AS metadata (WorkOS)        | `curl https://dazzling-tradition-17.authkit.app/.well-known/oauth-authorization-server` | ✅ authorize/token/jwks presents                                                                                         |
| **CIMD**                    | (AS metadata)                                                                           | ✅ `client_id_metadata_document_supported: true`                                                                         |
| **DCR**                     | (AS metadata)                                                                           | ✅ `registration_endpoint` present → Claude es registra sol                                                              |
| **PKCE**                    | (AS metadata)                                                                           | ✅ `code_challenge_methods_supported: ["S256"]`                                                                          |
| Grant types                 | (AS metadata)                                                                           | ✅ `authorization_code` + `refresh_token`                                                                                |

Amb això, el pas 7 del formulari (Autenticació = OAuth 2.0) queda cobert: OAuth 2.1, PKCE S256, DCR/CIMD
i redirect dinàmic (no cal registrar cap redirect URI manual de claude.ai).

**Config de prod confirmada:** `OAUTH_AUDIENCE=https://mcp.motion4rent.com/mcp` (coincideix amb el
Resource Indicator i amb `resource` de la metadata).

**✅ Round-trip complet del token — CONFIRMAT (2026-07-23) via `mcp-remote` a Claude Desktop.** Amb el
pont `mcp-remote@latest` apuntant a `https://mcp.motion4rent.com/mcp` (sense bearer), Claude Desktop
completa el flux OAuth end-to-end (DCR + login WorkOS → consent → bescanvi de token PKCE) i **llista i
executa les tools** (respon amb cobertura, etc.). Amb això queda validat tot el costat servidor de
l'OAuth, inclòs l'audience binding (el token que emet WorkOS és acceptat pel Resource Server: signatura

- `iss` + `aud` correctes), que era l'únic punt de risc que advertia `config.ts`.

> **Matís de client:** `mcp-remote` és un pont local (stdio→HTTP) que fa l'OAuth al navegador i cacheja
> el token a `~/.mcp-auth`. El **directori** usa en canvi el **connector remot natiu** (claude.ai connecta
> directe a la URL, token exchange server-side, redirect `claude.ai/api/mcp/auth_callback`). El
> comportament del SERVIDOR és idèntic en tots dos casos, i com que usem DCR/CIMD el redirect de claude.ai
> s'accepta dinàmicament. Check final ideal abans d'enviar: afegir-lo un cop com a **custom connector
> natiu** (Settings → Connectors → Add custom connector, enganxant la URL directament, sense mcp-remote)
> per reproduir exactament el camí del revisor.

> ℹ️ **Nota sobre l'MCP Inspector:** el flux OAuth de l'Inspector (SPA de navegador) pot fallar amb
> `TypeError: Failed to fetch` _després_ del login. És una limitació de CORS del navegador contra el
> token endpoint de WorkOS (la resposta del `POST /oauth2/token` no porta `Access-Control-Allow-Origin`),
> **NO un defecte del connector ni de la config OAuth**: els clients reals de Claude fan el bescanvi del
> token server-side i no s'hi veuen afectats (confirmat amb Claude Desktop, que funciona). Per validar
> l'OAuth, usa Claude Desktop, no l'Inspector.

## Fonts

- [Building custom connectors (docs oficials)](https://claude.com/docs/connectors/building)
- [Get started with custom connectors using remote MCP](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
- [Claude Connector Directory Submission (guia de tercers)](https://sunpeak.ai/blogs/claude-connector-directory-submission/)

WorkOS user authentication for reviewers:
anthropic-review@motion4rent.com
2cC29ptI,[8y3D"=
