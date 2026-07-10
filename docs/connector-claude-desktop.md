# Connector Motion4Rent MCP a Claude Desktop (mètode real)

Com hem afegit el servidor MCP de producció (`https://mcp.motion4rent.com/mcp`) a
Claude Desktop al Mac.

## Per què no per la UI de "Connectors"
La UI de connectors de Claude Desktop / claude.ai web espera servidors remots amb **OAuth**
(descoberta `.well-known` + flux d'autorització). El nostre MCP encara **no** té OAuth
(vegeu `docs/oauth-implementation-plan.md`), així que de moment seguim afegint-lo amb
**`mcp-remote`** com a pont: un procés local (stdio ↔ HTTP) que Claude Desktop arrenca i que
reenvia el JSON-RPC al nostre `/mcp` per HTTPS. Així Claude Desktop parla amb el servidor com
si fos un MCP local.

> ℹ️ **Canvi recent:** ara l'endpoint `/mcp` és **públic** (rate-limited), no protegit per bearer
> obligatori. Per tant el `--header Authorization: Bearer …` del JSON **ja no és imprescindible**
> perquè funcioni — però **el mantenim** perquè el bearer actua de **bypass del rate-limit**
> (si no, Claude Desktop podria quedar limitat en ús intensiu). El JSON de sota **no canvia**.
> Quan implementem OAuth (opció B), aleshores sí que es podrà afegir directament per la UI de
> Connectors, sense `mcp-remote` ni bearer.

## Fitxer de configuració
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json` → vegeu la secció **"Com editar el config a WINDOWS"** (el JSON és lleugerament diferent: `cmd /c npx`).

El JSON de sota és per a **macOS**. Afegeix (o fusiona) dins de `mcpServers`:

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

Amb l'endpoint públic, el bearer és **opcional però recomanat**: sense ell el connector també
funciona (fins que topi amb el rate-limit); amb ell, salta el límit. Si el servidor s'executés en
mode privat (`MCP_REQUIRE_AUTH=true`), aleshores el bearer sí que seria **obligatori**.

### Variant SENSE Authorization (connector públic)
Com que `/mcp` és públic, també funciona **sense** la línia del bearer (només perds el bypass del
rate-limit). Útil per instal·lar-lo a algú sense donar-li el token:

```json
{
  "mcpServers": {
    "motion4rent-mcp": {
      "command": "/opt/homebrew/bin/npx",
      "args": [
        "-y",
        "mcp-remote@0.1.16",
        "https://mcp.motion4rent.com/mcp"
      ],
      "env": {
        "PATH": "/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
      }
    }
  }
}
```

## Com editar el config pas a pas (instal·lar-lo a un altre Mac)

**Requisit previ — Node.js (aporta `npx`):**
1. Obre **Terminal** i escriu: `which npx`
   - Si torna una ruta (p. ex. `/opt/homebrew/bin/npx`), ja el tens → **apunta-la**, la faràs servir a `command`.
   - Si no torna res: instal·la Node des de <https://nodejs.org> (instal·lador `.pkg`) o amb Homebrew
     (`brew install node`) i torna a fer `which npx`.
   - Rutes típiques: Apple Silicon (M1/M2/M3) → `/opt/homebrew/bin/npx`; Intel o instal·lador de
     nodejs.org → `/usr/local/bin/npx`. **Usa la que et doni `which npx`** (i posa la seva carpeta a `env.PATH`).

**Editar el fitxer:**
1. **Obre'l** (crea la carpeta i el fitxer si no existeixen). A Terminal:
   ```bash
   mkdir -p ~/Library/Application\ Support/Claude
   touch ~/Library/Application\ Support/Claude/claude_desktop_config.json
   open -e ~/Library/Application\ Support/Claude/claude_desktop_config.json
   ```
   S'obre a TextEdit. (Alternativa gràfica: Finder → menú **Anar → Anar a la carpeta…** (⇧⌘G) →
   enganxa `~/Library/Application Support/Claude/` → obre `claude_desktop_config.json`.)
   ⚠️ Si uses **TextEdit**, posa'l en text net: **Format → Convertir en text net** (⇧⌘T), perquè no
   canviï les cometes `"` per cometes corbes `"` `"`, que **trenquen el JSON**. Millor encara: obre'l amb **VS Code**.
2. **Enganxa la configuració:**
   - Si el fitxer està **buit** → enganxa el bloc JSON sencer (amb o sense Authorization).
   - Si **ja té contingut** (altres `mcpServers`, `preferences`, etc.) → **no esborris res**. Afegeix
     només l'entrada `"motion4rent-mcp": { … }` **dins** de l'objecte `"mcpServers"` existent, separada
     amb una **coma** de les altres entrades. Si no hi ha `"mcpServers"`, crea'l al primer nivell.
3. **Ajusta** `command` i `env.PATH` a la ruta de `npx` de `which npx`. Si vols bearer, substitueix
   `<MCP_AUTH_TOKEN>`; si no, fes servir la variant sense Authorization.
4. **Desa** (⌘S). Verifica que el JSON és vàlid (claus i comes ben tancades) — pots enganxar-lo a
   `jsonlint.com` per comprovar-ho.
5. **Reinicia Claude Desktop DEL TOT**: **⌘Q** (no només tancar la finestra) i torna'l a obrir.
6. **Verifica**: han d'aparèixer les tools de `motion4rent-mcp`. Prova: *"Search mobility scooters in Barcelona"*.

> Exemple de **fusió** quan el fitxer ja tenia una altra entrada:
> ```json
> {
>   "mcpServers": {
>     "un-altre-server": { "command": "…" },
>     "motion4rent-mcp": { "command": "/opt/homebrew/bin/npx", "args": ["-y","mcp-remote@0.1.16","https://mcp.motion4rent.com/mcp"], "env": { "PATH": "/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin" } }
>   }
> }
> ```
> (Fixa't en la **coma** entre les dues entrades.)

## Com editar el config a WINDOWS

Fitxer: **`%APPDATA%\Claude\claude_desktop_config.json`**
(= `C:\Users\<usuari>\AppData\Roaming\Claude\claude_desktop_config.json`).

A Windows, Claude Desktop sovint **no** sap arrencar `npx` directament (és un `.cmd`); el patró que
funciona és cridar-lo via `cmd /c`. Per això el JSON és una mica diferent del de Mac:

```json
{
  "mcpServers": {
    "motion4rent-mcp": {
      "command": "cmd",
      "args": [
        "/c",
        "npx",
        "-y",
        "mcp-remote@0.1.16",
        "https://mcp.motion4rent.com/mcp",
        "--header",
        "Authorization:Bearer <MCP_AUTH_TOKEN>"
      ]
    }
  }
}
```

Sense bearer (connector públic): treu les dues últimes línies dels `args`
(`"--header"` i `"Authorization:Bearer <MCP_AUTH_TOKEN>"`).

> A Windows normalment **no cal `env.PATH`**: `cmd` ja troba `npx` al PATH del sistema (l'instal·lador
> de Node l'hi afegeix). Si `npx` no es troba, alternativa: posa la ruta completa, p. ex.
> `"command": "C:\\Program Files\\nodejs\\npx.cmd"` (barres invertides **dobles**) i treu `"cmd"`,`"/c"`.

**Passos:**
1. **Node.js**: instal·la des de <https://nodejs.org> (instal·lador `.msi`). Comprova a **PowerShell**:
   `npx --version` (i `where npx` per veure la ruta).
2. **Obre la carpeta**: `Win + R` → escriu `%APPDATA%\Claude` → Enter (s'obre a l'Explorador).
3. **Crea/obre el fitxer** (si no existeix). El més robust, a **PowerShell**:
   ```powershell
   New-Item -ItemType Directory -Force "$env:APPDATA\Claude" | Out-Null
   if (!(Test-Path "$env:APPDATA\Claude\claude_desktop_config.json")) { '{}' | Out-File -Encoding utf8 "$env:APPDATA\Claude\claude_desktop_config.json" }
   notepad "$env:APPDATA\Claude\claude_desktop_config.json"
   ```
   ⚠️ Si el crees des de l'Explorador (Nou → Document de text): activa **Visualització → Extensions de
   nom de fitxer** i assegura't que es diu `claude_desktop_config.json` i **no** `...json.txt`.
4. **Enganxa/fusiona** igual que a Mac (buit → tot el bloc; amb contingut → afegeix només l'entrada
   `motion4rent-mcp` dins `mcpServers`, amb la coma). Notepad a Windows **no** posa cometes corbes, així
   que és segur; tot i així VS Code va millor.
5. **Desa** (⌘/Ctrl+S). Si uses Notepad i "Desa com a", tria **Tipus: Tots els fitxers** i codificació **UTF-8**.
6. **Tanca Claude Desktop DEL TOT**: es queda a la **safata del sistema** (a prop del rellotge) →
   clic dret a la icona → **Quit/Sortir** (tancar la finestra NO n'hi ha prou). Torna'l a obrir.
7. **Verifica**: han de sortir les tools de `motion4rent-mcp`. Prova *"Search mobility scooters in Barcelona"*.

## Detalls que importen (i per què)
- **`command` amb ruta absoluta `/opt/homebrew/bin/npx`**: Claude Desktop NO hereta el
  PATH del shell; amb `npx` pelat no el troba i el connector falla. (Homebrew a Apple
  Silicon → `/opt/homebrew/bin`; en Intel seria `/usr/local/bin`.)
- **`env.PATH`**: perquè `npx`/`node` trobin les seves dependències en arrencar.
- **`mcp-remote@0.1.16`**: versió fixada que funciona. Si actualitzes, revisa que segueixi
  acceptant `--header`.
- **`--header "Authorization:Bearer …"`**: sense espai després dels dos punts de `Authorization:`
  (format que espera `mcp-remote`); l'espai va abans del token, dins del valor.

## Verificar / depurar
- Health del servidor: `curl https://mcp.motion4rent.com/health` → `{ ok: true, … }`.
- Si no surten les tools: revisa que `npx` existeix a la ruta indicada, que el token és
  correcte i que has reiniciat l'app del tot. Els logs de Claude Desktop són a
  `~/Library/Logs/Claude/`.

## Relacionat
- Desplegament del servidor MCP i Cloudflare: `docs/desplegament-prod-runbook.md`.
- Visió general de l'arquitectura del connector: `docs/desplegament.md`.
