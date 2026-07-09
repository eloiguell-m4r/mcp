# Checklist de desplegament — canvis de la sessió

Estat: **tot committejat i pujat** (MCP → GitHub `origin/master`; WEB → Bitbucket `master`).
Aquest checklist és de **desplegament + verificació**, no de commits.

## 1) Canvis d'aquesta sessió (agrupats)

**MCP (`webs/mcp`) — desplegament MANUAL:**
- Fix **pickup**: només s'ofereix "Store pickup" si la botiga en té (virtuals → no).
- **Fitxa rica** a la cerca: preu final, `price_per_day`, `rating`/`reviews`, `attributes`,
  `delivery_options`, `free_cancellation_until`, foto.
- **Filtre per tipus** + sostre `MAX_PRODUCTS=25` (mostra tots els del tipus demanat, no 3).
- **Model + specs reals via `products/load`** (Librecar Mistral, etc.) a search i get_rental_details.
- **Anotacions** de tools (`readOnlyHint` a lectura; `create_booking` no destructiva/no idempotent).
- **Auth nova**: `/mcp` públic + **rate-limit** per IP; `MCP_AUTH_TOKEN` = bypass intern.

**WEB (`motion4rent-web`) — desplegament AUTOMÀTIC (pipeline en push):**
- Guard **`pickup_not_available`** a `AiCheckoutController` (rebutja reserva de pickup si la botiga no en té).
- Secció de privadesa **"Booking through our AI assistant (Claude)"** a `privacy.phtml`
  + traduccions als 9 idiomes (locales d'Application).

## 2) Decisió prèvia (MCP)
⚠️ En desplegar el MCP, `/mcp` passa de **bearer obligatori** a **públic + rate-limit**.
- Si encara **no** vols obrir-lo (no publicat al directori): posa **`MCP_REQUIRE_AUTH=true`** al
  `.env` de producció abans de reiniciar → segueix exigint el bearer.
- Si vols deixar-lo públic ja: no facis res (default). Claude Desktop segueix funcionant (bearer = bypass).
- Opcional: ajustar `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS`.

## 3) Desplegament

### A) WEB (ja s'ha disparat sol en fer push a master)
El pipeline de Bitbucket fa SSH als servidors **USA + EU** i executa
`cd /var/www/html && sudo git pull --no-edit origin master`.
- [ ] Confirmar que el pipeline ha acabat OK (Bitbucket → Pipelines).
- [ ] ⚠️ **Cache de Laminas**: el `git pull` NO neteja cache. Si la web cacheja config/traduccions,
      la nova secció de privadesa (i les traduccions) pot no aparèixer fins a netejar-la.
      Netejar el cache de l'app a USA i EU (p. ex. esborrar `data/cache/*` / rebuild config) si cal.

### B) MCP (manual, al servidor)
- [ ] (Opcional) editar `.env`: `MCP_REQUIRE_AUTH=true` si es vol mantenir privat; rate-limit.
- [ ] Desplegar:
  ```
  cd /var/www/mcp && git pull && npm ci && npm run build && sudo systemctl restart motion4rent-mcp
  ```
- [ ] `systemctl status motion4rent-mcp` → actiu; al log ha de sortir `mode=públic (rate-limit …)`
      o `mode=privat` segons el que hagis triat.

## 4) Verificació post-deploy
- [ ] **Health**: `curl https://mcp.motion4rent.com/health` → `{ ok: true, … }`.
- [ ] **Web privadesa**: obrir `https://www.motion4rent.com/privacy` (i `/es/privacidad`,
      `/fr/...`) → hi surt la secció "Booking through our AI assistant (Claude)" traduïda.
- [ ] **Cerca amb model/filtre** (Claude Desktop o Inspector): "electric wheelchairs a València,
      14–15 ago" → ~15 resultats **del tipus**, amb **model** real (Librecar Mistral…), specs, foto,
      preu final, opcions de lliurament i cancel·lació gratuïta.
- [ ] **Pickup**: en un producte de botiga virtual (València) → NO apareix "Store pickup".
- [ ] **Reserva de prova (NOMÉS Invacare Leo)**: Sevilla, **divendres 23:00→23:00**, producte
      **"Mobility scooter — Invacare Leo"** (id 8621). `create_booking` → torna `urlTpv`. **NO pagar.**
      ⚠️ **No reservar** el "Manual wheelchair" (id 559) ni cap altre → seria reserva real.
- [ ] (Si públic) **Rate-limit**: >30 peticions/min des d'una IP → `429 Too many requests`.

## 5) Rollback
- MCP: `cd /var/www/mcp && git checkout <commit_anterior> && npm ci && npm run build && sudo systemctl restart motion4rent-mcp`.
- WEB: revert al repo + push (torna a disparar el pipeline) o `git reset` al servidor.

## Relacionats
- `docs/publicar-directori-claude.md` · `docs/publicar-chatgpt.md` · `docs/listing-directori.md`
- `docs/desplegament-prod-runbook.md` (env vars) · `docs/connector-claude-desktop.md`
