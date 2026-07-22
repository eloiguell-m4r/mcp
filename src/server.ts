/**
 * Punt d'entrada del servidor MCP de Motion4Rent.
 *  - MCP_TRANSPORT=stdio → transport local (per provar amb un client MCP local).
 *  - MCP_TRANSPORT=http  → Streamable HTTP remot (per registrar com a connector de
 *    Claude / app de ChatGPT). Stateless: un servidor+transport per petició.
 */

import express, { type Request, type Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createRemoteJWKSet, jwtVerify, decodeJwt } from "jose";
import { config } from "./config.js";
import { registerTools } from "./tools.js";

const SERVER_INFO = {
  name: "motion4rent-mcp",
  title: "Motion4Rent — mobility equipment rental",
  version: "0.1.0",
};

// Instruccions de servidor (MCP): el client (Claude/ChatGPT) les rep i les usa per descriure/usar el
// connector. Fixen el DOMINI de forma estricta perquè l'assistent no extrapoli categories que no
// existeixen (bug observat: en presentar el connector deia "scooters and bikes" — Motion4Rent NO lloga
// bicicletes ni motos). Regla clau: no afirmar cap categoria fins que una cerca la retorni.
const SERVER_INSTRUCTIONS =
  "Motion4Rent rents MOBILITY EQUIPMENT (mobility aids) for people with reduced mobility: manual and " +
  "electric wheelchairs, mobility scooters (electric 3/4-wheel scooters for reduced-mobility users, " +
  "NOT kick scooters, NOT motorbikes/mopeds), knee scooters, rollators/walkers and similar aids. " +
  "Motion4Rent does NOT rent bicycles, e-bikes, motorbikes, mopeds or cars — never say or imply it does. " +
  "When describing this connector, mention ONLY mobility aids; do NOT list or invent other categories " +
  "(e.g. bikes). The exact catalogue depends on the city and dates: do NOT claim any specific product " +
  "category is available until search_mobility_rentals actually returns it, and then present only the " +
  "categories in its 'product_types_available'/'products'. If the user asks for something Motion4Rent " +
  "does not rent (a bicycle, a motorbike, a car), say clearly it is not offered rather than substituting " +
  "another category. Prices returned already include fees — quote them as-is.";

function buildServer(): McpServer {
  const server = new McpServer(SERVER_INFO, { instructions: SERVER_INSTRUCTIONS });
  registerTools(server, config);
  return server;
}

async function runStdio(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdio: no imprimir res a stdout (és el canal del protocol); logs a stderr.
  console.error(`[motion4rent-mcp] stdio actiu. API=${config.apiBaseUrl}`);
}

/** Bearer INTERN de confiança (salta el rate-limit). No és l'auth del directori. */
function hasTrustedBearer(req: Request): boolean {
  if (!config.authToken) return false;
  const m = (req.header("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() === config.authToken : false;
}

/** IP real del client darrere Cloudflare/nginx (mai req.ip, que seria el proxy). */
function clientIp(req: Request): string {
  const cf = req.header("cf-connecting-ip");
  if (cf) return cf.trim();
  const xff = req.header("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.socket.remoteAddress ?? "unknown";
}

// Rate-limit en memòria, finestra fixa per IP (procés únic → n'hi ha prou; sense dependències).
const rlHits = new Map<string, { count: number; resetAt: number }>();
function rateLimit(ip: string, now: number): { ok: boolean; retryAfterSec: number } {
  const e = rlHits.get(ip);
  if (!e || now >= e.resetAt) {
    rlHits.set(ip, { count: 1, resetAt: now + config.rateLimitWindowMs });
    return { ok: true, retryAfterSec: 0 };
  }
  e.count += 1;
  if (e.count > config.rateLimitMax) {
    return { ok: false, retryAfterSec: Math.ceil((e.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfterSec: 0 };
}
// Neteja periòdica d'entrades caducades perquè el Map no creixi sense límit.
setInterval(() => {
  const now = Date.now();
  for (const [ip, e] of rlHits) if (now >= e.resetAt) rlHits.delete(ip);
}, 60_000).unref();

// ---------------------------------------------------------------------------
// OAuth 2.1 — Resource Server (AS = WorkOS AuthKit). Actiu amb config.oauthEnabled.
// El servidor NO emet tokens: només valida el JWT (signatura via JWKS de l'AS, iss, exp, aud).
// ---------------------------------------------------------------------------
const OAUTH_RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource";

/** URL pública de la metadata de recurs protegit (a l'arrel de l'origen de l'audience). */
function resourceMetadataUrl(): string {
  try {
    return new URL(config.oauthAudience).origin + OAUTH_RESOURCE_METADATA_PATH;
  } catch {
    return OAUTH_RESOURCE_METADATA_PATH;
  }
}

/** JWKS remot de l'AS (cache intern de claus per jose). Lazy. */
let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks() {
  if (!_jwks) {
    const url = config.oauthJwksUrl || `${config.oauthIssuer}/oauth2/jwks`;
    _jwks = createRemoteJWKSet(new URL(url));
  }
  return _jwks;
}

function bearerToken(req: Request): string | null {
  const m = (req.header("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/** Valida el JWT OAuth. "ok" | "unauthorized" | "insufficient_scope". */
async function verifyOAuth(req: Request): Promise<"ok" | "unauthorized" | "insufficient_scope"> {
  const token = bearerToken(req);
  if (!token) return "unauthorized";
  try {
    const verifyOpts: { issuer?: string; audience?: string } = {
      issuer: config.oauthIssuer || undefined,
    };
    if (config.oauthRequireAudience && config.oauthAudience) {
      verifyOpts.audience = config.oauthAudience; // enforce aud (RFC 8707) tret que es desactivi
    }
    const { payload } = await jwtVerify(token, getJwks(), verifyOpts);
    const required = config.oauthScopes.split(/\s+/).filter(Boolean);
    if (required.length) {
      const raw =
        typeof (payload as any).scope === "string"
          ? (payload as any).scope
          : Array.isArray((payload as any).scp)
            ? (payload as any).scp.join(" ")
            : "";
      const granted = new Set(String(raw).split(/\s+/).filter(Boolean));
      if (!required.every((s) => granted.has(s))) return "insufficient_scope";
    }
    return "ok";
  } catch (err) {
    // Log del motiu real (aud/iss/exp/signatura) per depurar sense exposar res al client.
    try {
      const c = decodeJwt(token);
      console.error(
        `[motion4rent-mcp] OAuth JWT rebutjat: ${(err as any)?.code || (err as Error)?.message} | ` +
          `token iss=${c.iss} aud=${JSON.stringify(c.aud)} exp=${c.exp} | ` +
          `esperat iss=${config.oauthIssuer} aud=${config.oauthAudience}`,
      );
    } catch {
      console.error("[motion4rent-mcp] OAuth JWT rebutjat (no descodificable):", (err as Error)?.message);
    }
    return "unauthorized";
  }
}

async function runHttp(): Promise<void> {
  const app = express();

  // CORS: els clients MCP basats en navegador (MCP Inspector, claude.ai) fan fetch directe;
  // sense CORS el navegador bloqueja les crides ("failed to fetch") i el flux OAuth. Cal també
  // exposar WWW-Authenticate (el client el llegeix del 401 per descobrir l'AS) i respondre el preflight.
  app.use((req: Request, res: Response, next) => {
    res.header("Access-Control-Allow-Origin", req.header("origin") ?? "*");
    res.header("Vary", "Origin");
    res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.header(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
    );
    res.header("Access-Control-Expose-Headers", "WWW-Authenticate, Mcp-Session-Id");
    res.header("Access-Control-Max-Age", "86400");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => res.json({ ok: true, server: SERVER_INFO }));

  // Metadata de recurs protegit (RFC 9728) — indica als clients on és l'AS per iniciar OAuth.
  if (config.oauthEnabled) {
    app.get(OAUTH_RESOURCE_METADATA_PATH, (_req, res) => {
      res.json({
        resource: config.oauthAudience,
        authorization_servers: config.oauthIssuer ? [config.oauthIssuer] : [],
        scopes_supported: config.oauthScopes.split(/\s+/).filter(Boolean),
        bearer_methods_supported: ["header"],
      });
    });
  }

  // Endpoint MCP (Streamable HTTP), stateless: servidor+transport nous per petició.
  app.post("/mcp", async (req: Request, res: Response) => {
    // 1) El bearer intern de confiança sempre passa (stdio/local, proves internes).
    if (!hasTrustedBearer(req)) {
      if (config.oauthEnabled) {
        // 2) OAuth: cal un JWT vàlid emès per l'AS per a aquest recurs (aud).
        const verdict = await verifyOAuth(req);
        if (verdict === "unauthorized") {
          const scopePart = config.oauthScopes ? `, scope="${config.oauthScopes}"` : "";
          res.set("WWW-Authenticate", `Bearer resource_metadata="${resourceMetadataUrl()}"${scopePart}`);
          res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null });
          return;
        }
        if (verdict === "insufficient_scope") {
          res.set(
            "WWW-Authenticate",
            `Bearer error="insufficient_scope", scope="${config.oauthScopes}", resource_metadata="${resourceMetadataUrl()}"`,
          );
          res.status(403).json({ jsonrpc: "2.0", error: { code: -32002, message: "Insufficient scope" }, id: null });
          return;
        }
        // verdict === "ok" → continua
      } else {
        // Sense OAuth: mode privat (bearer obligatori → 401) o públic (rate-limit per IP).
        if (config.requireAuth) {
          res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null });
          return;
        }
        const { ok, retryAfterSec } = rateLimit(clientIp(req), Date.now());
        if (!ok) {
          res.set("Retry-After", String(retryAfterSec));
          res.status(429).json({ jsonrpc: "2.0", error: { code: -32029, message: "Too many requests" }, id: null });
          return;
        }
      }
    }
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      console.error("[motion4rent-mcp] error /mcp:", (e as Error).message);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
      }
    }
  });

  // En mode stateless no hi ha sessions: GET/DELETE no s'admeten.
  const methodNotAllowed = (_req: Request, res: Response) =>
    res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  app.listen(config.port, () => {
    const mode = config.oauthEnabled
      ? `OAuth (AS=${config.oauthIssuer || "?"}, aud=${config.oauthAudience})`
      : config.requireAuth
        ? "privat (bearer obligatori)"
        : `públic (rate-limit ${config.rateLimitMax}/${Math.round(config.rateLimitWindowMs / 1000)}s)`;
    console.error(`[motion4rent-mcp] HTTP actiu a :${config.port}/mcp  API=${config.apiBaseUrl}  mode=${mode}  bearer-intern=${config.authToken ? "on" : "off"}`);
  });
}

async function main(): Promise<void> {
  if (config.transport === "stdio") {
    await runStdio();
  } else {
    await runHttp();
  }
}

main().catch((e) => {
  console.error("[motion4rent-mcp] fatal:", e);
  process.exit(1);
});
