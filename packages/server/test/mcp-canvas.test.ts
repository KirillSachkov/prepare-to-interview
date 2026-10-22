import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { apiPaths, type CanvasSnapshot, type ServerEvent } from "@prepare-to-interview/shared";
import type { RunningServer } from "../src/server.ts";
import { authHeaders, makeTempDirs, startTestServer } from "./helpers.ts";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function start(dirs = makeTempDirs()) {
  const { server } = await startTestServer(dirs);
  cleanups.push(() => server.close());
  return server;
}

async function connectMcp(server: RunningServer) {
  const client = new Client({ name: "test-agent", version: "0.0.0" });
  const headers = Object.fromEntries(server.mcpServer.headers.map((h) => [h.name, h.value]));
  await client.connect(new StreamableHTTPClientTransport(new URL(server.mcpServer.url), { requestInit: { headers } }));
  cleanups.push(() => client.close());
  return client;
}

async function canvas(server: RunningServer): Promise<CanvasSnapshot> {
  const res = await fetch(new URL(apiPaths.canvas, server.url), { headers: authHeaders(server) });
  return (await res.json()) as CanvasSnapshot;
}

function openEvents(server: RunningServer, headers: Record<string, string> = authHeaders(server)) {
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}${apiPaths.events}`, { headers });
  cleanups.push(() => ws.close());
  const received: ServerEvent[] = [];
  ws.on("message", (data: Buffer) => received.push(JSON.parse(data.toString()) as ServerEvent));
  const opened = new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
    ws.once("unexpected-response", (_req, res) => reject(new Error(`upgrade rejected: ${res.statusCode}`)));
  });
  const next = () =>
    new Promise<ServerEvent>((resolve) => {
      if (received.length) {
        resolve(received.shift()!);
        return;
      }
      ws.once("message", () => resolve(received.shift()!));
    });
  return { opened, next };
}

describe("demo MCP tool to live Canvas", () => {
  it("lists the tool with strict input and output schemas", async () => {
    const client = await connectMcp(await start());
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "demo_place_note");
    expect(tool?.inputSchema).toMatchObject({
      type: "object",
      required: ["title"],
      additionalProperties: false,
    });
    expect(tool?.outputSchema).toMatchObject({ type: "object", additionalProperties: false });
  });

  it("places a note that appears live on the Canvas and in the Canvas snapshot", async () => {
    const server = await start();
    const events = openEvents(server);
    await events.opened;
    const client = await connectMcp(server);

    const result = await client.callTool({
      name: "demo_place_note",
      arguments: { title: "PostgreSQL indexes", body: "B-tree by default" },
    });

    expect(result.isError).toBeFalsy();
    const nodeId = (result.structuredContent as { node_id: string }).node_id;
    expect(result.content).toEqual([
      { type: "text", text: `Placed note "PostgreSQL indexes" on the Canvas (node ${nodeId}).` },
    ]);
    const expectedNode = {
      id: nodeId,
      kind: "demo_note",
      position: { x: 0, y: 0 },
      data: { title: "PostgreSQL indexes", body: "B-tree by default" },
    };
    expect(await events.next()).toEqual({ type: "canvas.node_added", node: expectedNode });
    expect(await canvas(server)).toEqual({ nodes: [expectedNode] });
  });

  it("keeps placed notes after a restart", async () => {
    const dirs = makeTempDirs();
    cleanups.push(dirs.cleanup);
    const first = await start(dirs);
    const client = await connectMcp(first);
    await client.callTool({ name: "demo_place_note", arguments: { title: "One" } });
    await client.callTool({ name: "demo_place_note", arguments: { title: "Two" } });
    await client.close();
    await first.close();

    const second = await start(dirs);
    const { nodes } = await canvas(second);
    expect(nodes.map((n) => [n.data.title, n.data.body, n.position])).toEqual([
      ["One", "", { x: 0, y: 0 }],
      ["Two", "", { x: 280, y: 0 }],
    ]);
  });

  it.each([
    ["a missing title", {}, "title"],
    ["a blank title", { title: "   " }, "title"],
    ["an unknown field", { title: "ok", score: 3 }, "score"],
    ["a wrong type", { title: "ok", body: 42 }, "body"],
  ])("rejects %s with isError and a fix hint, placing nothing", async (_case, args, field) => {
    const server = await start();
    const client = await connectMcp(server);
    const result = await client.callTool({ name: "demo_place_note", arguments: args });
    expect(result.isError).toBe(true);
    const text = (result.content as { text: string }[])[0]?.text ?? "";
    expect(text).toContain("Invalid input for demo_place_note");
    expect(text).toContain(field);
    expect(text).toMatch(/\nFix: Pass \{"title"/);
    expect(await canvas(server)).toEqual({ nodes: [] });
  });

  it("answers an unknown tool with isError listing the available tools", async () => {
    const client = await connectMcp(await start());
    const result = await client.callTool({ name: "record_attempt", arguments: {} });
    expect(result.isError).toBe(true);
    expect((result.content as { text: string }[])[0]?.text).toBe(
      'Unknown tool "record_attempt".\nFix: Call one of: demo_place_note.',
    );
  });

  it("opens the live channel for the browser cookie from its own origin", async () => {
    const server = await start();
    const login = await fetch(server.url, { redirect: "manual" });
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const events = openEvents(server, { Cookie: cookie, Origin: `http://127.0.0.1:${server.port}` });
    await events.opened;
    const client = await connectMcp(server);
    await client.callTool({ name: "demo_place_note", arguments: { title: "Via cookie" } });
    expect(await events.next()).toMatchObject({ type: "canvas.node_added", node: { data: { title: "Via cookie" } } });
  });

  it.each([
    ["without the token", {}, 401],
    ["from a foreign origin", { Origin: "http://evil.example" }, 403],
  ])("refuses the live channel %s", async (_case, extra: Record<string, string>, expected) => {
    const server = await start();
    const headers = expected === 403 ? { ...authHeaders(server), ...extra } : extra;
    await expect(openEvents(server, headers).opened).rejects.toThrow(`upgrade rejected: ${expected}`);
  });
});
