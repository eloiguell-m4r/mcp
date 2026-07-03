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

function authorized(req: Request): boolean {
  if (!config.authToken) return true; // sense token configurat → obert
  const h = req.header("authorization") ?? "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() === config.authToken : false;
}

async function runHttp(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => res.json({ ok: true, server: SERVER_INFO }));

  // Endpoint MCP (Streamable HTTP), stateless: servidor+transport nous per petició.
  app.post("/mcp", async (req: Request, res: Response) => {
    if (!authorized(req)) {
      res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null });
      return;
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
    console.error(`[motion4rent-mcp] HTTP actiu a :${config.port}/mcp  API=${config.apiBaseUrl}  auth=${config.authToken ? "on" : "off"}`);
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
