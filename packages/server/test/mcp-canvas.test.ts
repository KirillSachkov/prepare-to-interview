import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { apiPaths, type CanvasSnapshot, type ServerEvent } from "@prepare-to-interview/shared";
import type { RunningServer } from "../src/server.ts";
import { authHeaders, makeTempDirs, practiceSets, quizArgs, startTestServer } from "./helpers.ts";

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

describe("MCP tools to live Canvas", () => {
  it("lists the tools with strict input and output schemas", async () => {
    const client = await connectMcp(await start());
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "place_practice_set");
    expect(tool?.inputSchema).toMatchObject({
      type: "object",
      required: ["title", "cards"],
      additionalProperties: false,
    });
    expect(tool?.outputSchema).toMatchObject({ type: "object", additionalProperties: false });
  });

  it("places a Practice set that appears live on the Canvas and in the Canvas snapshot", async () => {
    const server = await start();
    const events = openEvents(server);
    await events.opened;
    const client = await connectMcp(server);

    const result = await client.callTool({ name: "place_practice_set", arguments: quizArgs("Indexes") });

    expect(result.isError).toBeFalsy();
    const setId = (result.structuredContent as { practice_set_id: string }).practice_set_id;
    expect((result.content as { text: string }[])[0]?.text).toMatch(
      new RegExp(`^Placed a Quiz with 1 Cards on the Canvas \\(${setId}\\)\\.`),
    );
    const event = await events.next();
    expect(event).toMatchObject({
      type: "canvas.node_added",
      node: { id: setId, kind: "practice_set", position: { x: 0, y: 0 }, collapsed: false, data: { title: "Indexes", kind: "quiz" } },
    });
    expect(practiceSets(await canvas(server))).toEqual([(event as { node: unknown }).node]);
  });

  it("keeps placed Practice sets and their layout after a restart", async () => {
    const dirs = makeTempDirs();
    cleanups.push(dirs.cleanup);
    const first = await start(dirs);
    const client = await connectMcp(first);
    await client.callTool({ name: "place_practice_set", arguments: quizArgs("One") });
    await client.close();
    await first.close();

    const second = await start(dirs);
    expect(practiceSets(await canvas(second)).map((n) => [n.data.title, n.position])).toEqual([["One", { x: 0, y: 0 }]]);
  });

  it.each([
    ["a missing title", { cards: (quizArgs("x").cards as unknown[]) }, "title"],
    ["no cards", { title: "Empty", cards: [] }, "cards"],
    ["an unknown field", { ...quizArgs("x"), score: 3 }, "score"],
    ["a wrong type", { ...quizArgs("x"), kind: 42 }, "kind"],
  ])("rejects %s with isError and a fix hint, placing nothing", async (_case, args, field) => {
    const server = await start();
    const client = await connectMcp(server);
    const result = await client.callTool({ name: "place_practice_set", arguments: args });
    expect(result.isError).toBe(true);
    const text = (result.content as { text: string }[])[0]?.text ?? "";
    expect(text).toContain("Invalid input for place_practice_set");
    expect(text).toContain(field);
    expect(text).toMatch(/\nFix: Pass \{"title"/);
    expect(practiceSets(await canvas(server))).toEqual([]);
  });

  it("answers an unknown tool with isError listing the available tools", async () => {
    const client = await connectMcp(await start());
    const result = await client.callTool({ name: "record_attempt", arguments: {} });
    expect(result.isError).toBe(true);
    expect((result.content as { text: string }[])[0]?.text).toMatch(
      /^Unknown tool "record_attempt"\.\nFix: Call one of: get_profile, .*place_practice_set.*end_session, correct_grade.*\.$/,
    );
  });

  it("opens the live channel for the browser cookie from its own origin", async () => {
    const server = await start();
    const login = await fetch(server.url, { redirect: "manual" });
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const events = openEvents(server, { Cookie: cookie, Origin: `http://127.0.0.1:${server.port}` });
    await events.opened;
    const client = await connectMcp(server);
    await client.callTool({ name: "place_practice_set", arguments: quizArgs("Via cookie") });
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

describe("Focusing the Canvas", () => {
  it("brings a Card, a Practice set, or a Topic into view for the Candidate", async () => {
    const server = await start();
    const client = await connectMcp(server);
    const call = async (args: Record<string, unknown>) => {
      const result = await client.callTool({ name: "focus_canvas", arguments: args });
      return { isError: result.isError === true, text: (result.content as { text: string }[])[0]?.text ?? "" };
    };
    const placed = (await client.callTool({ name: "place_practice_set", arguments: quizArgs("Indexes") })).structuredContent as {
      practice_set_id: string;
      cards: { card_id: string }[];
    };
    const events = openEvents(server);
    await events.opened;
    const cardId = placed.cards[0]!.card_id;

    expect((await call({ card_id: cardId })).isError).toBe(false);
    expect(await events.next()).toEqual({ type: "canvas.focus", focus: { kind: "practice_set", setId: placed.practice_set_id, cardId } });
    expect((await call({ practice_set_id: placed.practice_set_id })).isError).toBe(false);
    expect(await events.next()).toEqual({ type: "canvas.focus", focus: { kind: "practice_set", setId: placed.practice_set_id, cardId: null } });
    expect((await call({ topic: "sql" })).isError).toBe(false);
    expect(await events.next()).toMatchObject({ type: "canvas.focus", focus: { kind: "topic", topicId: expect.any(String) as string, name: "SQL" } });

    expect((await call({})).text).toMatch(/^Invalid input for focus_canvas/);
    expect((await call({ card_id: cardId, topic: "SQL" })).text).toMatch(/^Invalid input for focus_canvas/);
    expect((await call({ card_id: "nope" })).text).toMatch(/^No Card with id "nope"/);
    expect((await call({ topic: "Kafka" })).text).toMatch(/^The bank has no Topic "Kafka"/);
  });
});
