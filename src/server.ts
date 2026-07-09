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
import { config } from "./config.js";
import { registerTools } from "./tools.js";

const SERVER_INFO = { name: "motion4rent-mcp", version: "0.1.0" };

function buildServer(): McpServer {
  const server = new McpServer(SERVER_INFO);
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

async function runHttp(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => res.json({ ok: true, server: SERVER_INFO }));

  // Endpoint MCP (Streamable HTTP), stateless: servidor+transport nous per petició.
  app.post("/mcp", async (req: Request, res: Response) => {
    // El bearer intern de confiança salta el control. Sense ell: mode privat → 401;
    // mode públic (directori) → rate-limit per IP.
    if (!hasTrustedBearer(req)) {
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
    const mode = config.requireAuth ? "privat (bearer obligatori)" : `públic (rate-limit ${config.rateLimitMax}/${Math.round(config.rateLimitWindowMs / 1000)}s)`;
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
