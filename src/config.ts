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
};

export type AppConfig = typeof config;
