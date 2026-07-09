# Pla per implementar OAuth al connector MCP

> ⚠️ **OAuth NO és obligatori per al directori.** El formulari d'alta accepta autenticació
> **OAuth / personalitzada / cap (none)**, i el nostre connector no té comptes ni dades per
> usuari → es pot publicar **públic ("none")** (vegeu `docs/publicar-directori-claude.md`,
> opció A). Aquest pla és l'**opció B**: aplica-la NOMÉS si volem accés autenticat (p. ex.
> per afegir "les meves reserves"/"cancel·la la meva reserva", o si els revisors ho demanen
> per la tool `create_booking`). El que NO val en cap cas és el bearer estàtic actual.

Si triem accés autenticat: el servidor ha de parlar OAuth 2.1, no un bearer estàtic. Aquest
doc explica què cal fer, amb el mínim d'esforç.

## La idea que ho simplifica
Segons l'spec d'MCP (2025-11-25), el nostre servidor és NOMÉS un **Resource Server (RS)**.
NO implementem OAuth sencer. La feina "difícil" (autenticar l'usuari, consentiment, PKCE,
emetre i signar tokens, Dynamic Client Registration) la fa un **Authorization Server (AS)**,
que pot ser **extern**. Nosaltres:
1. Afegim una capa fina al servidor (metadades + validació de token).
2. **Delegem l'AS a un proveïdor gestionat** (o el muntem, no recomanat).

⚠️ Important: no tenim comptes d'usuari ni dades per usuari. L'OAuth aquí serveix per
autoritzar el CLIENT (Claude/ChatGPT) en nom d'un usuari que fa login (email/social) al
proveïdor. No cal construir cap base d'usuaris pròpia.

## Què ha de fer el NOSTRE servidor (Resource Server) — poc codi
A `src/server.ts`:

1. **Metadada de recurs protegit** (RFC 9728) — nou endpoint:
   `GET /.well-known/oauth-protected-resource` →
   ```json
   {
     "resource": "https://mcp.motion4rent.com/mcp",
     "authorization_servers": ["https://<AS-issuer>"],
     "scopes_supported": ["mcp:use"],
     "bearer_methods_supported": ["header"]
   }
   ```
2. **Repte 401** quan no hi ha token o és invàlid:
   ```
   HTTP/1.1 401 Unauthorized
   WWW-Authenticate: Bearer resource_metadata="https://mcp.motion4rent.com/.well-known/oauth-protected-resource", scope="mcp:use"
   ```
3. **Validació del token** a cada `POST /mcp` (substitueix l'actual `authorized()` de bearer estàtic):
   - Verificar signatura JWT contra el **JWKS** de l'AS (llibreria `jose`).
   - Comprovar `iss` == AS, `exp` no caducat, i **`aud` == `https://mcp.motion4rent.com/mcp`**
     (audience binding, RFC 8707 — crític de seguretat).
   - Scope insuficient → `403` amb `WWW-Authenticate: Bearer error="insufficient_scope", scope="mcp:use"`.
   - **No** reenviar mai aquest token a l'API interna (token passthrough prohibit).
4. Mantenir el **bearer estàtic** només com a opció interna/local (o treure'l).

Tot això és HTTP-transport; en **stdio** (local) NO s'aplica OAuth (credencials per entorn).

## Què fa l'Authorization Server (el proveïdor)
- OAuth 2.1 + **PKCE S256**, authorization code flow.
- Metadada AS: `/.well-known/oauth-authorization-server` amb `code_challenge_methods_supported`.
- **Dynamic Client Registration** (`registration_endpoint`) i/o **CIMD**
  (`client_id_metadata_document_supported: true`) perquè Claude/ChatGPT es registrin sols.
- Registrar el redirect de Claude: `https://claude.ai/api/mcp/auth_callback`.
- Login d'usuari (email/social/SSO) + consentiment + emissió de tokens amb `aud` = el nostre recurs.

## Opcions per a l'Authorization Server
| Opció | Esforç | Notes |
|-------|--------|-------|
| **Proveïdor gestionat** (WorkOS AuthKit, Stytch, Scalekit, Auth0, Descope) | **Baix** ✅ | DCR + PKCE + metadades + login llestos; molts amb "MCP auth" dedicat. **Recomanat.** |
| Cloudflare Workers OAuth Provider | Mitjà | Bo si el servidor visqués en un Worker; ara és un procés Node (systemd) → implicaria replantejar hosting. |
| Muntar l'AS nosaltres | **Alt** ⚠️ | Endpoints authorize/token, JWKS, DCR, consent UI, rotació de refresh… codi crític de seguretat. No recomanat. |

Recomanació: **proveïdor gestionat**. Configuració típica:
1. Crear un "resource/API" amb identifier/audience = `https://mcp.motion4rent.com/mcp`.
2. Activar DCR (i CIMD si el proveïdor ho ofereix).
3. Registrar el redirect `https://claude.ai/api/mcp/auth_callback`.
4. Definir un scope (p. ex. `mcp:use`).
5. Copiar l'issuer i el JWKS URL a la config del nostre RS.

## Passos concrets
1. **Decidir** proveïdor gestionat vs. muntar-lo (recomanat: gestionat).
2. **Configurar** el proveïdor (resource/audience, scopes, DCR, redirect de Claude).
3. **Codi RS** (`server.ts` + `config.ts`):
   - env noves: `OAUTH_ISSUER`, `OAUTH_JWKS_URL`, `OAUTH_AUDIENCE` (= canonical URL), `OAUTH_SCOPES`.
   - endpoint `/.well-known/oauth-protected-resource`.
   - middleware de validació JWT (`jose`) amb 401/403 i `WWW-Authenticate`.
   - flag per mantenir el bearer estàtic en local/stdio.
4. **Cloudflare**: assegurar que els paths `/.well-known/*` passen (regla WAF skip ja existent
   per al subdomini) i que la capçalera `WWW-Authenticate` no es filtra.
5. **Provar** amb MCP Inspector (fa tot el flux OAuth) i després afegint-lo a Claude com a
   custom connector via OAuth (ja no per `mcp-remote`+bearer).
6. **Anotar tools** (`readOnlyHint`/`destructiveHint`) i preparar privadesa/docs (per al directori).

## Esforç estimat
- Amb proveïdor gestionat: **~1-2 dies** (config del proveïdor + capa RS + proves + Cloudflare).
- Muntant l'AS nosaltres: **setmanes** i risc de seguretat. Evitar.

## Preus dels proveïdors gestionats (comparativa, 2026)

El nostre perfil: **auth de consumidor** (login email/social per fer servir el connector),
**sense** SSO/SCIM empresarial (que és la part cara). El que importa és el **free tier per MAU**
i que tinguin OAuth 2.1 + DCR/CIMD per a MCP.

| Proveïdor | Free tier | Després | MCP / DCR | Nota per a nosaltres |
|-----------|-----------|---------|-----------|----------------------|
| **WorkOS AuthKit** | **1M MAU gratis** | $2.500 / 1M MAU addicional; SSO $125/conn (no ens cal) | Docs MCP + DCR al dashboard | **Millor cost**: pràcticament gratis a qualsevol escala realista |
| **Stytch** | 10k MAU gratis | Essentials $0,01/MAU (consumer); Growth $0,05/MAU (B2B) | "Connected Apps" fet per a MCP + DCR + partner de Cloudflare | Molt barat i el més "MCP-native"; free tier menor però amplíssim per començar |
| **Descope** | 7.500 MAU gratis | Pro $249/mes | Sí | Salta a de pagament abans |
| **Auth0** | 25k MAU gratis | Essentials des de $35/mes; B2B des de $150/mes (escala cara) | Sí | "Growth penalty": car en créixer |
| **Scalekit** | 25 comptes + 5k tool-calls/mes | Growth (de pagament) | Molt orientat a MCP | Free tier massa petit per a un listing públic |

**Recomanació: WorkOS AuthKit** — free fins a 1M MAU (cobreix de sobres un connector públic
sense cost), suport MCP + DCR, i login email/social sense muntar base d'usuaris. **Alternativa:
Stytch** si preferim el més "MCP-native" (Connected Apps + integració Cloudflare); free 10k MAU
i després molt barat.

> Els MAU es compten per usuaris únics que fan login cada mes. En un directori públic pot pujar
> ràpid → el free de 1M de WorkOS és el més segur davant d'un pic de trànsit.

## Fonts
- [MCP Authorization spec (2025-11-25)](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [WorkOS pricing](https://workos.com/pricing) · [Stytch pricing](https://stytch.com/pricing) · [Auth0 pricing](https://auth0.com/pricing) · [Descope pricing](https://www.descope.com/pricing) · [Scalekit pricing](https://www.scalekit.com/pricing)
- [Claude — building connectors (auth)](https://claude.com/docs/connectors/building)
- [Best MCP auth providers (WorkOS)](https://workos.com/blog/best-mcp-server-authentication-providers)
- [WorkOS AuthKit — MCP](https://workos.com/docs/authkit/mcp) · [Stytch Connected Apps] · [Scalekit MCP Auth](https://www.scalekit.com/mcp-auth)
