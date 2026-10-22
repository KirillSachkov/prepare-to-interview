import fs from "node:fs";
import path from "node:path";
import { upgradeWebSocket } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { z } from "zod";
import { apiPaths, type AgentsResponse, type ServerEvent } from "@prepare-to-interview/shared";
import type { AgentDetector } from "../agent/detect.ts";
import type { Canvas } from "../canvas/canvas.ts";
import { ChatBusyError, type Chat } from "../chat/chat.ts";
import type { EventBus } from "../events.ts";
import type { McpHandler } from "../mcp/handler.ts";
import { agentSettingsUpdate, type Settings } from "../settings/settings.ts";
import { hostGuard, tokenGuard } from "./access.ts";

export interface AppDeps {
  token: string;
  allowedHosts: () => ReadonlySet<string>;
  canvas: Canvas;
  chat: Chat;
  settings: Settings;
  detectAgents: AgentDetector;
  events: EventBus;
  mcp: McpHandler;
  /** Directory with the built client (`index.html` and assets). */
  clientDir: string;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  app.use("*", hostGuard(deps.allowedHosts));
  app.use("*", tokenGuard(deps.token));

  app.post(apiPaths.mcp, (c) => deps.mcp(c.req.raw));
  app.on(["GET", "DELETE"], apiPaths.mcp, (c) => c.text("Stateless MCP endpoint: use POST", 405));

  app.get(apiPaths.canvas, (c) => c.json(deps.canvas.snapshot()));

  app.get(apiPaths.chat, (c) => c.json(deps.chat.snapshot()));
  app.post(apiPaths.chatMessages, async (c) => {
    const body = chatSendRequest.safeParse(await readJson(c.req.raw));
    if (!body.success) return c.json({ error: "Send {\"text\": \"<1-20000 characters>\"}." }, 400);
    try {
      return c.json({ message: deps.chat.send(body.data.text) }, 202);
    } catch (error) {
      if (error instanceof ChatBusyError) return c.json({ error: error.message }, 409);
      throw error;
    }
  });
  app.post(apiPaths.chatStop, async (c) => {
    await deps.chat.stop();
    return c.body(null, 204);
  });

  app.get(apiPaths.agents, (c) =>
    c.json({ agents: deps.detectAgents(), settings: deps.settings.agentSettings() } satisfies AgentsResponse),
  );
  app.put(apiPaths.agentSettings, async (c) => {
    const body = agentSettingsUpdate.safeParse(await readJson(c.req.raw));
    if (!body.success) {
      return c.json({ error: 'Send {"agent": "claude" | "codex" | "opencode", "model": "<optional>"}.' }, 400);
    }
    const agent = deps.detectAgents().find((a) => a.id === body.data.agent);
    if (!agent?.installed) return c.json({ error: `${agent?.label ?? body.data.agent} is not installed. ${agent?.detail ?? ""}`.trim() }, 400);
    return c.json(deps.settings.updateAgent(body.data));
  });

  app.get(
    apiPaths.events,
    upgradeWebSocket(() => {
      let unsubscribe: (() => void) | undefined;
      return {
        onOpen: (_event, ws) => {
          unsubscribe = deps.events.subscribe((event: ServerEvent) => ws.send(JSON.stringify(event)));
        },
        onClose: () => unsubscribe?.(),
      };
    }),
  );

  app.all("/api/*", (c) => c.text("Not found", 404));

  app.use("*", serveStatic({ root: deps.clientDir }));
  app.get("*", (c) => {
    const index = path.join(deps.clientDir, "index.html");
    if (!fs.existsSync(index)) return c.text("Client is not built: run `pnpm start` from the repository root.", 503);
    return c.html(fs.readFileSync(index, "utf8"));
  });

  return app;
}

const chatSendRequest = z.strictObject({ text: z.string().trim().min(1).max(20_000) });

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}
