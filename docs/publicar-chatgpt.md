# Demanar que afegeixin el connector a ChatGPT

Com enviar `mcp.motion4rent.com` al **directori d'apps de ChatGPT** (Apps SDK d'OpenAI),
perquè els usuaris de ChatGPT el puguin descobrir i fer servir.

> ⚠️ L'Apps SDK i el directori estan en **beta** (mitjans 2026); passos i URLs poden canviar.
> Verifica contra la documentació oficial: <https://developers.openai.com/apps-sdk> (seccions
> *deploy/submission* i *app-submission-guidelines*).

## Context
Les "apps" de ChatGPT es construeixen amb l'**Apps SDK**, que parla **MCP** igual que el
nostre servidor. Bona notícia: el mateix servidor MCP pot servir per als dos ecosistemes
(Claude i ChatGPT); el que canvia és el procés d'alta i alguns requisits.

## Requisits previs
- **Compte a OpenAI Platform** amb **verificació** completada (individual o d'empresa, segons
  l'entitat que publica). S'exigeix durant la revisió.
- Permisos: `api.apps.write` (crear/enviar drafts) i `api.apps.read` (veure estat). Els
  *owners* de l'organització els tenen automàticament.

## Requisits del servidor MCP
- **Domini públic accessible** (no endpoints locals/de test). ✅ `mcp.motion4rent.com`.
- Definir una **Content Security Policy (CSP)** per complir seguretat.
- URL **universal** o *template* amb `{placeholder}` si calen endpoints per workspace.
- **OAuth** (credencials) si el servei és autenticat. ⚠️ Ara usem bearer estàtic → per a
  ChatGPT caldrà OAuth igual que per a Claude (mateix bloqueig; fer-ho un cop serveix per als dos).

## Materials a preparar (camps del formulari)
- Nom de l'app, **logo**, descripció (clara i específica; eviten noms genèrics d'una paraula).
- Informació d'empresa i **URLs de política de privadesa**.
- **Captures de pantalla**.
- **Prompts de prova + respostes esperades**.
- Dades de **localització** i **països** on estarà disponible.
- Detalls de connexió **MCP** + credencials **OAuth** si aplica.

## Procés d'enviament
1. Construeix i prova l'app en **Developer Mode** dins ChatGPT (activa Developer Mode i
   connecta el teu servidor MCP).
2. Al **Dashboard d'OpenAI Platform** → gestió d'apps:
   **`https://platform.openai.com/apps-manage`**.
3. **Escaneja** l'endpoint MCP del draft: OpenAI desa la metadata descoberta amb aquesta
   versió (tracta la metadata del servidor com un **contracte d'API versionat** — enviar la
   versió envia aquesta *snapshot* a revisió).
4. Omple tots els camps (nom, logo, descripció, empresa, privadesa, captures, prompts de
   prova, localització, països) i afegeix credencials OAuth si cal.
5. **Envia** a revisió → reps un email de confirmació amb un **Case ID** (necessari per a
   qualsevol suport posterior).

> Només pot haver-hi **una versió en revisió alhora**. Si cal, cancel·la i reenvia; no creïs
> apps duplicades.

## Revisió i publicació
- Barreja d'**escaneigs automàtics** i **comprovacions manuals**.
- Motius habituals de rebuig: problemes de **connectivitat** del servidor, **casos de prova
  que fallen**, **dades d'usuari no declarades**, **anotacions de tools que no quadren**, o
  apps incompletes / demo.
- Les apps han de ser **estables, ràpides i completes** (res de crashes, penjades o demos).
- **Timeline**: variable (beta); no es poden accelerar revisions.
- Un cop aprovada, **publica** des del dashboard. Els usuaris la troben per **enllaç directe**
  o cercant pel **nom**.

## Resum del que ens falta abans d'enviar
1. **OAuth** al servidor MCP (compartit amb el requisit de Claude).
2. Definir **CSP**.
3. **Verificació** de desenvolupador/empresa a OpenAI Platform.
4. Materials del listing: logo, descripció, captures, **prompts de prova**, privadesa, països.
5. Provar-ho a fons en **Developer Mode** abans d'enviar.

## Fonts
- [Submit and maintain your app — Apps SDK](https://developers.openai.com/apps-sdk/deploy/submission)
- [App submission guidelines](https://developers.openai.com/apps-sdk/app-submission-guidelines)
- [Developers can now submit apps to ChatGPT (anunci)](https://openai.com/index/developers-can-now-submit-apps-to-chatgpt/)
- [Submitting apps to the ChatGPT app directory (Help Center)](https://help.openai.com/en/articles/20001040)
