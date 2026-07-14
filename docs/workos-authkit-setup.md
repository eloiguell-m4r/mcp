# Configurar WorkOS AuthKit com a Authorization Server de l'MCP

Objectiu: que WorkOS AuthKit faci de servidor OAuth per al connector `mcp.motion4rent.com`.
El nostre MCP només valida el token (Resource Server); WorkOS fa login/consentiment/emissió.

## Entorns: Staging vs Production
WorkOS té entorns separats (**Staging** i **Production**), cadascun amb el **seu** domini d'AuthKit,
claus i **configuració independent** (CIMD/DCR/Resource Indicators NO s'hereten). Es canvia amb el
**selector d'entorn** del capdamunt del dashboard (a prop del nom del projecte).
- **Staging**: `https://<...>-staging.authkit.app` — per a proves (MCP Inspector, etc.).
- **Production**: canvia a l'entorn Production i repeteix els passos 0–4 allà. El domini pot ser un
  `*.authkit.app` de producció o un **domini propi** (p. ex. `auth.motion4rent.com`) verificat per DNS.
  El `.env` de **prod** de l'MCP usarà l'issuer de PRODUCTION.

## 0) El teu domini AuthKit (= issuer)
Al Dashboard de WorkOS → **Authentication → Domains** (menú de la dreta): hi ha el **domini d'AuthKit**,
de la forma `https://<alguna-cosa>.authkit.app` (o un domini propi si l'has configurat). Si no hi surt,
mira **Overview** o **Authentication → Redirects** (hi apareix la URL d'AuthKit). Aquest és el teu
**issuer**. Endpoints que WorkOS exposa automàticament:
- Metadata AS: `https://<domini>/.well-known/oauth-authorization-server`
- JWKS: `https://<domini>/oauth2/jwks`
- Authorize: `https://<domini>/oauth2/authorize` · Token: `https://<domini>/oauth2/token`

Comprovació ràpida:
```
curl -s https://<domini>/.well-known/oauth-authorization-server | python3 -m json.tool
```
Hi han de sortir `authorization_endpoint`, `token_endpoint`, `jwks_uri` i, després del pas 2,
`client_id_metadata_document_supported: true` i/o un `registration_endpoint`.

## 1) Activar login
A **Authentication → AuthKit**, assegura't que hi ha almenys un mètode de login actiu
(email/password o social). Els "usuaris" seran qui afegeixi el connector (clients finals);
no cal cap dada nostra.

## 2) Activar registre de clients MCP (menú **Connect → Configuration → MCP Auth**)
⚠️ Aquests toggles NO són a "Authentication": són al producte **Connect** (menú esquerre) →
**Configuration** → secció **MCP Auth**. Perquè Claude/ChatGPT es puguin registrar sols com a client OAuth:
- **Client ID Metadata Document (CIMD)** → **ON** (per defecte està OFF; activa'l). És el mètode
  modern (nov. 2025) que fan servir els clients MCP per identificar-se.
- **Dynamic Client Registration (DCR)** → **ON** (compatibilitat amb clients que encara no fan CIMD).

> Amb CIMD/DCR **no cal** configurar manualment cap redirect URI (ni la de claude.ai): el redirect
> del client arriba dinàmicament. Per això no hi ha pas de "afegir `https://claude.ai/api/mcp/auth_callback`".

## 3) Resource Indicator (audience) — CLAU
Al mateix lloc (**Connect → Configuration → MCP Auth**), afegeix el nostre MCP com a
**Resource Indicator** vàlid:
```
https://mcp.motion4rent.com/mcp
```
Això fa que els access tokens portin `aud = https://mcp.motion4rent.com/mcp`. El nostre RS només
accepta tokens amb aquest `aud` (audience binding). Ha de coincidir EXACTAMENT amb `OAUTH_AUDIENCE`.

## 4) Scopes
No cal scope propi. WorkOS emet scopes OIDC estàndard (`openid`, `profile`, `email`, `offline_access`)
i la garantia és l'audience. Deixa `OAUTH_SCOPES` **buit** al nostre `.env`.

## 5) Valors per al `.env` de PRODUCCIÓ de l'MCP
```
OAUTH_ENABLED=true                                  # activar quan vulguis (rollout)
OAUTH_ISSUER=https://<domini>.authkit.app           # el teu domini AuthKit (sense barra final)
OAUTH_JWKS_URL=                                     # deixar buit → es deriva de l'issuer (/oauth2/jwks)
OAUTH_AUDIENCE=https://mcp.motion4rent.com/mcp      # = Resource Indicator del pas 3
OAUTH_SCOPES=                                       # buit amb WorkOS
```
> Recomanació de rollout: desplega primer amb `OAUTH_ENABLED=false` (no canvia res), verifica, i
> després posa `true`.

## 6) Verificar (un cop desplegat amb OAUTH_ENABLED=true)
- `curl https://mcp.motion4rent.com/.well-known/oauth-protected-resource` → ha d'apuntar
  `authorization_servers: ["https://<domini>.authkit.app"]` i `resource` = l'audience.
- `curl -X POST https://mcp.motion4rent.com/mcp` sense token → **401** amb capçalera
  `WWW-Authenticate: Bearer resource_metadata="…"`.
- **MCP Inspector** (Transport *Streamable HTTP*, sense bearer) → ha d'iniciar el flux OAuth
  (login WorkOS → consent → token) i després `tools/list` OK. Vegeu `docs/mcp-inspector.md`.

## Notes
- L'issuer (`OAUTH_ISSUER`) ha de coincidir EXACTAMENT amb el `iss` dels tokens (el domini AuthKit).
- Endureix Cloudflare a **SSL Full** (Origin Certificate) perquè el JWT no viatgi en clar CF→origen.
- El bearer intern `MCP_AUTH_TOKEN` segueix funcionant com a bypass (Claude Desktop actual / proves).
