// Mock interview turn flow (ticket #8) at the server seam: REST as the client calls it, MCP tools as
// the Interviewer calls them, and the fake agent driver for Chat turns and Grader sessions.
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import {
  apiPaths,
  cardPaths,
  mockPaths,
  practiceSetPaths,
  skillUri,
  type CanvasSnapshot,
  type ChatSnapshot,
  type MockRequest,
  type PracticeSetNode,
  type ProgressResponse,
} from "@prepare-to-interview/shared";
import type { AgentDriver, SessionConfig, TurnInput } from "../src/agent/driver.ts";
import { FakeDriver, type FakeStep, type FakeTurn } from "../src/agent/fake-driver.ts";
import { defaultContentDir, type HiddenState } from "../src/interviewer/interviewer.ts";
import type { RunningServer } from "../src/server.ts";
import { authHeaders, makeTempDirs, practiceSets, startTestServer } from "./helpers.ts";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const minute = 60_000;
/** Local noon, so calendar dates do not depend on the machine's time zone. */
const start22 = new Date(2026, 9, 22, 12, 0, 0);

const interviewSkill = fs.readFileSync(path.join(defaultContentDir, "skills", "interview", "SKILL.md"), "utf8").trim();
const isGrader = (config: SessionConfig) => config.persona.startsWith("# Grader");
const verdict = (score: number, quote: string, right: string, gap: string) => JSON.stringify({ score, quote, right, gap });

interface Harness {
  server: RunningServer;
  dataDir: string;
  driver: () => FakeDriver;
  graderAnswers: string[];
  /** Moves the pinned clock forward. */
  advance: (ms: number) => void;
}

/** Grader sessions give 2 of 3 and quote the answer's first sentence. */
async function start(turns: FakeTurn[] = [], dirs = makeTempDirs(), clock = { now: start22 }): Promise<Harness> {
  const graderAnswers: string[] = [];
  let driver: FakeDriver | undefined;
  const respond = (config: SessionConfig, input: TurnInput): FakeTurn | undefined => {
    if (!isGrader(config)) return undefined;
    const answer = /<answer>\n([\s\S]*?)\n<\/answer>/.exec(input.text)?.[1] ?? "";
    graderAnswers.push(answer);
    const quote = answer.split(/(?<=[.!?])\s/)[0] ?? answer;
    return [{ event: { type: "message_chunk", text: verdict(2, quote, "Ключевая идея названа.", "Нет проверки на метриках.") } }];
  };
  const { server } = await startTestServer(dirs, {
    now: () => clock.now,
    drivers: (): AgentDriver => (driver ??= new FakeDriver(turns, { respond })),
    detectAgents: () => [{ id: "claude", label: "Claude Code", installed: true, detail: "/bin/claude" }],
  });
  cleanups.push(() => server.close());
  cleanups.push(dirs.cleanup);
  await api(server, apiPaths.agentSettings, { method: "PUT", body: { agent: "claude" } });
  return {
    server,
    dataDir: dirs.dataDir,
    driver: () => driver!,
    graderAnswers,
    advance: (ms) => (clock.now = new Date(clock.now.getTime() + ms)),
  };
}

async function api(server: RunningServer, path: string, init: { method?: string; body?: unknown } = {}) {
  const res = await fetch(new URL(path, server.url), {
    method: init.method ?? "POST",
    headers: { ...authHeaders(server), "Content-Type": "application/json" },
    ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as unknown) : undefined };
}

const get = async <T>(server: RunningServer, path: string) => (await api(server, path, { method: "GET" })).body as T;

async function connectMcp(server: RunningServer) {
  const client = new Client({ name: "test-agent", version: "0.0.0" });
  const headers = Object.fromEntries(server.mcpServer.headers.map((h) => [h.name, h.value]));
  await client.connect(new StreamableHTTPClientTransport(new URL(server.mcpServer.url), { requestInit: { headers } }));
  cleanups.push(() => client.close());
  return async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    return {
      isError: result.isError === true,
      text: (result.content as { text: string }[])[0]?.text ?? "",
      data: result.structuredContent as Record<string, unknown>,
    };
  };
}

const tool = (name: string, args: Record<string, unknown>): FakeStep => ({ callTool: { server: "interview", tool: name, arguments: args } });
const reply = (text: string): FakeStep => ({ event: { type: "message_chunk", text } });

async function settledChat(server: RunningServer): Promise<ChatSnapshot> {
  await expect.poll(async () => (await get<ChatSnapshot>(server, apiPaths.chat)).busy).toBe(false);
  return get<ChatSnapshot>(server, apiPaths.chat);
}

async function mock(server: RunningServer): Promise<PracticeSetNode> {
  const all = practiceSets(await get<CanvasSnapshot>(server, apiPaths.canvas)).filter((s) => s.data.mode === "mock");
  expect(all).toHaveLength(1);
  return all[0]!;
}

/** Waits until no Card of the mock is grading. */
async function gradedMock(server: RunningServer): Promise<PracticeSetNode> {
  await expect.poll(async () => (await mock(server)).data.status).toBe("graded");
  return mock(server);
}

const target = {
  role: "AI engineer",
  name: "AI Engineer",
  topics: [
    { name: "RAG", priority: "high" },
    { name: "Evals", priority: "medium" },
  ],
};

const firstQuestion = {
  topic: "RAG",
  prompt: "Нужен ассистент по базе знаний на 50 тысяч страниц. С чего начнёте?",
  type: "open",
  reference_answer: "Уточнить требования и метрики, затем RAG: парсинг, чанкинг, эмбеддинги, гибридный поиск, реранкинг, ответ с цитатами.",
};

const followUp = (cardId: string, quote: string) => ({
  follow_up_of: cardId,
  quote,
  question: {
    topic: "RAG",
    prompt: "Вы упомянули поиск. Как поймёте, что ретривер работает достаточно хорошо?",
    type: "open",
    reference_answer: "Золотой набор вопросов, Recall@k и MRR, сравнение вариантов на нём.",
  },
});

const testQuestion = {
  topic: "Evals",
  prompt: "Какая метрика оценивает ретривер?",
  type: "single_choice",
  options: [
    { text: "Recall@k", correct: true },
    { text: "BLEU", correct: false },
  ],
};

const request = (body: MockRequest) => body;
const answer = "Начну с требований и метрик. Потом поиск по чанкам с цитатами.";

async function setUp(turns: FakeTurn[] = [], clock?: { now: Date }) {
  const harness = await start(turns, makeTempDirs(), clock);
  const call = await connectMcp(harness.server);
  expect((await call("save_target", target)).isError).toBe(false);
  return { ...harness, call };
}

/** Starts a mock from the toolbar; the Interviewer's first turn places the first Card. */
async function startMock(h: Awaited<ReturnType<typeof setUp>>, body = request({ durationMinutes: 20, focus: { kind: "weak_spots" } })) {
  const started = await api(h.server, apiPaths.mockRequest, { body });
  expect(started.status).toBe(202);
  await settledChat(h.server);
  return mock(h.server);
}

async function answerCard(server: RunningServer, cardId: string, draft: { text?: string; choices?: number[] }) {
  expect((await api(server, cardPaths.draft(cardId), { method: "PUT", body: draft })).status).toBe(204);
  return api(server, mockPaths.answer(cardId));
}

describe("Starting a Mock interview", () => {
  it("starts with duration and focus, loads the interview skill, and lets the Interviewer place the first Card", async () => {
    const h = await setUp([[tool("next_mock_question", { question: firstQuestion }), reply("Начнём. Первый вопрос — на холсте.")]]);
    const set = await startMock(h);

    const chat = await get<ChatSnapshot>(h.server, apiPaths.chat);
    expect(chat.messages[0]).toMatchObject({ role: "candidate", text: "Хочу мок-интервью на 20 минут, фокус — слабые места." });
    const prompt = h.driver().prompts[0]!;
    expect(prompt.context?.[0]).toMatchObject({ uri: skillUri("mock_interview") });
    expect(prompt.context?.[0]?.text).toContain(interviewSkill);
    expect((prompt.hiddenState as HiddenState).activity).toMatchObject({ kind: "mock_interview" });
    expect((prompt.hiddenState as HiddenState).mock_interview).toEqual({
      id: set.id,
      focus: { topics: [], weak_spots: true },
      minutes_left: 20,
      questions_asked: 0,
      awaiting_answer_card_id: null,
    });

    expect(set.collapsed).toBe(false);
    expect(set.data).toMatchObject({
      mode: "mock",
      status: "active",
      deadline: start22.getTime() + 20 * minute,
      mock: { startedAt: start22.getTime(), finishedAt: null, focus: "слабые места" },
    });
    expect(set.data.cards.map((c) => [c.prompt, c.status, c.followUp])).toEqual([[firstQuestion.prompt, "open", null]]);
    expect(set.data.cards[0]).toMatchObject({ hintRungs: 0, referenceAnswer: null, attempt: null });
  });

  it("starts from the Chat through the Interviewer's tool, names Topics as focus, and refuses a second mock", async () => {
    const h = await setUp([
      [tool("start_mock_interview", { duration_minutes: 30, focus: { topics: ["RAG"] } }), tool("next_mock_question", { question: firstQuestion })],
    ]);
    await api(h.server, apiPaths.chatMessages, { body: { text: "Давай мок на полчаса по RAG" } });
    await settledChat(h.server);
    const set = await mock(h.server);
    expect(set.data).toMatchObject({ deadline: start22.getTime() + 30 * minute, mock: { focus: "RAG" } });
    expect(set.data.cards).toHaveLength(1);
    expect((await h.call("get_profile")).data.activity).toMatchObject({ kind: "mock_interview" });

    const again = await h.call("start_mock_interview", { duration_minutes: 30 });
    expect(again.isError).toBe(true);
    expect(again.text).toContain("A Mock interview is already running");
    const rest = await api(h.server, apiPaths.mockRequest, { body: request({ durationMinutes: 15, focus: { kind: "target" } }) });
    expect(rest).toEqual({ status: 400, body: { error: "мок-интервью уже идёт." } });
  });

  it("refuses an unknown focus Topic and an out-of-range duration", async () => {
    const h = await setUp();
    expect((await api(h.server, apiPaths.mockRequest, { body: { durationMinutes: 200, focus: { kind: "target" } } })).status).toBe(400);
    const unknown = await h.call("start_mock_interview", { duration_minutes: 20, focus: { topics: ["Kubernetes"] } });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toContain('no Topic "Kubernetes"');
  });
});

describe("Mock interview turns", () => {
  it("gives each answer to the Interviewer, places follow-ups that quote it, and keeps grades hidden", async () => {
    let firstCard = "";
    const h = await setUp([
      [tool("next_mock_question", { question: firstQuestion })],
      // The second turn's follow-up is built from the Card id the first turn placed.
    ]);
    const set = await startMock(h);
    firstCard = set.data.cards[0]!.id;

    const blocked = await h.call("next_mock_question", { question: testQuestion });
    expect(blocked.isError).toBe(true);
    expect(blocked.text).toContain("has not answered question 1 yet");

    h.driver().script([reply("Понял."), tool("next_mock_question", followUp(firstCard, "поиск по чанкам с цитатами"))]);
    const answered = await answerCard(h.server, firstCard, { text: answer });
    expect(answered.status).toBe(202);
    const chat = await settledChat(h.server);
    expect(chat.messages.find((m) => m.role === "candidate" && m.text === "Мой ответ — на карточке.")?.card).toEqual({ id: firstCard, prompt: firstQuestion.prompt });
    expect(chat.messages.at(-1)).toMatchObject({ role: "interviewer", text: "Понял." });

    const turn = h.driver().prompts[1]!;
    const context = turn.context?.find((c) => c.uri === `app://context/mock-answer/${firstCard}`)?.text ?? "";
    expect(context).toContain(answer);
    expect(context).toContain('"question_number": 1');
    expect(context).toContain('"minutes_left": 20');
    expect(context).not.toContain(firstQuestion.reference_answer);
    // The skill went with the first turn of this Agent session only.
    expect(turn.context?.some((c) => c.uri === skillUri("mock_interview"))).toBe(false);

    const after = await mock(h.server);
    expect(after.data.cards.map((c) => [c.status, c.followUp])).toEqual([
      ["answered", null],
      ["open", { cardId: firstCard, quote: "поиск по чанкам с цитатами" }],
    ]);
    // No grade, no Reference answer, no Grader during the mock.
    expect(after.data.cards[0]).toMatchObject({ attempt: null, referenceAnswer: null, draft: { text: answer } });
    expect(h.graderAnswers).toEqual([]);
    expect((await api(h.server, cardPaths.draft(firstCard), { method: "PUT", body: { text: "другое" } })).status).toBe(400);
  });

  it("refuses follow-ups without a verbatim quote and Card actions that do not belong in a mock", async () => {
    const h = await setUp([[tool("next_mock_question", { question: firstQuestion })], [reply("Хорошо.")]]);
    const set = await startMock(h);
    const cardId = set.data.cards[0]!.id;
    // Before the answer: no hints, skips, checks, submits, or discussion.
    for (const path of [cardPaths.hint(cardId), cardPaths.skip(cardId), cardPaths.check(cardId), practiceSetPaths.submit(set.id), cardPaths.discuss(cardId)]) {
      expect((await api(h.server, path)).status, path).toBe(400);
    }
    await answerCard(h.server, cardId, { text: answer });
    await settledChat(h.server);

    const notQuoted = await h.call("next_mock_question", followUp(cardId, "векторная база данных"));
    expect(notQuoted.isError).toBe(true);
    expect(notQuoted.text).toContain("The quote is not in the Candidate's answer");
    const noQuote = await h.call("next_mock_question", { ...followUp(cardId, "x"), quote: undefined });
    expect(noQuote.text).toContain("A follow-up quotes the Candidate's answer");
    const repeated = await h.call("next_mock_question", { question: firstQuestion });
    expect(repeated.text).toContain("already asked");
    // Quotes survive other line breaks and capitalization.
    expect((await h.call("next_mock_question", followUp(cardId, "Потом поиск   по чанкам"))).isError).toBe(false);
  });

  it("keeps Practice sets out while a mock runs", async () => {
    const h = await setUp([[tool("next_mock_question", { question: firstQuestion })]]);
    await startMock(h);
    const placed = await h.call("place_practice_set", { title: "Подборка", cards: [testQuestion] });
    expect(placed.isError).toBe(true);
    expect(placed.text).toContain("A Mock interview is running");
    expect((await api(h.server, apiPaths.practiceRequest, { body: { kind: "today" } })).status).toBe(409);
    expect((await h.call("get_profile")).data.activity).toMatchObject({ kind: "mock_interview" });
  });
});

describe("Ending a Mock interview", () => {
  it("ends early: the Grader grades every answer, grades appear on the Cards, Attempts are mock, and Mastery moves", async () => {
    const h = await setUp([
      [tool("next_mock_question", { question: firstQuestion })],
      [reply("Понял."), tool("next_mock_question", { question: testQuestion })],
      [reply("Хорошо."), tool("next_mock_question", { question: { ...firstQuestion, prompt: "Как защититься от prompt injection в документах?" } })],
      [reply("Спасибо.")],
    ]);
    const set = await startMock(h);
    await answerCard(h.server, set.data.cards[0]!.id, { text: answer });
    await settledChat(h.server);
    const test = (await mock(h.server)).data.cards[1]!.id;
    await answerCard(h.server, test, { choices: [0] });
    await settledChat(h.server);
    // The third Card is left without an answer when the Candidate ends the mock.
    expect((await mock(h.server)).data.cards[2]!.status).toBe("open");
    expect((await get<ProgressResponse>(h.server, apiPaths.progress)).topics.every((t) => t.mastery === null)).toBe(true);

    const ended = await api(h.server, mockPaths.finish(set.id));
    expect(ended.status).toBe(202);
    const graded = await gradedMock(h.server);
    expect(graded.collapsed).toBe(false);
    expect(graded.data.mock?.finishedAt).toBe(start22.getTime());
    expect(graded.data.cards.map((c) => [c.status, c.attempt?.score ?? null])).toEqual([
      ["graded", 2],
      ["graded", 3],
      ["skipped", null],
    ]);
    expect(graded.data.cards[0]?.attempt).toMatchObject({ quote: "Начну с требований и метрик.", gap: "Нет проверки на метриках." });
    expect(graded.data.cards[0]?.referenceAnswer).toBe(firstQuestion.reference_answer);
    expect(graded.data.result).toEqual({ score: 5, max: 6, skipped: 1 });
    expect(h.graderAnswers).toEqual([answer]);

    const db = new Database(path.join(h.dataDir, "app.db"), { readonly: true });
    cleanups.push(() => void db.close());
    expect(db.prepare("select distinct mode from attempts").all()).toEqual([{ mode: "mock" }]);
    const progress = await get<ProgressResponse>(h.server, apiPaths.progress);
    expect(progress.topics.find((t) => t.name === "Evals")?.mastery).not.toBeNull();
    expect(progress.due).toBe(0);

    const chat = await get<ChatSnapshot>(h.server, apiPaths.chat);
    const texts = chat.messages.map((m) => m.text);
    expect(texts).toContain("Мок-интервью завершено. Проверяющий оценивает ответы — оценки появятся на карточках.");
    expect(texts.at(-1)).toContain("Мок-интервью проверено: 5 из 6.");
    expect((await h.call("get_profile")).data.activity).toBeNull();
    expect((await api(h.server, mockPaths.finish(set.id))).status).toBe(404);

    // The Interviewer receives the result once, as a mock, for the review.
    await api(h.server, apiPaths.chatMessages, { body: { text: "Как я выступил?" } });
    await settledChat(h.server);
    const result = h.driver().prompts.at(-1)?.context?.find((c) => c.uri === `app://context/practice-set/${set.id}`)?.text ?? "";
    expect(result).toContain('"mode": "mock"');
    expect((h.driver().prompts.at(-1)?.hiddenState as HiddenState).mock_interview).toBeNull();
    // Graded, its Cards can be discussed.
    expect((await api(h.server, cardPaths.discuss(set.data.cards[0]!.id))).status).toBe(202);
  });

  it("lets the Interviewer end the mock, counting the open Card's saved draft", async () => {
    const h = await setUp([
      [tool("next_mock_question", { question: firstQuestion })],
      [tool("finish_mock_interview", {}), reply("На этом всё.")],
    ]);
    const set = await startMock(h);
    await draftAndSend(h, set.data.cards[0]!.id);
    const graded = await gradedMock(h.server);
    expect(graded.data.cards[0]).toMatchObject({ status: "graded", attempt: { score: 2 } });
    const texts = (await get<ChatSnapshot>(h.server, apiPaths.chat)).messages.map((m) => m.text);
    expect(texts.some((t) => t.startsWith("Мок-интервью завершено"))).toBe(false);
  });

  it("enforces the deadline on the server: no Cards or drafts after it, and the mock ends with its answers graded", async () => {
    const clock = { now: start22 };
    const h = await setUp([[tool("next_mock_question", { question: firstQuestion })]], clock);
    const set = await startMock(h, request({ durationMinutes: 5, focus: { kind: "topics", topics: ["RAG"] } }));
    const cardId = set.data.cards[0]!.id;
    await api(h.server, cardPaths.draft(cardId), { method: "PUT", body: { text: answer } });
    h.advance(5 * minute);

    expect((await api(h.server, cardPaths.draft(cardId), { method: "PUT", body: { text: "поздно" } })).status).toBe(400);
    const late = await h.call("next_mock_question", { question: testQuestion });
    expect(late.isError).toBe(true);
    expect(late.text).toContain("time is up");
    const graded = await gradedMock(h.server);
    expect(graded.data.cards[0]).toMatchObject({ status: "graded", draft: { text: answer } });
    expect(graded.data.mock?.finishedAt).toBe(start22.getTime() + 5 * minute);
    const texts = (await get<ChatSnapshot>(h.server, apiPaths.chat)).messages.map((m) => m.text);
    expect(texts).toContain("Время мок-интервью вышло. Проверяющий оценивает ответы — оценки появятся на карточках.");
  });

  it("ends a mock whose time ran out while the app was stopped", async () => {
    const dirs = makeTempDirs();
    const clock = { now: start22 };
    const first = await start([[tool("next_mock_question", { question: firstQuestion })]], dirs, clock);
    await api(first.server, apiPaths.mockRequest, { body: request({ durationMinutes: 10, focus: { kind: "target" } }) });
    await settledChat(first.server);
    await first.server.close();

    clock.now = new Date(start22.getTime() + 11 * minute);
    const second = await start([], dirs, clock);
    const graded = await gradedMock(second.server);
    expect(graded.data.cards[0]?.status).toBe("skipped");
    expect(graded.data.mock).toMatchObject({ focus: "вся цель подготовки" });
  });
});

async function draftAndSend(h: Awaited<ReturnType<typeof setUp>>, cardId: string) {
  await api(h.server, cardPaths.draft(cardId), { method: "PUT", body: { text: answer } });
  await api(h.server, apiPaths.chatMessages, { body: { text: "Давай закончим" } });
  await settledChat(h.server);
}
