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

1. ✅ **Auth (A) públic + rate-limiting** implementat (`server.ts`): `/mcp` públic per defecte,
   bearer com a bypass intern, rate-limit per IP. (Falta desplegar-ho a prod.)
2. ✅ **Anotacions** afegides a totes les tools (`tools.ts`): lectura → `readOnlyHint: true`;
   `create_booking` → `readOnlyHint: false, destructiveHint: false, idempotentHint: false`. (Falta desplegar.)
3. ✅ **Política de privadesa**: afegida la secció "Booking through our AI assistant (Claude)"
   a `privacy.phtml` en tots els idiomes del web. (Falta desplegar el web.)
4. Preparar **compte + guió de prova** per als revisors (truc de Sevilla).
5. ✅ Tenir pla **Team/Enterprise** amb rol Owner per accedir al portal.
6. Preparar textos del listing (nom, tagline, descripció, categories, icona).

## Fonts

- [Building custom connectors (docs oficials)](https://claude.com/docs/connectors/building)
- [Get started with custom connectors using remote MCP](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
- [Claude Connector Directory Submission (guia de tercers)](https://sunpeak.ai/blogs/claude-connector-directory-submission/)
