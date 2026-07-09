# Connector Motion4Rent MCP a Claude Desktop (mètode real)

Com hem afegit el servidor MCP de producció (`https://mcp.motion4rent.com/mcp`) a
Claude Desktop al Mac.

## Per què no per la UI de "Connectors"
La UI de connectors de Claude Desktop / claude.ai web només accepta servidors remots
amb **OAuth**, no un **bearer token estàtic**. El nostre MCP es protegeix amb un bearer
(`MCP_AUTH_TOKEN`), així que no es pot afegir per la via gràfica.

Solució: fem servir **`mcp-remote`** com a pont. És un procés local (stdio ↔ HTTP) que
Claude Desktop arrenca; ell reenvia el JSON-RPC al nostre `/mcp` per HTTPS **injectant la
capçalera `Authorization: Bearer …`**. Així Claude Desktop parla amb el servidor amb bearer
com si fos un MCP local.

## Fitxer de configuració
`~/Library/Application Support/Claude/claude_desktop_config.json`

Afegeix (o fusiona) dins de `mcpServers`:

```json
{
  "mcpServers": {
    "motion4rent-mcp": {
      "command": "/opt/homebrew/bin/npx",
      "args": [
        "-y",
        "mcp-remote@0.1.16",
        "https://mcp.motion4rent.com/mcp",
        "--header",
        "Authorization:Bearer <MCP_AUTH_TOKEN>"
      ],
      "env": {
        "PATH": "/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
      }
    }
  }
}
```

Substitueix `<MCP_AUTH_TOKEN>` pel bearer real (el mateix valor de `MCP_AUTH_TOKEN`
del `.env` del servidor MCP). ⚠️ És un secret: no el pugis al repo.

## Detalls que importen (i per què)
- **`command` amb ruta absoluta `/opt/homebrew/bin/npx`**: Claude Desktop NO hereta el
  PATH del shell; amb `npx` pelat no el troba i el connector falla. (Homebrew a Apple
  Silicon → `/opt/homebrew/bin`; en Intel seria `/usr/local/bin`.)
- **`env.PATH`**: perquè `npx`/`node` trobin les seves dependències en arrencar.
- **`mcp-remote@0.1.16`**: versió fixada que funciona. Si actualitzes, revisa que segueixi
  acceptant `--header`.
- **`--header "Authorization:Bearer …"`**: sense espai després dels dos punts de `Authorization:`
  (format que espera `mcp-remote`); l'espai va abans del token, dins del valor.

## Aplicar canvis
Després d'editar el JSON, **surt del tot de Claude Desktop i torna'l a obrir** (no n'hi ha
prou amb tancar la finestra). Comprova que apareguin les tools de `motion4rent-mcp`
(search_mobility_rentals, get_rental_details, create_booking, list_currencies…).

## Verificar / depurar
- Health del servidor: `curl https://mcp.motion4rent.com/health` → `{ ok: true, … }`.
- Si no surten les tools: revisa que `npx` existeix a la ruta indicada, que el token és
  correcte i que has reiniciat l'app del tot. Els logs de Claude Desktop són a
  `~/Library/Logs/Claude/`.

## Relacionat
- Desplegament del servidor MCP i Cloudflare: `docs/desplegament-prod-runbook.md`.
- Visió general de l'arquitectura del connector: `docs/desplegament.md`.
