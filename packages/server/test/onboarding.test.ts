import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import {
  apiPaths,
  skillUri,
  type ChatSnapshot,
  type ServerEvent,
  type TargetsResponse,
  type TopicsResponse,
} from "@prepare-to-interview/shared";
import type { AgentDriver, TurnInput } from "../src/agent/driver.ts";
import { FakeDriver, type FakeStep, type FakeTurn } from "../src/agent/fake-driver.ts";
import type { HiddenState } from "../src/interviewer/interviewer.ts";
import type { RunningServer } from "../src/server.ts";
import { authHeaders, makeTempDirs, startTestServer } from "./helpers.ts";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** Local noon on 2026-10-22, so day counts do not depend on the machine's time zone. */
const today = new Date(2026, 9, 22, 12, 0, 0);

interface Harness {
  server: RunningServer;
  driver: () => FakeDriver;
}

async function start(turns: FakeTurn[] = [], dirs = makeTempDirs()): Promise<Harness> {
  let driver: FakeDriver | undefined;
  const { server } = await startTestServer(dirs, {
    now: () => today,
    drivers: (): AgentDriver => (driver ??= new FakeDriver(turns)),
    detectAgents: () => [{ id: "claude", label: "Claude Code", installed: true, detail: "/bin/claude" }],
  });
  cleanups.push(() => server.close());
  cleanups.push(dirs.cleanup);
  await api(server, apiPaths.agentSettings, { method: "PUT", body: { agent: "claude" } });
  return { server, driver: () => driver! };
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

async function connectMcp(server: RunningServer) {
  const client = new Client({ name: "test-agent", version: "0.0.0" });
  const headers = Object.fromEntries(server.mcpServer.headers.map((h) => [h.name, h.value]));
  await client.connect(new StreamableHTTPClientTransport(new URL(server.mcpServer.url), { requestInit: { headers } }));
  cleanups.push(() => client.close());
  return {
    call: async (name: string, args: Record<string, unknown> = {}) => {
      const result = await client.callTool({ name, arguments: args });
      return {
        isError: result.isError === true,
        text: (result.content as { text: string }[])[0]?.text ?? "",
        data: result.structuredContent as Record<string, unknown> & { target_id?: string },
      };
    },
  };
}

async function say(server: RunningServer, text: string): Promise<ChatSnapshot> {
  const sent = await api(server, apiPaths.chatMessages, { method: "POST", body: { text } });
  expect(sent.status).toBe(202);
  return settled(server);
}

async function settled(server: RunningServer): Promise<ChatSnapshot> {
  await expect.poll(async () => ((await api(server, apiPaths.chat)).body as ChatSnapshot).busy).toBe(false);
  return ((await api(server, apiPaths.chat)).body as ChatSnapshot);
}

const tool = (name: string, args: Record<string, unknown>): FakeStep => ({
  callTool: { server: "interview", tool: name, arguments: args },
});
const reply = (text: string): FakeStep => ({ event: { type: "message_chunk", text } });
const state = (prompt: TurnInput | undefined) => prompt?.hiddenState as HiddenState;
const targets = async (server: RunningServer) => ((await api(server, apiPaths.targets)).body as TargetsResponse);

const backendTarget = {
  role: "Backend developer (Go)",
  name: "Go backend",
  grade: "Middle",
  market: "ru",
  language: "ru",
  interview_date: "2026-11-05",
  mission: { why: "Move to a product company", success: "An offer at Middle+", constraints: "1 hour a day", out_of_scope: "Frontend" },
  vacancies: [{ title: "Go developer", url: "https://hh.ru/vacancy/1" }],
  topics: [
    { name: "Go concurrency", priority: "high", group: "Go" },
    { name: "SQL", priority: "medium" },
  ],
};

describe("onboarding Activity", () => {
  it("starts for a new Candidate with its skill and ends with a profile, a target, and a decision made through MCP", async () => {
    const { server, driver } = await start([
      [reply("Привет! Расскажите о своём опыте.")],
      [
        tool("save_profile", {
          experience: "3 years of Go backend",
          stack: ["Go", "PostgreSQL"],
          weak_spots: ["System design"],
          calibration: [{ topic: "Go concurrency", level: 2, note: "Knows channels, unsure about select" }],
        }),
        tool("save_target", backendTarget),
        tool("record_decision", { decision: "Leave frontend out of scope", reason: "Backend-only vacancies" }),
        tool("finish_activity", { status: "completed", summary: "Go backend Middle target with five topics agreed." }),
        reply("Готово."),
      ],
      [reply("Чем займёмся?")],
    ]);

    await say(server, "Привет");
    const first = driver().prompts[0]!;
    expect(state(first)).toMatchObject({ language: "ru", activity: { kind: "onboarding" }, active_target: null, has_profile: false });
    expect(first.context).toEqual([{ uri: skillUri("onboarding"), text: expect.stringContaining("# Onboarding") as string }]);
    expect(first.context?.[0]?.text).toMatch(/^<activity_skill name="onboarding">\n[\s\S]*\n<\/activity_skill>$/);

    const done = await say(server, "3 года на Go, хочу Middle backend, собеседование 5 ноября");
    expect(done.messages.at(-1)?.toolCalls.map((c) => [c.tool, c.status])).toEqual([
      ["save_profile", "completed"],
      ["save_target", "completed"],
      ["record_decision", "completed"],
      ["finish_activity", "completed"],
    ]);
    // The skill went out once in this Agent session.
    expect(driver().prompts[1]?.context).toBeUndefined();

    const list = await targets(server);
    expect(list.targets).toEqual([
      {
        id: list.activeId,
        name: "Go backend",
        role: "Backend developer (Go)",
        grade: "Middle",
        interviewDate: "2026-11-05",
        daysLeft: 14,
        readiness: null,
        due: null,
      },
    ]);

    const mcp = await connectMcp(server);
    const overview = (await mcp.call("get_profile")).data;
    expect(overview).toMatchObject({
      profile: {
        experience: "3 years of Go backend",
        stack: ["Go", "PostgreSQL"],
        weak_spots: ["System design"],
        calibration: [{ topic: "Go concurrency", level: 2, note: "Knows channels, unsure about select" }],
      },
      active_target: {
        name: "Go backend",
        days_left: 14,
        mission: { why: "Move to a product company", out_of_scope: "Frontend" },
        vacancies: [{ title: "Go developer", url: "https://hh.ru/vacancy/1", text: null }],
        topics: [
          { name: "Go concurrency", priority: "high", group: "Go" },
          { name: "SQL", priority: "medium", group: null },
        ],
      },
      recent_decisions: [{ decision: "Leave frontend out of scope", reason: "Backend-only vacancies", target_id: list.activeId }],
      activity: null,
    });

    // After onboarding the Interviewer works on the target, outside any Activity.
    await say(server, "Что дальше?");
    expect(state(driver().prompts[2])).toMatchObject({
      activity: null,
      active_target: { id: list.activeId, name: "Go backend", days_left: 14 },
      has_profile: true,
    });
    expect(driver().prompts[2]?.context).toBeUndefined();
  });

  it("can be skipped without a target and does not restart by itself", async () => {
    const { server, driver } = await start([
      [tool("finish_activity", { status: "skipped", summary: "The Candidate wants to paste own questions first." })],
      [tool("add_question", { topic: "Kafka", prompt: "How does Kafka keep message order?" })],
    ]);

    await say(server, "Пропустим, хочу сразу свои вопросы");
    await say(server, "Вопрос: как Kafka сохраняет порядок сообщений?");

    expect(state(driver().prompts[1])).toMatchObject({ activity: null, active_target: null });
    expect((await targets(server)).targets).toEqual([]);
    expect(((await api(server, apiPaths.topics)).body as TopicsResponse).topics).toEqual(["Kafka"]);
  });

  it("refuses to complete before a Preparation target exists, with a fix hint", async () => {
    const { server } = await start([[reply("Hi")]]);
    await say(server, "Привет");
    const mcp = await connectMcp(server);

    const early = await mcp.call("finish_activity", { status: "completed", summary: "Done." });
    expect(early.isError).toBe(true);
    expect(early.text).toBe(
      'Onboarding cannot complete before a Preparation target is saved.\nFix: Call save_target with at least "role" first, or finish with "status": "skipped" if the Candidate skips onboarding.',
    );
    expect((await mcp.call("get_profile")).data).toMatchObject({ activity: { kind: "onboarding" } });

    await mcp.call("save_target", { role: "QA engineer" });
    expect((await mcp.call("finish_activity", { status: "completed", summary: "QA target." })).isError).toBe(false);
  });

  it("starts again for a new target from «Новая цель», keeping the existing targets", async () => {
    const { server, driver } = await start([[reply("Какую позицию добавим?")]]);
    const mcp = await connectMcp(server);
    await mcp.call("save_target", { role: "Backend developer" });

    const res = await api(server, apiPaths.newTarget, { method: "POST" });
    expect(res.status).toBe(202);
    const chat = await settled(server);

    expect(chat.messages.map((m) => [m.role, m.text])).toEqual([
      ["candidate", "Хочу добавить новую цель подготовки."],
      ["interviewer", "Какую позицию добавим?"],
    ]);
    const prompt = driver().prompts[0]!;
    expect(state(prompt)).toMatchObject({ activity: { kind: "onboarding" }, active_target: { name: "Backend developer" } });
    expect(prompt.context?.[0]?.uri).toBe(skillUri("onboarding"));
  });

  it("returns the skill from start_activity and does not send it again in the same Agent session", async () => {
    const { server, driver } = await start([
      [tool("finish_activity", { status: "skipped", summary: "Skipped." })],
      [tool("start_activity", { kind: "onboarding" })],
      [reply("Продолжим.")],
    ]);
    await say(server, "Пропустить");
    await say(server, "Давай всё-таки заведём цель");
    await say(server, "Senior QA");

    expect(state(driver().prompts[2])).toMatchObject({ activity: { kind: "onboarding" } });
    expect(driver().prompts[2]?.context).toBeUndefined();

    const mcp = await connectMcp(server);
    const again = await mcp.call("start_activity", { kind: "onboarding" });
    expect(again.data).toMatchObject({ kind: "onboarding", started: false });
    expect(again.text).toMatch(/^Continuing the onboarding Activity\. Follow this skill:\n\n<activity_skill name="onboarding">/);
  });
});

describe("Preparation target tools", () => {
  it.each([
    ["an unknown field", { role: "QA", salary: 300 }, "salary", 'To create: {"role"'],
    ["a wrong enum value", { role: "QA", market: "us" }, "market", 'To create: {"role"'],
    ["a malformed date", { role: "QA", interview_date: "5 November" }, "interview_date", 'To create: {"role"'],
    ["a vacancy without url or text", { role: "QA", vacancies: [{ title: "QA" }] }, "vacancies", 'To create: {"role"'],
  ])("rejects %s with isError and a fix hint, saving nothing", async (_case, args, field, hint) => {
    const { server } = await start();
    const mcp = await connectMcp(server);
    const result = await mcp.call("save_target", args);
    expect(result.isError).toBe(true);
    expect(result.text).toContain("Invalid input for save_target");
    expect(result.text).toContain(field);
    expect(result.text).toContain(`\nFix: ${hint}`);
    expect((await targets(server)).targets).toEqual([]);
  });

  it.each([
    ["a new target without a role", { name: "Something" }, "A new Preparation target needs a role."],
    ["an interview date in the past", { role: "QA", interview_date: "2026-10-21" }, "interview_date 2026-10-21 is before today (2026-10-22)."],
    ["the same Topic twice", { role: "QA", topics: [{ name: "SQL", priority: "high" }, { name: " sql ", priority: "low" }] }, 'Topic "sql" is listed twice.'],
    ["an unknown target id", { target_id: "nope", grade: "Senior" }, 'No Preparation target with id "nope".'],
  ])("refuses %s with a domain fix hint", async (_case, args, message) => {
    const { server } = await start();
    const mcp = await connectMcp(server);
    const result = await mcp.call("save_target", args);
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(new RegExp(`^${message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\nFix: .+`));
    expect((await targets(server)).targets).toEqual([]);
  });

  it("holds several targets that share Topics by reference and keep their own priorities", async () => {
    const { server } = await start();
    const mcp = await connectMcp(server);
    const go = await mcp.call("save_target", backendTarget);
    const data = await mcp.call("save_target", {
      role: "Data engineer",
      topics: [
        { name: "sql", priority: "high" },
        { name: "Apache Spark", priority: "medium" },
      ],
    });

    expect(((await api(server, apiPaths.topics)).body as TopicsResponse).topics).toEqual([
      "Apache Spark",
      "Go",
      "Go concurrency",
      "SQL",
    ]);
    expect(data.data).toMatchObject({
      topics: [
        { name: "SQL", priority: "high" },
        { name: "Apache Spark", priority: "medium" },
      ],
    });
    // Renaming a target's priorities does not touch the other target.
    await mcp.call("save_target", { target_id: data.data.target_id, topics: [{ name: "SQL", priority: "low" }] });
    await mcp.call("save_target", { target_id: go.data.target_id, activate: true });
    expect((await mcp.call("get_profile")).data).toMatchObject({
      active_target: { name: "Go backend", topics: [{ name: "Go concurrency" }, { name: "SQL", priority: "medium" }] },
      targets: [{ name: "Go backend" }, { name: "Data engineer" }],
    });
  });

  it("switches the active target from the Control panel, live, and the Interviewer follows it", async () => {
    const { server, driver } = await start([[reply("ok")]]);
    const mcp = await connectMcp(server);
    await mcp.call("save_target", backendTarget);
    const english = await mcp.call("save_target", { role: "ML engineer", language: "en", interview_date: null });
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}${apiPaths.events}`, { headers: authHeaders(server) });
    cleanups.push(() => ws.close());
    const events: ServerEvent[] = [];
    ws.on("message", (raw: Buffer) => events.push(JSON.parse(raw.toString()) as ServerEvent));
    await new Promise((resolve) => ws.once("open", resolve));

    const go = (await targets(server)).targets[0]!;
    const switched = await api(server, apiPaths.activeTarget, { method: "PUT", body: { targetId: go.id } });
    expect(switched).toMatchObject({ status: 200, body: { activeId: go.id } });
    await expect.poll(() => events.find((e) => e.type === "targets.changed")).toEqual({ type: "targets.changed", targets: switched.body });

    await api(server, apiPaths.activeTarget, { method: "PUT", body: { targetId: english.data.target_id } });
    await mcp.call("finish_activity", { status: "skipped", summary: "n/a" }).catch(() => undefined);
    await say(server, "Hi");
    expect(state(driver().prompts[0])).toMatchObject({
      language: "en",
      active_target: { id: english.data.target_id, name: "ML engineer", days_left: null },
    });

    expect((await api(server, apiPaths.activeTarget, { method: "PUT", body: { targetId: "missing" } })).status).toBe(404);
    expect((await targets(server)).activeId).toBe(english.data.target_id);
  });

  it("keeps targets and the active one after a restart", async () => {
    const dirs = makeTempDirs();
    const first = await start([], dirs);
    await (await connectMcp(first.server)).call("save_target", backendTarget);
    const before = await targets(first.server);
    await first.server.close();

    const { server } = await startTestServer(dirs, { now: () => today });
    cleanups.push(() => server.close());
    expect(await targets(server)).toEqual(before);
  });
});

describe("Decision log", () => {
  it("records decisions for the active target by default, for another target, or for the Candidate overall", async () => {
    const { server } = await start();
    const mcp = await connectMcp(server);
    const other = await mcp.call("save_target", { role: "QA engineer" });
    const active = await mcp.call("save_target", { role: "Backend developer" });

    await mcp.call("record_decision", { decision: "Focus on SQL first" });
    await mcp.call("record_decision", { decision: "Drop Selenium", target_id: other.data.target_id });
    await mcp.call("record_decision", { decision: "Practise in Russian", target_id: null });
    const missing = await mcp.call("record_decision", { decision: "x", target_id: "missing" });

    expect(missing.isError).toBe(true);
    expect(missing.text).toMatch(/^No Preparation target with id "missing"\.\nFix: Use one of: .*QA engineer.*Backend developer/);
    expect((await mcp.call("get_profile")).data.recent_decisions).toEqual([
      { decision: "Practise in Russian", reason: null, target_id: null },
      { decision: "Drop Selenium", reason: null, target_id: other.data.target_id },
      { decision: "Focus on SQL first", reason: null, target_id: active.data.target_id },
    ]);
  });
});

describe("the Candidate's own Question", () => {
  it("enters the shared bank from the Chat through add_question, under an existing Topic", async () => {
    const { server } = await start();
    const mcp = await connectMcp(server);
    await mcp.call("save_target", backendTarget);

    const added = await mcp.call("add_question", { topic: "sql", prompt: "Чем отличается WHERE от HAVING?" });
    expect(added).toMatchObject({ isError: false, data: { topic: "SQL", status: "active" } });
    expect(added.text).toBe(`Added the Question to the bank under Topic "SQL" (${String(added.data.question_id)}).`);

    const duplicate = await mcp.call("add_question", { topic: "SQL", prompt: "  чем отличается where от having? " });
    expect(duplicate.isError).toBe(true);
    expect(duplicate.text).toContain("Fix: Do not add it again");
  });

  it.each([
    ["a test without options", { type: "single_choice" }, "A single_choice Question needs at least two options and exactly one correct."],
    [
      "a single choice with two correct options",
      { type: "single_choice", options: [{ text: "a", correct: true }, { text: "b", correct: true }] },
      "A single_choice Question needs at least two options and exactly one correct.",
    ],
    ["an open Question with options", { options: [{ text: "a", correct: true }] }, "An open Question has no options."],
  ])("refuses %s with a fix hint", async (_case, args, message) => {
    const { server } = await start();
    const mcp = await connectMcp(server);
    const result = await mcp.call("add_question", { topic: "SQL", prompt: "Q?", ...args });
    expect(result.isError).toBe(true);
    expect(result.text.split("\nFix: ")[0]).toBe(message);
    expect(((await api(server, apiPaths.topics)).body as TopicsResponse).topics).toEqual([]);
  });

  it("enters the bank from the Canvas context menu dialog", async () => {
    const { server } = await start();
    const res = await api(server, apiPaths.questions, { method: "POST", body: { topic: "Kafka", prompt: "Что такое consumer group?" } });
    expect(res).toMatchObject({ status: 201, body: { topic: "Kafka" } });
    expect(((await api(server, apiPaths.topics)).body as TopicsResponse).topics).toEqual(["Kafka"]);

    const again = await api(server, apiPaths.questions, {
      method: "POST",
      body: { topic: "kafka", prompt: "Что такое consumer group?" },
    });
    expect(again.status).toBe(400);
    expect((await api(server, apiPaths.questions, { method: "POST", body: { topic: "", prompt: "x" } })).status).toBe(400);
  });
});
