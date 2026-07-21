# Runbook — desplegament MCP a producció (Virgínia + Cloudflare)

Decisions: host = servidor co-ubicat amb l'API read-only (`M4R_API_BASE_URL=http://localhost:3000`); reverse proxy = Cloudflare; secret = es reutilitza el de dev (`cf30…`).

## Redesplegament (actualitzar codi ja desplegat)
Dos repos, dos mecanismes:

- **Web (`motion4rent-web`) → automàtic per pipeline de GitLab.** En fer `git push`, el pipeline desplega als **dos servidors** del web (i s'ocupa de l'opcache). No cal fer res manual al web.
- **MCP (`/var/www/mcp`) → manual amb systemd** (no té pipeline):
  ```bash
  cd /var/www/mcp
  git pull
  npm ci            # només si han canviat package.json/lock; si no, salta'l
  npm run build     # TS → dist/ (obligatori: el codi que corre és dist/)
  sudo systemctl restart motion4rent-mcp   # el procés Node té dist/ en memòria; no es refresca sol
  sudo systemctl status motion4rent-mcp --no-pager
  curl -s localhost:8787/health            # → {"ok":true,...}
  ```
- **Ordre recomanat:** desplega **primer el web** (push) i **després el MCP**. Així, si el MCP nou envia un camp nou (p. ex. `currency`), el web ja el sap validar.

## ESTAT (2026-07-06): desplegat, falta 1 cosa
- ✅ Codi clonat a `/var/www/mcp`, `npm ci && npm run build`, `.env` creat.
- ✅ Servei **systemd `motion4rent-mcp` actiu** (`:8787`, `auth=on`), `/health` OK en local.
- ✅ vhost intern `127.0.0.1:8090` (bypass Cloudflare per a `/ai/checkout`) — verificat 401/400.
- ✅ vhost públic `mcp.motion4rent.com` (proxy nginx → :8787) + DNS **A record** proxied.
- ✅ Tenants: `:3000` motion4rent-api, `:3001` rent4riders-api.
- ✅ **Cloudflare WAF Custom Rule "Skip"** per `http.host eq mcp.motion4rent.com` (Super Bot Fight Mode + Browser Integrity + Security Level + Managed rules) → sense el "Just a moment…".
- ✅ **Cloudflare Configuration Rule** SSL=**Full (strict)** per `mcp.motion4rent.com` (endurit 2026-07):
  Origin Certificate de Cloudflare instal·lat a l'origen (`/etc/ssl/cloudflare/mcp.pem` + `mcp.key`),
  nginx amb bloc **`:443 ssl`** (proxy a `127.0.0.1:8787`). Abans era Flexible (:80 en clar) — ja NO. NO túnel.
- ✅ **Lockdown d'origen**: Security Group obre el **:443 només als rangs de Cloudflare** via managed prefix
  list `cloudflare-ipv4` (baixada de `cloudflare.com/ips-v4`). Regla `0.0.0.0/0:443` retirada.
- ✅ **OAuth 2.1** (WorkOS AuthKit) actiu com a auth del directori (`OAUTH_ENABLED=true`); el bearer estàtic
  queda com a bypass intern. Vegeu `docs/workos-authkit-setup.md` i `docs/oauth-implementation-plan.md`.
- ✅ **Verificat des de fora**: `https://mcp.motion4rent.com/health` → 200 JSON; `POST /mcp` sense token → 401 + WWW-Authenticate.
- ⏳ Preparar textos del listing + compte/guió de prova i **enviar al directori** (`docs/publicar-directori-claude.md`).

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
> **Model d'auth (nou):** l'endpoint `/mcp` és **públic + rate-limited** per defecte (per poder anar
> al directori, on el bearer estàtic no val). Variables:
> - `MCP_AUTH_TOKEN` — bearer INTERN de confiança: un request amb aquest bearer **salta el rate-limit**
>   (el fem servir a Claude Desktop via `mcp-remote`, i per a proves internes). Ja NO és una porta obligatòria.
> - `MCP_REQUIRE_AUTH=true` — opcional: torna a EXIGIR el bearer (mode privat, 401 sense token). Útil si
>   vols mantenir prod tancat fins que el connector estigui llest per publicar. Default `false` (públic).
> - `RATE_LIMIT_MAX` (default 30) i `RATE_LIMIT_WINDOW_MS` (default 60000) — límit per IP (via `CF-Connecting-IP`).
>
> ⚠️ En desplegar aquest canvi, prod passa de "bearer obligatori" a **públic + rate-limit** (llevat que posis
> `MCP_REQUIRE_AUTH=true`). Claude Desktop segueix funcionant (el bearer actua de bypass).
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

### 5b) SSL Full (strict) — xifrat CF→origen (endurit 2026-07)
Abans era SSL=Flexible (CF→origen pel :80 en clar). Ara Full (strict) amb Origin Certificate:
1. **Cloudflare → SSL/TLS → Origin Server → Create Certificate** (hostnames `mcp.motion4rent.com`). Copiar cert + clau.
2. **A l'origen**: desar `/etc/ssl/cloudflare/mcp.pem` i `mcp.key` (`chmod 600` la clau) i afegir un segon `server{}` a `mcp-public.conf`:
   ```nginx
   server {
       listen 443 ssl;
       server_name mcp.motion4rent.com;
       ssl_certificate     /etc/ssl/cloudflare/mcp.pem;
       ssl_certificate_key /etc/ssl/cloudflare/mcp.key;
       location / { proxy_pass http://127.0.0.1:8787; proxy_http_version 1.1; proxy_buffering off;
           proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme; proxy_read_timeout 300s; }
   }
   ```
   `sudo nginx -t && sudo systemctl reload nginx`. Prova local:
   `curl -k --resolve mcp.motion4rent.com:443:127.0.0.1 https://mcp.motion4rent.com/health`.
3. **Security Group**: obrir `:443` NOMÉS als rangs de Cloudflare via managed prefix list (CloudShell):
   ```bash
   mapfile -t C < <(curl -s https://www.cloudflare.com/ips-v4)
   E=(); for c in "${C[@]}"; do E+=("Cidr=$c,Description=cloudflare"); done
   aws ec2 create-managed-prefix-list --prefix-list-name cloudflare-ipv4 --address-family IPv4 \
     --max-entries $(( ${#C[@]} + 5 )) --entries "${E[@]}" --region us-east-1
   # → PrefixListId; després authorize-security-group-ingress tcp/443 amb PrefixListIds=[{PrefixListId=...}]
   ```
   Retirar la regla `0.0.0.0/0:443` si existia.
4. **Cloudflare → Configuration Rule** de `mcp.motion4rent.com` → SSL = **Strict** (= Full strict). Verificar
   `curl -s https://mcp.motion4rent.com/health` → `{ok:true}` sense 521/526.

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
- **Claude Desktop (mètode real, bearer):** la UI de Connectors només accepta OAuth, no
  bearer estàtic → cal el pont `mcp-remote` a `claude_desktop_config.json`. Passos exactes:
  **`docs/connector-claude-desktop.md`**.
- ChatGPT: afegir com a app/connector amb la mateixa URL + token.

## 8) Després (fase següent)
- Registrar el connector i verificar `tools/list` (inclou `create_booking` + `list_currencies`).
- **⚠️ Stripe LIVE NO és un interruptor manual:** el web tria la clau segons `ENVIRONMENT` (`config/autoload/stripe.global.php`): `development` → `STRIPE_SECRET_KEY_TEST` (links `cs_test_…`); qualsevol altre valor → `STRIPE_SECRET_KEY` (**LIVE, diners reals**). El web de **producció** ja corre amb ENVIRONMENT de prod → el `urlTpv` que genera el MCP de producció **JA és LIVE**. No cal cap "pas a LIVE".
- **Conseqüència per a proves:** NO facis reserves de prova amb pagament real contra producció (cobraria). Prova el flux (inclòs el de moneda) al **Docker local / staging amb `ENVIRONMENT=development`** (Stripe TEST). Si vols un smoke test a producció: genera el link sense pagar, o paga el producte de Sevilla (1-10€) i **reemborsa'l** a Stripe.
- El **webhook** de producció arriba sol de Stripe (no cal el replay manual, que és només per a dev).
