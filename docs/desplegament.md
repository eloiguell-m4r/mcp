# Motion4Rent MCP — Com funcionarà el desplegament (sense Docker)

## Arquitectura

```
Usuari a Claude/ChatGPT
   │  (ha afegit el connector)
   ▼
Client MCP  ──HTTPS JSON-RPC──►  https://mcp.motion4rent.com/mcp
                                        │  (el nostre servidor MCP, procés Node natiu)
                                        ▼
                                 motion4rent-api  (/ai/cities, /search/results, /details)  [públic]
                                        │
                                 productes + preus + booking_link
   ◄────────────────────────────────────┘
Claude/ChatGPT mostra opcions + enllaç → l'usuari clica → completa i PAGA a la web
```

## Peça a peça

1. **El servidor MCP** és un procés Node en **mode HTTP** (`node dist/server.js`, sense contenidor). Llegeix de l'entorn (un `.env` no versionat):
   - `MCP_TRANSPORT=http`,
   - `PORT` (per defecte 8787),
   - `M4R_API_BASE_URL` (API de prod),
   - `WEB_BASE_URL` (web de prod, per als deep-links),
   - `MCP_AUTH_TOKEN` (secret).
2. **HTTPS/domini**: el procés escolta a `127.0.0.1:8787` (HTTP pla). Al davant hi va un **reverse proxy amb TLS** (Cloudflare o nginx/traefik) que serveix `https://mcp.motion4rent.com` → `:8787`. L'endpoint és `POST /mcp`; `GET /health` per als health checks.
3. **Supervisor**: el procés s'ha de mantenir viu i reiniciar sol → **systemd** (recomanat) o **pm2**. Sense supervisor, un `node dist/server.js` mor en tancar la sessió o en fallar.
4. **Registre (un cop)**: afegeixes la URL com a **custom connector** a Claude (Settings → Connectors) i com a app/connector a ChatGPT, amb el bearer token.
5. **En temps d'execució**: quan un usuari que ha afegit el connector pregunta ("cadira de rodes a Manresa la setmana que ve"), el seu client envia JSON-RPC al nostre `/mcp`; el servidor crida l'API pública, retorna productes + preus + `booking_link`; Claude/ChatGPT ho presenta i l'usuari **completa i paga a la web** (el MCP no toca diners).
6. **Auth**: ús privat/org → n'hi ha prou amb el **bearer token**. Directori públic → **OAuth** + revisió de la plataforma.
7. **Abast**: només arriba a qui **afegeix** el connector (la descoberta orgànica és la Fase 1 GEO).
8. **Escalabilitat**: és **stateless** → escalable horitzontalment sense sessions compartides.

## Què cal aportar per desplegar

- **Un host** amb Node 22+ (la mateixa infra que l'API, o una VM petita).
- **Subdomini HTTPS** `mcp.motion4rent.com` + TLS (Cloudflare va bé).
- **`M4R_API_BASE_URL`** = URL de l'API de prod **accessible des del host** (no `localhost` si l'API és en una altra màquina).
- **`MCP_AUTH_TOKEN`** = un secret que posaràs també al connector.
- Registrar la URL a Claude i ChatGPT.

## El que queda a fer (usuari)

1. **Commit/push** de `webs/mcp`.
2. Al host: `npm ci && npm run build`, crear l'`.env` amb les vars de prod, i arrencar amb systemd/pm2 (veure sota).
3. Posar-hi un reverse proxy HTTPS al davant.
4. Registrar el connector a Claude/ChatGPT.

## Comandes de desplegament (resum, sense Docker)

```bash
# 1) al host, dins webs/mcp
npm ci
npm run build            # TS → dist/

# 2) .env (no versionat) amb la config de prod
#    MCP_TRANSPORT=http
#    PORT=8787
#    M4R_API_BASE_URL=https://<api-prod>
#    WEB_BASE_URL=https://www.motion4rent.com
#    MCP_AUTH_TOKEN=<token-secret>

# 3a) supervisar amb systemd (recomanat)
sudo tee /etc/systemd/system/motion4rent-mcp.service >/dev/null <<'UNIT'
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
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now motion4rent-mcp
sudo journalctl -u motion4rent-mcp -f     # logs

# 3b) alternativa: pm2
pm2 start dist/server.js --name motion4rent-mcp
pm2 save
```

Endpoint MCP: `POST https://mcp.motion4rent.com/mcp` · Health: `GET /health`

> Prova ràpida en local abans de publicar: `MCP_TRANSPORT=http PORT=8787 M4R_API_BASE_URL=https://<api-prod> WEB_BASE_URL=https://www.motion4rent.com node dist/server.js`, i després `curl localhost:8787/health`.
