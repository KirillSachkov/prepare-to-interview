import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import {
  apiPaths,
  chatNodeId,
  type CanvasSnapshot,
  type LayoutUpdateRequest,
  type ServerEvent,
} from "@prepare-to-interview/shared";
import type { RunningServer } from "../src/server.ts";
import { authHeaders, makeTempDirs, quizArgs, startTestServer } from "./helpers.ts";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function start(dirs = makeTempDirs()) {
  const { server } = await startTestServer(dirs);
  cleanups.push(() => server.close());
  return server;
}

async function canvas(server: RunningServer): Promise<CanvasSnapshot> {
  const res = await fetch(new URL(apiPaths.canvas, server.url), { headers: authHeaders(server) });
  return (await res.json()) as CanvasSnapshot;
}

function putLayout(server: RunningServer, body: unknown, headers = authHeaders(server)) {
  return fetch(new URL(apiPaths.canvasLayout, server.url), {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function placeSet(server: RunningServer, title: string): Promise<string> {
  const client = new Client({ name: "test-agent", version: "0.0.0" });
  const headers = Object.fromEntries(server.mcpServer.headers.map((h) => [h.name, h.value]));
  await client.connect(new StreamableHTTPClientTransport(new URL(server.mcpServer.url), { requestInit: { headers } }));
  const result = await client.callTool({ name: "place_practice_set", arguments: quizArgs(title) });
  await client.close();
  return (result.structuredContent as { practice_set_id: string }).practice_set_id;
}

function nodeLayout(snapshot: CanvasSnapshot, id: string) {
  const node = snapshot.nodes.find((n) => n.id === id);
  return node && { position: node.position, collapsed: node.collapsed };
}

describe("Canvas layout store", () => {
  it("always shows the Chat node, expanded, left of the first grid cell", async () => {
    const server = await start();
    expect(await canvas(server)).toEqual({
      nodes: [{ id: chatNodeId, kind: "chat", position: { x: -460, y: 0 }, collapsed: false, data: {} }],
    });
  });

  it("keeps moved and collapsed nodes after a restart", async () => {
    const dirs = makeTempDirs();
    cleanups.push(dirs.cleanup);
    const first = await start(dirs);
    const noteId = await placeSet(first, "Indexes");

    const request: LayoutUpdateRequest = {
      updates: [
        { nodeId: noteId, position: { x: 512.5, y: -40 } },
        { nodeId: chatNodeId, position: { x: -800, y: 120 }, collapsed: true },
      ],
    };
    const res = await putLayout(first, request);
    expect(res.status).toBe(200);
    await first.close();

    const second = await start(dirs);
    const snapshot = await canvas(second);
    expect(nodeLayout(snapshot, noteId)).toEqual({ position: { x: 512.5, y: -40 }, collapsed: false });
    expect(nodeLayout(snapshot, chatNodeId)).toEqual({ position: { x: -800, y: 120 }, collapsed: true });
  });

  it("changes only the fields an update names", async () => {
    const server = await start();
    await putLayout(server, { updates: [{ nodeId: chatNodeId, position: { x: 10, y: 20 } }] });
    await putLayout(server, { updates: [{ nodeId: chatNodeId, collapsed: true }] });
    expect(nodeLayout(await canvas(server), chatNodeId)).toEqual({ position: { x: 10, y: 20 }, collapsed: true });
  });

  it("tells live clients where nodes moved", async () => {
    const server = await start();
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}${apiPaths.events}`, { headers: authHeaders(server) });
    cleanups.push(() => ws.close());
    await new Promise((resolve) => ws.once("open", resolve));
    const event = new Promise<ServerEvent>((resolve) => {
      ws.once("message", (data: Buffer) => resolve(JSON.parse(data.toString()) as ServerEvent));
    });

    await putLayout(server, { updates: [{ nodeId: chatNodeId, position: { x: 1, y: 2 } }] });

    expect(await event).toEqual({
      type: "canvas.layout_changed",
      layouts: [{ nodeId: chatNodeId, position: { x: 1, y: 2 }, collapsed: false }],
    });
  });

  it("rejects the whole batch when a node is unknown", async () => {
    const server = await start();
    const res = await putLayout(server, {
      updates: [
        { nodeId: chatNodeId, position: { x: 99, y: 99 } },
        { nodeId: "no-such-node", position: { x: 1, y: 1 } },
      ],
    });
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("no-such-node");
    expect(nodeLayout(await canvas(server), chatNodeId)).toEqual({ position: { x: -460, y: 0 }, collapsed: false });
  });

  it.each([
    ["an unknown field", { updates: [{ nodeId: chatNodeId, width: 3 }] }],
    ["a non-numeric coordinate", { updates: [{ nodeId: chatNodeId, position: { x: "1", y: 2 } }] }],
    ["a missing updates list", {}],
  ])("rejects %s with 400", async (_case, body) => {
    const server = await start();
    expect((await putLayout(server, body)).status).toBe(400);
  });

  it("requires the token", async () => {
    const server = await start();
    expect((await putLayout(server, { updates: [] }, {})).status).toBe(401);
  });
});
