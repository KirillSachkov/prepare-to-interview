import fs from "node:fs";
import path from "node:path";
import { upgradeWebSocket } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { z } from "zod";
import { apiPaths, type ServerEvent } from "@prepare-to-interview/shared";
import { UnknownNodeError, type Canvas } from "../canvas/canvas.ts";
import type { EventBus } from "../events.ts";
import type { McpHandler } from "../mcp/handler.ts";
import { hostGuard, tokenGuard } from "./access.ts";

export interface AppDeps {
  token: string;
  allowedHosts: () => ReadonlySet<string>;
  canvas: Canvas;
  events: EventBus;
  mcp: McpHandler;
  /** Directory with the built client (`index.html` and assets). */
  clientDir: string;
}

const position = z.strictObject({ x: z.number(), y: z.number() });

const layoutUpdateRequest = z.strictObject({
  updates: z
    .array(z.strictObject({ nodeId: z.string().min(1), position: position.optional(), collapsed: z.boolean().optional() }))
    .max(1000),
});

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  app.use("*", hostGuard(deps.allowedHosts));
  app.use("*", tokenGuard(deps.token));

  app.post(apiPaths.mcp, (c) => deps.mcp(c.req.raw));
  app.on(["GET", "DELETE"], apiPaths.mcp, (c) => c.text("Stateless MCP endpoint: use POST", 405));

  app.get(apiPaths.canvas, (c) => c.json(deps.canvas.snapshot()));

  app.put(apiPaths.canvasLayout, async (c) => {
    const parsed = layoutUpdateRequest.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.text(`Invalid layout update: ${z.prettifyError(parsed.error)}`, 400);
    try {
      return c.json({ layouts: deps.canvas.updateLayout(parsed.data.updates) });
    } catch (error) {
      if (error instanceof UnknownNodeError) return c.text(error.message, 404);
      throw error;
    }
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
