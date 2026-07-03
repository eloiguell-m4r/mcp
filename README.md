# Motion4Rent MCP

Servidor **MCP** (Model Context Protocol) que exposa el lloguer de mobilitat de Motion4Rent a assistents d'IA (Claude, ChatGPT…). L'assistent pot **cercar disponibilitat amb preus**, **consultar detalls/cobertura** i rebre un **enllaç a la web** on l'usuari completa lliurament, opcions i pagament.

> **Abast (opció E del pla):** només lectura + deep-link. **NO crea comandes ni cobra.** El càlcul de preu final (lliurament/opcions/comissions) i el pagament es fan a la web, on la lògica ja és correcta. El pagament dins el xat (checkout headless) seria una fase posterior.

## Tools

| Tool | Què fa |
|---|---|
| `search_mobility_rentals` | Cerca equips per ciutat+dates → productes amb preu total + **`booking_link`** (deep-link a la web). |
| `check_city_coverage` | Comprova si es dona servei en una ciutat i resol homònimes (mateix nom en diversos països). |
| `get_rental_details` | Detall d'un producte (specs, preu, cancel·lació) a partir dels IDs de la cerca. |

Les tools criden endpoints **públics** de `motion4rent-api` (`/ai/cities`, `/search/results`, `/details`). El "cervell" conversacional és el client (Claude/ChatGPT); aquestes tools són fines.

## Requisits

- Node ≥ 20
- `motion4rent-api` accessible (variable `M4R_API_BASE_URL`)

## Posada en marxa

```bash
cp .env.example .env      # edita M4R_API_BASE_URL, PORT, etc.
npm install
npm run build
```

### Mode local (stdio) — per provar amb un client MCP local

```bash
npm run dev:stdio
```

### Mode remot (HTTP) — per registrar-lo com a connector

```bash
npm run dev        # o: npm run build && npm start
# escolta a http://localhost:$PORT/mcp
```

Comprovació ràpida: `curl http://localhost:$PORT/health`

## Variables d'entorn

Veure `.env.example`. Les clau:
- `MCP_TRANSPORT` = `http` (remot) | `stdio` (local)
- `M4R_API_BASE_URL` = base de l'API de motion4rent (endpoints públics)
- `WEB_BASE_URL` = base de la web per als deep-links (per defecte `https://www.motion4rent.com`)
- `MCP_AUTH_TOKEN` = token bearer opcional per protegir `/mcp` en mode http
- `PORT`, `TENANT`

## Registrar-lo com a connector

- **Claude**: afegir un connector MCP remot amb la URL pública `https://<host>/mcp` (i el bearer si `MCP_AUTH_TOKEN` està definit).
- **ChatGPT**: crear una app/connector MCP apuntant a la mateixa URL.
- Recorda: el connector només arriba als usuaris que l'afegeixen (no és descoberta orgànica — això és la Fase 1 GEO del web).

## Desplegament (producció, sense Docker)

El servidor és un procés Node de llarga durada en **mode HTTP**, supervisat (systemd o pm2) i darrere un proxy HTTPS.

**1) Build al servidor:**
```bash
npm ci
npm run build      # compila TS → dist/
```

**2) Arrencada supervisada.** L'`.env` (no versionat) porta la config (`MCP_TRANSPORT=http`, `PORT`, `M4R_API_BASE_URL`, `WEB_BASE_URL`, `MCP_AUTH_TOKEN`).

**Opció A — systemd** (`/etc/systemd/system/motion4rent-mcp.service`):
```ini
[Unit]
Description=Motion4Rent MCP
After=network.target

[Service]
Type=simple
WorkingDirectory=/ruta/a/webs/mcp
EnvironmentFile=/ruta/a/webs/mcp/.env
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=3
User=www-data

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload && sudo systemctl enable --now motion4rent-mcp
sudo journalctl -u motion4rent-mcp -f          # logs
```

**Opció B — pm2:**
```bash
pm2 start dist/server.js --name motion4rent-mcp   # llegeix .env si fas servir --env o dotenv
pm2 save
```

**HTTPS/domini:** el procés escolta a `:PORT` (HTTP pla). Cal un **reverse proxy amb TLS** al davant (Cloudflare, nginx o traefik) que serveixi p. ex. `https://mcp.motion4rent.com` → `127.0.0.1:8787`. L'endpoint MCP és `POST /mcp`; `GET /health` per als health checks.

**Registrar com a connector:**
- **Claude** → Settings → Connectors → *Add custom connector* → URL `https://mcp.motion4rent.com/mcp` (+ bearer si hi ha `MCP_AUTH_TOKEN`).
- **ChatGPT** → app/connector MCP a la mateixa URL.
- Privat/org: URL + bearer. Directori públic: revisió + normalment OAuth (verificar doc actual).

**Stateless:** cada petició crea servidor+transport nous → escalable horitzontalment sense sessions compartides.

## Notes de manteniment

- El mapa de slugs per idioma (`src/deeplink.ts`) reprodueix el contracte d'URL de la web (igual que `webs/ia` i `cron/sitemap.php`). Si la web canvia una ruta localitzada, actualitza'l aquí també.
- El filtre de tipus s'aplica via el hash `#typeProd:` del deep-link (la web hi filtra a la càrrega).
