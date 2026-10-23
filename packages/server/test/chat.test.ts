import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import {
  apiPaths,
  agentPaths,
  type AgentAvailability,
  type AgentsResponse,
  type ChatSnapshot,
  type ServerEvent,
} from "@prepare-to-interview/shared";
import type { AgentDriver } from "../src/agent/driver.ts";
import { AgentError } from "../src/agent/errors.ts";
import { FakeDriver, type FakeTurn } from "../src/agent/fake-driver.ts";
import { defaultContentDir } from "../src/interviewer/interviewer.ts";
import type { RunningServer } from "../src/server.ts";
import { authHeaders, makeTempDirs, startTestServer } from "./helpers.ts";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const allInstalled: AgentAvailability[] = [
  { id: "claude", label: "Claude Code", installed: true, detail: "/bin/claude" },
  { id: "codex", label: "Codex", installed: true, detail: "/bin/codex" },
  { id: "opencode", label: "OpenCode", installed: false, detail: "Not found." },
];

interface Harness {
  server: RunningServer;
  drivers: Map<string, FakeDriver>;
  dirs: ReturnType<typeof makeTempDirs>;
}

/** Starts the app with fake drivers; `turns` scripts the agent each test talks to. */
async function start(
  turns: Partial<Record<string, FakeTurn[]>> = {},
  dirs = makeTempDirs(),
  configure?: (driver: FakeDriver) => void,
): Promise<Harness> {
  const drivers = new Map<string, FakeDriver>();
  const { server } = await startTestServer(dirs, {
    drivers: (agent): AgentDriver => {
      const driver = new FakeDriver(turns[agent] ?? []);
      configure?.(driver);
      drivers.set(agent, driver);
      return driver;
    },
    detectAgents: () => allInstalled,
  });
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await server.close();
  };
  cleanups.push(close);
  return { server, drivers, dirs };
}

async function api(
  server: RunningServer,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(new URL(path, server.url), {
    method: init.method ?? "GET",
    headers: { ...authHeaders(server), "Content-Type": "application/json" },
    ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as unknown) : undefined };
}

const chooseAgent = (server: RunningServer, agent: string, model?: string | null) =>
  api(server, apiPaths.agentSettings, { method: "PUT", body: { agent, ...(model !== undefined && { model }) } });
const send = (server: RunningServer, text: string) =>
  api(server, apiPaths.chatMessages, { method: "POST", body: { text } });
const chat = async (server: RunningServer) => (await api(server, apiPaths.chat)).body as ChatSnapshot;

async function settled(server: RunningServer): Promise<ChatSnapshot> {
  await expect.poll(async () => (await chat(server)).busy).toBe(false);
  return chat(server);
}

function openEvents(server: RunningServer) {
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}${apiPaths.events}`, { headers: authHeaders(server) });
  cleanups.push(() => ws.close());
  const received: ServerEvent[] = [];
  ws.on("message", (data: Buffer) => received.push(JSON.parse(data.toString()) as ServerEvent));
  const opened = new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  return { opened, received };
}

const say = (text: string) => ({ event: { type: "message_chunk" as const, text } });

it("lists an installed agent's available models without starting a Chat Activity", async () => {
  const { server, drivers } = await start({}, undefined, (driver) => {
    driver.models = { models: [{ id: "fast", label: "Fast model" }], defaultModel: "fast" };
  });
  expect(await api(server, agentPaths.models("claude"))).toEqual({
    status: 200,
    body: { models: [{ id: "fast", label: "Fast model" }], defaultModel: "fast" },
  });
  expect(drivers.get("claude")?.sessions).toEqual([]);
  expect((await api(server, agentPaths.models("opencode"))).status).toBe(400);
});

describe("Chat with the Interviewer", () => {
  it("streams the reply live, passes hidden state with every turn, and stores the conversation", async () => {
    const { server, drivers } = await start({
      claude: [[say("Hello, I am "), say("Interviewer.")], [say("Second.")]],
    });
    const live = openEvents(server);
    await live.opened;
    await chooseAgent(server, "claude");

    const sent = await send(server, "Who are you?");
    expect(sent.status).toBe(202);
    const snapshot = await settled(server);
    await send(server, "And now?");
    const after = await settled(server);

    expect(snapshot.messages.map((m) => [m.role, m.text, m.status])).toEqual([
      ["candidate", "Who are you?", "complete"],
      ["interviewer", "Hello, I am Interviewer.", "complete"],
    ]);
    expect(after.messages.map((m) => m.text)).toEqual(["Who are you?", "Hello, I am Interviewer.", "And now?", "Second."]);

    const reply = snapshot.messages[1]!;
    const deltas = live.received.filter((e) => e.type === "chat.delta" && e.messageId === reply.id);
    expect(deltas.map((e) => (e.type === "chat.delta" ? e.text : ""))).toEqual(["Hello, I am ", "Interviewer."]);
    expect(live.received.flatMap((e) => (e.type === "chat.busy" ? [e.busy] : []))).toEqual([
      true,
      false,
      true,
      false,
    ]);

    const driver = drivers.get("claude")!;
    expect(driver.prompts.map((p) => p.text)).toEqual(["Who are you?", "And now?"]);
    for (const prompt of driver.prompts) {
      expect(prompt.hiddenState).toMatchObject({ app: "prepare-to-interview", language: "ru" });
      expect((prompt.hiddenState as { now: string }).now).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
    // One Agent session serves both turns; it carries the persona, web tools, and the app's MCP server.
    expect(driver.sessions).toHaveLength(1);
    expect(driver.sessions[0]!.config.persona).toBe(fs.readFileSync(path.join(defaultContentDir, "persona.md"), "utf8"));
    expect(driver.sessions[0]!.config).toMatchObject({
      allowedBuiltins: ["web_fetch", "web_search"],
      // The Chat's MCP server carries its own role token, never the app token (access.test.ts).
      mcpServers: [{ ...server.mcpServer, headers: [{ name: "Authorization", value: expect.not.stringContaining(server.token) as string }] }],
    });
  });

  it("records the Interviewer's app tool calls by server and tool", async () => {
    const { server } = await start({
      claude: [
        [
          say("Placing it."),
          { callTool: { server: "interview", tool: "get_progress", arguments: {} } },
        ],
      ],
    });
    await chooseAgent(server, "claude");
    await send(server, "How am I doing?");
    const { messages } = await settled(server);

    expect(messages[1]?.toolCalls).toEqual([
      expect.objectContaining({ server: "interview", tool: "get_progress", status: "completed" }),
    ]);
  });

  it("keeps text before and after a tool call as separate paragraphs, not glued words", async () => {
    const { server } = await start({
      claude: [[say("Понял."), { callTool: { server: "interview", tool: "get_progress", arguments: {} } }, say("Вопрос 2 — на "), say("холсте.")]],
    });
    await chooseAgent(server, "claude");
    await send(server, "Дальше");
    const { messages } = await settled(server);
    expect(messages[1]?.text).toBe("Понял.\n\nВопрос 2 — на холсте.");
  });

  it("keeps hidden state echoes out of the Chat, also after a restart", async () => {
    const dirs = makeTempDirs();
    cleanups.push(dirs.cleanup);
    const first = await start(
      {
        claude: [
          [
            say('app://session-state\n<context ref="app://session-state">\n<session_state>{"secret":1}</session_state>\n</context>'),
            say("Question 4."),
          ],
        ],
      },
      dirs,
    );
    await chooseAgent(first.server, "claude");
    await send(first.server, "Next question");
    const before = await settled(first.server);
    await first.server.close();

    const second = await start({}, dirs);
    const after = await chat(second.server);

    expect(before.messages[1]?.text).toBe("Question 4.");
    expect(after.messages.map((m) => m.text)).toEqual(["Next question", "Question 4."]);
    expect(JSON.stringify(after)).not.toMatch(/session_state|app:\/\//);
  });

  it("reloads the history and resumes the stored Agent session after a restart", async () => {
    const dirs = makeTempDirs();
    cleanups.push(dirs.cleanup);
    const first = await start({ claude: [[say("Noted: CockroachDB.")]] }, dirs);
    await chooseAgent(first.server, "claude", "haiku");
    await send(first.server, "My favourite database is CockroachDB.");
    await settled(first.server);
    const sessionId = first.drivers.get("claude")!.sessions[0]!.id;
    await first.server.close();

    const second = await start({ claude: [[say("CockroachDB.")]] }, dirs);
    expect((await chat(second.server)).messages).toHaveLength(2);
    await send(second.server, "What is my favourite database?");
    const { messages } = await settled(second.server);

    const driver = second.drivers.get("claude")!;
    expect(driver.sessions.map((s) => [s.action, s.id])).toEqual([["load", sessionId]]);
    expect(driver.sessions[0]!.config.model).toBe("haiku");
    expect(messages.map((m) => m.text).at(-1)).toBe("CockroachDB.");
  });

  it("stops a running reply and keeps the partial text as cancelled", async () => {
    const { server } = await start({ claude: [[say("A long answer"), { waitForCancel: true }], [say("Next.")]] });
    await chooseAgent(server, "claude");
    await send(server, "Explain everything");
    await expect.poll(async () => (await chat(server)).messages.length).toBe(2);

    expect((await send(server, "Too early")).status).toBe(409);
    const stopped = await api(server, apiPaths.chatStop, { method: "POST" });
    const { messages } = await settled(server);

    expect(stopped.status).toBe(204);
    expect(messages.map((m) => [m.role, m.text, m.status])).toEqual([
      ["candidate", "Explain everything", "complete"],
      ["interviewer", "A long answer", "cancelled"],
    ]);
    expect((await send(server, "Short, please")).status).toBe(202);
    expect((await settled(server)).messages.at(-1)?.text).toBe("Next.");
  });

  it("asks the Candidate to choose an agent first", async () => {
    const { server } = await start();
    await send(server, "Hello");
    const { messages } = await settled(server);
    expect(messages.map((m) => [m.role, m.text])).toEqual([
      ["candidate", "Hello"],
      ["notice", "Choose your coding agent in settings to start the Chat."],
    ]);
  });

  it.each([
    ["not_logged_in", "Claude Code is not logged in. To log in, run `claude` in a terminal and log in with `/login`, then send your message again."],
    ["limit_reached", "Claude Code has reached its usage limit. Wait until the limit resets, or switch to another agent in settings."],
    ["not_installed", "Claude Code is not installed."],
  ] as const)("explains a %s agent error in plain language", async (kind, text) => {
    const { server } = await start({ claude: [[{ fail: new AgentError(kind, "raw adapter message") }]] });
    await chooseAgent(server, "claude");
    await send(server, "Hello");
    const { messages } = await settled(server);
    expect(messages.at(-1)?.role).toBe("notice");
    expect(messages.at(-1)?.text).toContain(text);
    expect(messages.at(-1)?.text).not.toContain("raw adapter message");
  });

  it("starts a new Agent session when the stored one cannot be loaded", async () => {
    const dirs = makeTempDirs();
    cleanups.push(dirs.cleanup);
    const first = await start({ claude: [[say("One.")]] }, dirs);
    await chooseAgent(first.server, "claude");
    await send(first.server, "First");
    await settled(first.server);
    await first.server.close();

    // The agent no longer knows the stored session, as after its history was deleted.
    const second = await start({ claude: [[say("Fresh.")]] }, dirs, (driver) =>
      driver.sessionFailures.push(new AgentError("failed", "Session not found")),
    );
    await send(second.server, "Hello?");
    const { messages } = await settled(second.server);

    expect(messages.at(-1)?.text).toBe("Fresh.");
    expect(messages.some((m) => m.role === "notice")).toBe(false);
    expect(second.drivers.get("claude")!.sessions.map((s) => s.action)).toEqual(["start"]);
  });

  it("switches the agent: the next turn runs on the newly chosen agent", async () => {
    const { server, drivers } = await start({ claude: [[say("From Claude.")]], codex: [[say("From Codex.")]] });
    await chooseAgent(server, "claude");
    await send(server, "One");
    await settled(server);
    await chooseAgent(server, "codex");
    await send(server, "Two");
    const { messages } = await settled(server);

    expect(messages.map((m) => m.text)).toEqual(["One", "From Claude.", "Two", "From Codex."]);
    expect(drivers.get("codex")!.sessions).toHaveLength(1);
  });
});

describe("agent settings", () => {
  it("lists detected agents with the current choice and stores a new choice", async () => {
    const { server } = await start();
    const initial = await api(server, apiPaths.agents);
    expect(initial.body).toEqual({ agents: allInstalled, settings: { agent: null, models: {} } });

    const updated = await chooseAgent(server, "codex", "gpt-5.6-luna");
    expect(updated).toEqual({ status: 200, body: { agent: "codex", models: { codex: "gpt-5.6-luna" } } });
    const cleared = await chooseAgent(server, "codex", "");
    expect(cleared.body).toEqual({ agent: "codex", models: {} });
  });

  it("rejects an agent that is not installed or unknown", async () => {
    const { server } = await start();
    const missing = await chooseAgent(server, "opencode");
    const unknown = await chooseAgent(server, "gemini");
    expect(missing.status).toBe(400);
    expect(JSON.stringify(missing.body)).toContain("OpenCode is not installed");
    expect(unknown.status).toBe(400);
    expect(((await api(server, apiPaths.agents)).body as AgentsResponse).settings.agent).toBeNull();
  });
});
