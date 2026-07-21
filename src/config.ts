/**
 * Configuració del servidor MCP (llegida de l'entorn). Sense secrets al codi.
 */

function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`Falta la variable d'entorn ${name}`);
  }
  return v;
}

export const config = {
  transport: (process.env.MCP_TRANSPORT ?? "http").trim().toLowerCase() as "http" | "stdio",
  port: Number(process.env.PORT ?? 8787),
  /**
   * Token bearer opcional. NO és l'auth del directori (que és OAuth/none): serveix com a
   * credencial INTERNA de confiança — un request amb aquest bearer salta el rate-limit.
   * Buit = no hi ha bypass intern.
   */
  authToken: (process.env.MCP_AUTH_TOKEN ?? "").trim(),
  /**
   * Si true, l'endpoint /mcp EXIGEIX el bearer (desplegament privat/intern → 401 sense token).
   * Per al directori de Claude/ChatGPT ha de ser FALSE (connector públic): el flux d'alta no
   * deixa enganxar un bearer estàtic. Default false = públic + rate-limit.
   */
  requireAuth: (process.env.MCP_REQUIRE_AUTH ?? "").trim().toLowerCase() === "true",
  /** Rate-limit del /mcp públic (per IP): finestra i màxim de peticions. El bearer intern el salta. */
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000) || 60_000,
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX ?? 30) || 30,
  /**
   * OAuth 2.1 (Resource Server) — protecció publish-ready per al directori. AS = WorkOS AuthKit.
   * Amb oauthEnabled=false el comportament és el d'ara (públic + rate-limit): rollout per fases.
   * Quan és true, /mcp exigeix un JWT vàlid (o el bearer intern) i exposem la metadata RFC 9728.
   */
  oauthEnabled: (process.env.OAUTH_ENABLED ?? "").trim().toLowerCase() === "true",
  /**
   * Issuer de l'AS (WorkOS AuthKit), p. ex. https://<tenant>.authkit.app. Es NORMALITZA a https://
   * (s'afegeix l'esquema si falta i http→https) perquè ha de coincidir EXACTAMENT amb el `iss` del
   * token (que és https); un http:// aquí provoca 401 "after successful authentication".
   */
  oauthIssuer: (() => {
    let v = (process.env.OAUTH_ISSUER ?? "").trim().replace(/\/+$/, "");
    if (!v) return "";
    if (!/^https?:\/\//i.test(v)) v = "https://" + v;
    return v.replace(/^http:\/\//i, "https://");
  })(),
  /** JWKS de l'AS. Si buit, es derivarà de l'issuer (issuer + /oauth2/jwks o .well-known). */
  oauthJwksUrl: (process.env.OAUTH_JWKS_URL ?? "").trim(),
  /** Audience del token = URI canònica de l'MCP (RFC 8707). El RS només accepta tokens per a ell. */
  oauthAudience: (process.env.OAUTH_AUDIENCE ?? "https://mcp.motion4rent.com/mcp").trim(),
  /**
   * Exigir que el `aud` del token sigui exactament oauthAudience (RFC 8707). Default true.
   * Posa-ho a false com a xarxa de seguretat si l'AS/client no lliga el `aud` al recurs (p. ex.
   * WorkOS torna aud=client_id perquè el client no envia `resource`): aleshores es valida només
   * signatura + iss + exp (segur si l'AS és dedicat a aquest connector, com és el cas).
   */
  oauthRequireAudience: (process.env.OAUTH_REQUIRE_AUDIENCE ?? "true").trim().toLowerCase() !== "false",
  /**
   * Scope requerit (space-separated). BUIT per defecte: WorkOS AuthKit emet scopes OIDC estàndard
   * (openid/profile/email/offline_access), no un scope custom → la garantia és l'audience binding.
   * Només omple això si configures permisos/scopes propis a l'AS.
   */
  oauthScopes: (process.env.OAUTH_SCOPES ?? "").trim(),
  /** Base de l'API de motion4rent (endpoints públics /search, /ai/cities, /details). */
  apiBaseUrl: env("M4R_API_BASE_URL", "http://localhost:3000").replace(/\/+$/, ""),
  /** Base de la web pública per als deep-links. */
  webBaseUrl: env("WEB_BASE_URL", "https://www.motion4rent.com").replace(/\/+$/, ""),
  tenant: env("TENANT", "motion4rent"),
  /**
   * Base del WEB que exposa POST /ai/checkout (booking headless, Fase 3A).
   * Buit = booking deshabilitat (només descoberta + deep-link).
   */
  checkoutBaseUrl: (process.env.M4R_CHECKOUT_BASE_URL ?? "").trim().replace(/\/+$/, ""),
  /** Secret bearer compartit amb el web (AI_CHECKOUT_SECRET). */
  checkoutSecret: (process.env.M4R_CHECKOUT_SECRET ?? "").trim(),
  /** Base CDN (CloudFront) per a les imatges de producte: {base}/{filename}. Amplada w800 per defecte. */
  productImageBase: (process.env.PRODUCT_IMAGE_BASE ?? "https://d3alzpqy0fqlq2.cloudfront.net/products/cache/w800")
    .trim()
    .replace(/\/+$/, ""),
  /**
   * Fee de gestió M4R base (EUR) que /details i el booking sumen al preu (feeGestionM4R = aquest + store.extra_fee),
   * però que l'API de cerca NO inclou. El sumem al preu de la cerca perquè el llistat mostri el preu FINAL.
   * Ha de coincidir amb el valor del web (motion4rent-api/routes/details.js). Si allà canvia, actualitza'l aquí.
   */
  managementFeeEur: Number(process.env.M4R_MANAGEMENT_FEE_EUR ?? 9) || 9,
};

export type AppConfig = typeof config;
