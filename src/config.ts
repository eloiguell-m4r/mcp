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
  /** Token bearer opcional per a l'endpoint HTTP. Buit = sense auth. */
  authToken: (process.env.MCP_AUTH_TOKEN ?? "").trim(),
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
