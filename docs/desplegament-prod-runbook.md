# Runbook — desplegament MCP a producció (Virgínia + Cloudflare)

Decisions: host = servidor co-ubicat amb l'API read-only (`M4R_API_BASE_URL=http://localhost:3000`); reverse proxy = Cloudflare; secret = es reutilitza el de dev (`cf30…`).

## ESTAT (2026-07-06): desplegat, falta 1 cosa
- ✅ Codi clonat a `/var/www/mcp`, `npm ci && npm run build`, `.env` creat.
- ✅ Servei **systemd `motion4rent-mcp` actiu** (`:8787`, `auth=on`), `/health` OK en local.
- ✅ vhost intern `127.0.0.1:8090` (bypass Cloudflare per a `/ai/checkout`) — verificat 401/400.
- ✅ vhost públic `mcp.motion4rent.com` (proxy nginx → :8787) + DNS **A record** proxied.
- ✅ Tenants: `:3000` motion4rent-api, `:3001` rent4riders-api.
- ✅ **Cloudflare WAF Custom Rule "Skip"** per `http.host eq mcp.motion4rent.com` (Super Bot Fight Mode + Browser Integrity + Security Level + Managed rules) → sense el "Just a moment…".
- ✅ **Cloudflare Configuration Rule** SSL=**Flexible** per `mcp.motion4rent.com` (l'origen només té :80; sense això → error 521). NO túnel.
- ✅ **Verificat des de fora**: `https://mcp.motion4rent.com/health` → 200 JSON; `POST /mcp` sense token → 401.
- ⏳ Verificar tools (create_booking) via MCP Inspector HTTP + bearer, i **registrar el connector** a Claude/ChatGPT (secció 7).
- ⏳ Reserva real de prova (Sevilla, supplier id=1, divendres 23-23h) — encara Stripe TEST — abans de passar a LIVE (secció 8).

> Nota seguretat: SSL Flexible deixa el tram Cloudflare→origen (:80) sense xifrar (hi passa el bearer). Per endurir-ho més endavant: Cloudflare Tunnel o Origin Certificate al host + tornar a Full.

## 0) Prerequisits al host de Virgínia
- **Node 22+**: `node -v` (el server demana >=20; recomanat 22).
- **Codi `webs/mcp` al host**: `git pull` de la branca que conté el MCP.
- **vhost nginx intern a loopback** per arribar al web local sense Cloudflare (veure sota). Descartat `/etc/hosts` amb el domini real: el DNS segueix donant les IPv6 de Cloudflare (l'entrada IPv4 no tapa l'AAAA → Node podria anar a CF) i fa shadowing host-wide del domini.

### Vhost intern (fitxer /etc/nginx/conf.d/mcp-internal.conf)
```nginx
server {
    listen 127.0.0.1:8090;      # NOMÉS loopback
    server_name _;
    root /var/www/html/public;
    index index.php;
    location / { try_files $uri $uri/ /index.php?$args; }
    location ~ \.php$ {
        include fastcgi_params;
        fastcgi_pass unix:/run/php-fpm/www.sock;
        fastcgi_param SCRIPT_FILENAME /var/www/html/public/index.php;
        fastcgi_param URLFASTIFY "http://localhost:3000/";
    }
}
```
`sudo nginx -t && sudo systemctl reload nginx` → verificar `curl -X POST http://127.0.0.1:8090/ai/checkout -d '{}'` → 401 (i amb el bearer → 400 missing_fields).

### Tenants al mateix host (verificat)
- `:3000` = `/var/www/api/index.js` = **motion4rent-api** → `M4R_API_BASE_URL=http://localhost:3000`.
- `:3001` = rent4riders-api (no tocar; per al futur MCP de rent4riders).
- **Web LOCAL de Virgínia (`:8080`) ja exposa `/ai/checkout`** amb `AI_CHECKOUT_SECRET` (el mateix `cf30…`) i té el fix `delivery='0'` desplegat. Verifica-ho contra el web LOCAL (no la pública, que dona el challenge de Cloudflare):
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:8080/ai/checkout -H 'Content-Type: application/json' -d '{}'                     # → 401 (secret absent)
  curl -s -X POST http://localhost:8080/ai/checkout -H "Authorization: Bearer cf30f91782f6c56f3ce44c6253f4541edbac24a37c85b6c070946f6473390771" -H 'Content-Type: application/json' -d '{}'   # → 400 missing_fields (secret OK)
  ```

## 1) Build
```bash
cd /ruta/a/webs/mcp
npm ci
npm run build      # TS → dist/
```

## 2) .env de prod (no versionat), a webs/mcp/.env
```bash
MCP_TRANSPORT=http
PORT=8787
M4R_API_BASE_URL=http://localhost:3000
WEB_BASE_URL=https://www.motion4rent.com
TENANT=motion4rent
MCP_AUTH_TOKEN=<GENERAR: openssl rand -hex 32>
M4R_CHECKOUT_BASE_URL=http://127.0.0.1:8090   # vhost nginx intern loopback → app motion4rent, bypassa Cloudflare
M4R_CHECKOUT_SECRET=cf30f91782f6c56f3ce44c6253f4541edbac24a37c85b6c070946f6473390771
```
> `MCP_AUTH_TOKEN` és el bearer que posaràs també al connector de Claude/ChatGPT. Genera'l i guarda'l.
>
> ⚠️ **CLOUDFLARE — no apuntis `M4R_CHECKOUT_BASE_URL` a `https://www.motion4rent.com`.** El web públic està darrere un *managed challenge* de Cloudflare que retorna un repte JS "Just a moment…" (HTTP 403) a qualsevol client no-navegador. El MCP és servidor-a-servidor → quedaria bloquejat i `create_booking` fallaria (comprovat: `POST https://www.motion4rent.com/ai/checkout` torna el challenge de CF, no el 401 de l'app). Solució: cridar el **web local de Virgínia** (bypassa Cloudflare, com la resta de crides internes web→API). `WEB_BASE_URL` sí que pot ser la pública (només construeix deep-links que obre l'usuari al navegador).

## 3) systemd
```bash
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
sudo journalctl -u motion4rent-mcp -f
```
Al log hauria de sortir: `[motion4rent-mcp] HTTP actiu a :8787/mcp  API=http://localhost:3000  auth=on`.

## 4) Smoke test local (abans de Cloudflare)
```bash
curl -s localhost:8787/health        # → {"ok":true,"server":{...}}
```
Verificació completa de tools (create_booking inclòs) millor via **MCP Inspector en mode HTTP** apuntant a `http://localhost:8787/mcp` amb el bearer, o directament en registrar-lo al client.

## 5) Exposició pública — FET via A record + proxy nginx (NO túnel)
Enfocament escollit (reutilitza la infra Cloudflare→nginx existent, sense instal·lar `cloudflared`):

1. **vhost públic** `/etc/nginx/conf.d/mcp-public.conf` (proxy → :8787, `proxy_buffering off` per SSE):
   ```nginx
   server {
       listen 80;
       server_name mcp.motion4rent.com;
       location / {
           proxy_pass http://127.0.0.1:8787;
           proxy_http_version 1.1;
           proxy_set_header Host $host;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_buffering off;
           proxy_read_timeout 300s;
       }
   }
   ```
2. **DNS Cloudflare**: registre **A** `mcp` → IP pública del host, **Proxied**. (S'ha fet com a A directe a aquest host, no CNAME a l'ELB: el CNAME a l'ELB repartiria entre hosts i el MCP només corre en aquest.)

Estat: l'encaminament funciona (la petició arriba a nginx→MCP). **Alternativa descartada:** Cloudflare Tunnel (`cloudflared`) — més net si el host no té IP pública, però aquí l'A record ja arriba.

## 6) ⚠️ PENDENT — eximir mcp.motion4rent.com del repte de bots de Cloudflare
`curl https://mcp.motion4rent.com/health` retorna el *managed challenge* "Just a moment…" (`cType: managed`) → els clients de Claude/ChatGPT (servidor-a-servidor) el rebrien i el connector fallaria. Cal una regla que salti el repte per a aquest subdomini (l'auth real ja és el `MCP_AUTH_TOKEN`):

**Cloudflare → Security → WAF → Custom rules → Create rule:**
- Nom: `MCP allow (skip bot challenge)`
- Expressió: `http.host eq "mcp.motion4rent.com"`
- Acció: **Skip**, i marcar per saltar: **Super Bot Fight Mode**, **Browser Integrity Check**, **Security Level**, i **Managed rules** (WAF).
- Desplega-la a dalt de tot.

Nota: si estan en pla **free amb Bot Fight Mode** (no Super), no es pot acotar per hostname → caldria desactivar-lo a nivell de zona o pujar de pla.

**Verificació** (des de fora): `curl -s https://mcp.motion4rent.com/health` → ha de tornar `{"ok":true,...}` en JSON, no l'HTML del challenge.

## 7) Registrar el connector
- Claude: Settings → Connectors → afegir `https://mcp.motion4rent.com/mcp` amb bearer = `MCP_AUTH_TOKEN`.
- ChatGPT: afegir com a app/connector amb la mateixa URL + token.

## 8) Després (fase següent)
- Provar una reserva real des de Claude/ChatGPT contra el producte de proves de Sevilla (supplier id=1, finestra divendres 23-23h) — encara en Stripe TEST.
- Només llavors: **Stripe TEST → LIVE** (claus `sk_live_…`, webhook LIVE) al web de prod.
