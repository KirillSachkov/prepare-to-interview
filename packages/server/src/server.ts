import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { serve, type ServerType } from "@hono/node-server";
import { WebSocketServer } from "ws";
import { apiPaths, tokenQueryParam } from "@prepare-to-interview/shared";
import type { McpServerConfig } from "./agent/driver.ts";
import { Canvas } from "./canvas/canvas.ts";
import { loopbackHost } from "./config.ts";
import { openDataDir } from "./data-dir.ts";
import { openDatabase } from "./db/database.ts";
import { EventBus } from "./events.ts";
import { createApp } from "./http/app.ts";
import { createMcpHandler, mcpServerName } from "./mcp/handler.ts";
import { createTools } from "./mcp/tools.ts";

export const appVersion = "0.0.0";
export const defaultClientDir = fileURLToPath(new URL("../../client/dist", import.meta.url));

export interface ServerOptions {
  dataDir: string;
  /** 0 picks a free port. */
  port: number;
  clientDir?: string;
}

export interface RunningServer {
  /** Tokenized URL the Candidate opens in the browser. */
  url: string;
  port: number;
  token: string;
  /** How an Agent session reaches the app's MCP tools. */
  mcpServer: McpServerConfig;
  close: () => Promise<void>;
}

export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const dataDir = openDataDir(options.dataDir);
  const db = openDatabase(dataDir.databaseFile);
  const events = new EventBus();
  const canvas = new Canvas(db, events);
  let allowedHosts: ReadonlySet<string> = new Set();

  const app = createApp({
    token: dataDir.token,
    allowedHosts: () => allowedHosts,
    canvas,
    events,
    mcp: createMcpHandler(createTools(canvas), appVersion),
    clientDir: options.clientDir ?? defaultClientDir,
  });

  const wss = new WebSocketServer({ noServer: true });
  let httpServer: ServerType;
  try {
    httpServer = await listen((ready) =>
      serve({ fetch: app.fetch, hostname: loopbackHost, port: options.port, websocket: { server: wss } }, ready),
    );
  } catch (error) {
    db.$client.close();
    throw error;
  }
  const port = (httpServer.address() as AddressInfo).port;
  allowedHosts = new Set([`${loopbackHost}:${port}`, `localhost:${port}`]);
  const origin = `http://${loopbackHost}:${port}`;

  return {
    url: `${origin}/?${tokenQueryParam}=${dataDir.token}`,
    port,
    token: dataDir.token,
    mcpServer: {
      type: "http",
      name: mcpServerName,
      url: origin + apiPaths.mcp,
      headers: [{ name: "Authorization", value: `Bearer ${dataDir.token}` }],
    },
    close: async () => {
      for (const client of wss.clients) client.terminate();
      wss.close();
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
        if ("closeAllConnections" in httpServer) httpServer.closeAllConnections();
      });
      db.$client.close();
    },
  };
}

function listen(start: (ready: () => void) => ServerType): Promise<ServerType> {
  return new Promise((resolve, reject) => {
    const server = start(() => resolve(server));
    server.once("error", reject);
  });
}
