# Provar el MCP amb MCP Inspector

[MCP Inspector](https://github.com/modelcontextprotocol/inspector) és una UI web per
inspeccionar un servidor MCP: llistar tools, cridar-les amb arguments i veure la resposta
crua. Serveix per depurar sense passar per Claude/ChatGPT.

Dos escenaris: **(A)** contra el servidor **en local** (stdio) i **(B)** contra
**`mcp.motion4rent.com`** (Streamable HTTP + bearer).

En arrencar, l'Inspector imprimeix a la consola una URL amb un token de sessió
(`?MCP_PROXY_AUTH_TOKEN=…`); obre **aquesta** URL al navegador.

---

## A) En local, via stdio

Prova el codi d'aquest repo sense desplegar res. L'Inspector arrenca el servidor com a
procés fill i s'hi comunica per stdio.

### 1) Compila
```
npm run build
```

### 2) Arrenca l'Inspector amb el servidor
```
MCP_TRANSPORT=stdio \
M4R_API_BASE_URL=http://localhost:3000 \
npx @modelcontextprotocol/inspector node dist/server.js
```

- **`MCP_TRANSPORT=stdio`** és OBLIGATORI. Per defecte el servidor arrenca en mode **HTTP**
  (obre un port i no parla per stdio) → l'Inspector es quedaria penjat. Amb `stdio` el
  servidor parla pel canal estàndard que espera l'Inspector.
- **`M4R_API_BASE_URL`**: on és l'API de motion4rent. Per defecte ja és
  `http://localhost:3000` (Docker/local), així que pots ometre-la si hi apunta.

> Alternativa sense compilar (TypeScript directe):
> `MCP_TRANSPORT=stdio npx @modelcontextprotocol/inspector npx tsx src/server.ts`

### Variables d'entorn (totes tenen valor per defecte excepte on s'indica)
| Variable | Per a què | Default |
|----------|-----------|---------|
| `MCP_TRANSPORT` | **Cal `stdio`** per a l'Inspector local | `http` |
| `M4R_API_BASE_URL` | API pública (`/search`, `/details`, `/products/load`…) | `http://localhost:3000` |
| `M4R_CHECKOUT_BASE_URL` | WEB que exposa `POST /ai/checkout` — **només si vols provar `create_booking`** | buit (booking desactivat) |
| `M4R_CHECKOUT_SECRET` | bearer compartit amb el web (`AI_CHECKOUT_SECRET`) — cal amb l'anterior | buit |
| `WEB_BASE_URL` | base per als deep-links (no cal per provar) | `https://www.motion4rent.com` |
| `TENANT` | tenant | `motion4rent` |
| `PRODUCT_IMAGE_BASE`, `M4R_MANAGEMENT_FEE_EUR` | imatges / fee | valors per defecte OK |

- **`MCP_AUTH_TOKEN` NO cal** en stdio: el bearer només s'aplica al transport HTTP.
- Per provar `create_booking` en local sense cobrar de veritat, apunta `M4R_CHECKOUT_BASE_URL`
  al **web local/Docker amb `ENVIRONMENT=development`** (Stripe TEST). No l'apuntis a
  producció (Stripe LIVE — vegeu `docs/desplegament-prod-runbook.md` §8).

Exemple complet amb booking en local:
```
MCP_TRANSPORT=stdio \
M4R_API_BASE_URL=http://localhost:3000 \
M4R_CHECKOUT_BASE_URL=http://localhost:8080 \
M4R_CHECKOUT_SECRET=<AI_CHECKOUT_SECRET_del_web_local> \
npx @modelcontextprotocol/inspector node dist/server.js
```

---

## B) Contra producció (`mcp.motion4rent.com`)

Aquí NO s'arrenca cap procés local: l'Inspector es connecta per HTTP al servidor desplegat,
que està protegit amb bearer.

### 1) Arrenca l'Inspector sol
```
npx @modelcontextprotocol/inspector
```

### 2) Configura la connexió a la UI
- **Transport Type**: `Streamable HTTP`
- **URL**: `https://mcp.motion4rent.com/mcp`
- **Authentication** → capçalera:
  - Header Name: `Authorization`
  - Valor / Bearer Token: `Bearer <MCP_AUTH_TOKEN>` (el mateix valor del `.env` del servidor).
    Si el camp és específic de "Bearer Token", posa-hi només el token (ell hi afegeix `Bearer `).
- Prem **Connect**.

> **Si el servidor corre amb `OAUTH_ENABLED=true`** (mode publish-ready): NO posis el bearer.
> L'Inspector, en rebre el `401` amb `WWW-Authenticate`, descobreix l'AS via
> `/.well-known/oauth-protected-resource` i **inicia el flux OAuth** (login WorkOS + consentiment)
> automàticament. El bearer estàtic només és per al mode intern (sense OAuth).

> Comprovació ràpida que el servidor respon abans de connectar:
> `curl https://mcp.motion4rent.com/health` → `{ "ok": true, … }`.

⚠️ El servidor de producció corre amb Stripe **LIVE**: si crides `create_booking` i pagues
el `urlTpv`, és **diners reals**. Per a proves de booking usa l'escenari A (local, Stripe TEST)
o el truc de Sevilla (producte d'1-10€) i reemborsa a Stripe.

---

## Un cop connectat (qualsevol escenari)
- **List Tools** → veuràs `search_mobility_rentals`, `get_rental_details`, `create_booking`,
  `list_currencies`, `list_product_options`, etc.
- Selecciona una tool, omple els arguments (JSON) i **Run**. Exemple per a la cerca:
  `city=Valencia`, `start_date=2026-08-14`, `end_date=2026-08-15`, `product_type=electric wheelchair`.
- La resposta mostra el resum + el bloc JSON que rep el client.

## Relacionat
- Connector real a Claude Desktop: `docs/connector-claude-desktop.md`.
- Desplegament i Cloudflare: `docs/desplegament-prod-runbook.md`.
