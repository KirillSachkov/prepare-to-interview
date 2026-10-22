import fs from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import {
  apiPaths,
  cardPaths,
  practiceSetPaths,
  skillUri,
  type CanvasSnapshot,
  type CardView,
  type ChatSnapshot,
  type PracticeSetNode,
  type ProgressResponse,
  type TargetsResponse,
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

/** Local noon, so calendar dates do not depend on the machine's time zone. */
const day = (d: number) => new Date(2026, 9, d, 12, 0, 0);

interface GraderCall {
  config: SessionConfig;
  input: TurnInput;
}

interface Harness {
  server: RunningServer;
  driver: () => FakeDriver;
  /** Grader replies by a word the answer contains; each reply is used once, the last one repeats. */
  grades: Map<string, string[]>;
  graderCalls: GraderCall[];
  /** Inputs of the review turns the app started after graded sets. */
  reviews: TurnInput[];
  /** While set, Grader turns wait for it before replying. */
  gate: { wait?: Promise<unknown> };
  setDay: (d: number) => void;
}

/** The shared Rubric file, which the practice skill and the Grader persona both carry. */
const rubric = fs.readFileSync(path.join(defaultContentDir, "references", "rubric.md"), "utf8").trim();

const isGrader = (config: SessionConfig) => config.persona.startsWith("# Grader");

async function start(turns: FakeTurn[] = [], dirs = makeTempDirs(), options: { agent?: boolean } = {}): Promise<Harness> {
  let now = day(22);
  const grades = new Map<string, string[]>();
  const graderCalls: GraderCall[] = [];
  const gate: Harness["gate"] = {};
  let lastAnswer = "";
  let driver: FakeDriver | undefined;
  const reviews: TurnInput[] = [];
  const respond = (config: SessionConfig, input: TurnInput): FakeTurn | undefined => {
    // The review the app starts after a graded set; continuity.test.ts covers it.
    if (input.text.includes('<app_context name="activity_ended">')) {
      reviews.push(input);
      return [];
    }
    if (!isGrader(config)) return undefined;
    graderCalls.push({ config, input });
    const answer = /<answer>\n([\s\S]*?)\n<\/answer>/.exec(input.text)?.[1] ?? lastAnswer;
    lastAnswer = answer;
    const key = [...grades.keys()].find((k) => answer.includes(k));
    const replies = key ? grades.get(key) : undefined;
    const text = (replies && replies.length > 1 ? replies.shift() : replies?.[0]) ?? verdict(0, "", "", "Нет ответа по сути.");
    return [...(gate.wait ? [{ waitFor: gate.wait }] : []), { event: { type: "message_chunk", text } }];
  };
  const { server } = await startTestServer(dirs, {
    now: () => now,
    drivers: (): AgentDriver => (driver ??= new FakeDriver(turns, { respond })),
    detectAgents: () => [{ id: "claude", label: "Claude Code", installed: true, detail: "/bin/claude" }],
  });
  cleanups.push(() => server.close());
  cleanups.push(dirs.cleanup);
  if (options.agent !== false) await api(server, apiPaths.agentSettings, { method: "PUT", body: { agent: "claude" } });
  return { server, driver: () => driver!, grades, graderCalls, reviews, gate, setDay: (d) => (now = day(d)) };
}

const verdict = (score: number, quote: string, right: string, gap: string) => JSON.stringify({ score, quote, right, gap });

async function api(
  server: RunningServer,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ status: number; body: unknown }> {
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

async function sets(server: RunningServer): Promise<PracticeSetNode[]> {
  return practiceSets(await get<CanvasSnapshot>(server, apiPaths.canvas));
}

async function onlySet(server: RunningServer): Promise<PracticeSetNode> {
  const all = await sets(server);
  expect(all).toHaveLength(1);
  return all[0]!;
}

/** Waits until no Card of the set is grading. */
async function graded(server: RunningServer, setId: string): Promise<PracticeSetNode> {
  await expect
    .poll(async () => (await sets(server)).find((s) => s.id === setId)?.data.cards.some((c) => c.status === "grading"))
    .toBe(false);
  return (await sets(server)).find((s) => s.id === setId)!;
}

const card = (set: PracticeSetNode, index: number): CardView => set.data.cards[index]!;

const target = {
  role: "AI engineer",
  name: "AI Engineer",
  topics: [
    { name: "RAG", priority: "high" },
    { name: "Evals", priority: "medium" },
  ],
};

const openRag = {
  topic: "RAG",
  prompt: "Как выбрать размер чанков для RAG?",
  type: "open",
  reference_answer: "Резать по смысловым границам, 300–800 токенов с перекрытием 10–20%, проверять на метриках ретривера.",
  rubric_anchors: { "2": "Называет размер и перекрытие, но не проверку метриками.", "3": "Размер, перекрытие и проверка на метриках." },
  hints: ["Начните с границ смысла.", "Подумайте, как проверить выбор."],
};

const singleEvals = {
  topic: "Evals",
  prompt: "Что считается галлюцинацией в RAG-ответе?",
  type: "single_choice",
  options: [
    { text: "Утверждение, не подтверждённое найденными документами", correct: true },
    { text: "Медленный ответ", correct: false },
  ],
};

const multiEvals = {
  topic: "Evals",
  prompt: "Какие метрики подходят для оценки ретривера?",
  type: "multiple_choice",
  options: [
    { text: "Recall@k", correct: true },
    { text: "MRR", correct: true },
    { text: "BLEU", correct: false },
  ],
};

async function setUp(turns: FakeTurn[] = []) {
  const harness = await start(turns);
  const call = await connectMcp(harness.server);
  expect((await call("save_target", target)).isError).toBe(false);
  return { ...harness, call };
}

async function place(call: Awaited<ReturnType<typeof connectMcp>>, args: Record<string, unknown>) {
  const result = await call("place_practice_set", args);
  expect(result.text).not.toMatch(/^Invalid|Fix:/);
  return result.data as { practice_set_id: string; cards: { card_id: string; question_id: string }[]; skill: string | null; activity_id: string };
}

const draft = (server: RunningServer, cardId: string, body: { text?: string; choices?: number[] }) =>
  api(server, cardPaths.draft(cardId), { method: "PUT", body });

describe("Practice sets on the Canvas", () => {
  it("places open and test Cards from the bank and composed Questions, within a practice_set Activity", async () => {
    const { server, call } = await setUp();
    const own = await call("add_question", { topic: "RAG", prompt: "Что такое гибридный поиск?" });
    const questionId = (own.data as { question_id: string }).question_id;

    const placed = await place(call, {
      title: "Подборка на сегодня",
      cards: [{ question_id: questionId, reference_answer: "BM25 и векторный поиск вместе, с объединением рангов." }, openRag, singleEvals],
    });

    expect(placed.skill).toContain('<activity_skill name="practice_set">');
    expect(placed.skill).toContain(rubric);
    const set = await onlySet(server);
    expect(set).toMatchObject({ id: placed.practice_set_id, collapsed: false, data: { title: "Подборка на сегодня", kind: "practice", reveal: "after_submit", status: "active" } });
    expect(set.data.cards.map((c) => [c.topic, c.type, c.prompt, c.status])).toEqual([
      ["RAG", "open", "Что такое гибридный поиск?", "open"],
      ["RAG", "open", openRag.prompt, "open"],
      ["Evals", "single_choice", singleEvals.prompt, "open"],
    ]);
    expect(card(set, 2).options).toEqual(singleEvals.options.map((o) => o.text));
    // Nothing gives the answer away before an Attempt: no Reference answer, no correct options.
    expect(set.data.cards.every((c) => c.referenceAnswer === null && c.attempt === null)).toBe(true);
    expect(JSON.stringify(set)).not.toContain("correct");
    expect(card(set, 1)).toMatchObject({ hints: [], hintRungs: 2, maxScore: 3 });
    expect((await call("get_profile")).data.activity).toMatchObject({ kind: "practice_set" });
  });

  it.each([
    ["a Quiz with an open Question", { title: "Квиз", kind: "quiz", cards: [openRag] }, "a Quiz holds only test Questions"],
    ["an open Question without a Reference answer", { title: "X", cards: [{ topic: "RAG", prompt: "Что такое RAG?", type: "open" }] }, "without a Reference answer"],
    ["an unknown bank Question", { title: "X", cards: [{ question_id: "nope" }] }, 'No active Question with id "nope"'],
    ["a test with a single correct option marked twice", { title: "X", cards: [{ ...singleEvals, options: singleEvals.options.map((o) => ({ ...o, correct: true })) }] }, "exactly one correct"],
  ])("refuses %s with a fix hint", async (_case, args, message) => {
    const { server, call } = await setUp();
    const result = await call("place_practice_set", args);
    expect(result.isError).toBe(true);
    expect(result.text).toContain(message);
    expect(result.text).toContain("\nFix: ");
    expect(await sets(server)).toEqual([]);
  });

  it("keeps an unsubmitted set until the Candidate agrees to drop it", async () => {
    const { server, call } = await setUp();
    const first = await place(call, { title: "Первая", cards: [singleEvals] });

    const blocked = await call("place_practice_set", { title: "Вторая", cards: [multiEvals] });
    expect(blocked.isError).toBe(true);
    expect(blocked.text).toContain('unsubmitted Practice set "Первая"');
    expect(blocked.text).toContain('"replace_unfinished": true');

    const second = await place(call, { title: "Вторая", cards: [multiEvals], replace_unfinished: true });
    expect((await sets(server)).map((s) => s.id)).toEqual([second.practice_set_id]);
    expect((await api(server, cardPaths.draft(first.cards[0]!.card_id), { method: "PUT", body: { choices: [0] } })).status).toBe(404);
  });

  it("keeps Card drafts across a restart", async () => {
    const dirs = makeTempDirs();
    const first = await start([], dirs);
    const call = await connectMcp(first.server);
    const placed = await place(call, { title: "Черновики", cards: [openRag, multiEvals] });
    const [open, multi] = placed.cards.map((c) => c.card_id);
    expect((await draft(first.server, open!, { text: "Режу по заголовкам" })).status).toBe(204);
    expect((await draft(first.server, multi!, { choices: [1, 0] })).status).toBe(204);
    await first.server.close();

    const second = await start([], dirs);
    const set = await onlySet(second.server);
    expect(set.data.cards.map((c) => c.draft)).toEqual([
      { text: "Режу по заголовкам", choices: [] },
      { text: "", choices: [0, 1] },
    ]);
  });

  it("refuses drafts that do not fit the Card", async () => {
    const { server, call } = await setUp();
    const placed = await place(call, { title: "X", cards: [singleEvals] });
    const cardId = placed.cards[0]!.card_id;
    expect(await draft(server, cardId, { choices: [0, 1] })).toEqual({ status: 400, body: { error: "выберите один вариант." } });
    expect(await draft(server, cardId, { choices: [5] })).toEqual({ status: 400, body: { error: "такого варианта нет." } });
    expect((await draft(server, "no-card", { text: "x" })).status).toBe(404);
  });
});

describe("Submitting and grading", () => {
  it("checks tests in the app, grades open answers in a separate Grader session, and posts a summary", async () => {
    const { server, call, grades, graderCalls } = await setUp([[reply("Расскажите о себе.")]]);
    await api(server, apiPaths.chatMessages, { body: { text: "Привет" } });
    await settledChat(server);
    const placed = await place(call, { title: "Подборка на сегодня", cards: [openRag, singleEvals, multiEvals] });
    const [open, single, multi] = placed.cards.map((c) => c.card_id);
    const answer = "Режу документы по заголовкам, чанки примерно 500 токенов с небольшим перекрытием.";
    await draft(server, open!, { text: answer });
    await draft(server, single!, { choices: [0] });
    await draft(server, multi!, { choices: [0, 2] });
    grades.set("заголовкам", [verdict(2, "чанки примерно 500 токенов с небольшим перекрытием", "Размер и перекрытие названы.", "Выбор не проверяется на метриках ретривера.")]);

    const submitted = await api(server, practiceSetPaths.submit(placed.practice_set_id));
    expect(submitted.status).toBe(202);
    expect((submitted.body as PracticeSetNode).data.cards.map((c) => c.status)).toEqual(["grading", "graded", "graded"]);

    const set = await graded(server, placed.practice_set_id);
    expect(set.data.status).toBe("graded");
    // The graded set collapses into a result Card; expanding it shows the grades again.
    expect(set.collapsed).toBe(true);
    expect(card(set, 0).attempt).toEqual({
      status: "graded",
      score: 2,
      maxScore: 3,
      quote: "чанки примерно 500 токенов с небольшим перекрытием",
      strengths: "Размер и перекрытие названы.",
      gap: "Выбор не проверяется на метриках ретривера.",
      correct: null,
    });
    expect(card(set, 0).referenceAnswer).toBe(openRag.reference_answer);
    expect(card(set, 1).attempt).toMatchObject({ status: "graded", score: 3, correct: [0] });
    expect(card(set, 2).attempt).toMatchObject({ status: "graded", score: 0, correct: [0, 1] });
    expect(set.data.result).toEqual({ score: 5, max: 9, skipped: 0 });

    // The Grader saw only the Question, the Reference answer, the Rubric anchors, and the answer.
    expect(graderCalls).toHaveLength(1);
    const { config, input } = graderCalls[0]!;
    expect(config).toMatchObject({ allowedBuiltins: [], mcpServers: [] });
    expect(config.persona).toContain(rubric);
    expect(input.hiddenState).toBeUndefined();
    expect(input.context).toBeUndefined();
    for (const part of [openRag.prompt, openRag.reference_answer, openRag.rubric_anchors["3"], answer]) expect(input.text).toContain(part);
    expect(input.text).not.toContain("Привет");
    expect(input.text).not.toContain(singleEvals.prompt);

    const chat = await get<ChatSnapshot>(server, apiPaths.chat);
    expect(chat.messages.at(-1)?.role).toBe("interviewer");
    expect(chat.messages.at(-1)?.text).toContain("Подборка проверена: «Подборка на сегодня» — 5 из 9.");
    // The graded set completed its Activity; the app started the review.
    expect((await call("get_profile")).data.activity).toMatchObject({ kind: "review" });
  });

  it("refuses a Grader verdict without a verbatim quote, asks again, and fails the Card after two bad replies", async () => {
    const { server, call, grades, graderCalls } = await setUp();
    const placed = await place(call, { title: "X", cards: [openRag] });
    const cardId = placed.cards[0]!.card_id;
    await draft(server, cardId, { text: "Режу по заголовкам." });
    grades.set("заголовкам", [verdict(3, "I cut by meaning", "", ""), verdict(2, "Режу по заголовкам", "Есть идея.", "Нет метрик.")]);

    await api(server, practiceSetPaths.submit(placed.practice_set_id));
    let set = await graded(server, placed.practice_set_id);
    expect(card(set, 0).attempt).toMatchObject({ score: 2, quote: "Режу по заголовкам" });
    expect(graderCalls.map((c) => c.input.text.slice(0, 40))).toEqual([
      expect.stringContaining("Grade the Candidate's answer"),
      expect.stringContaining("The quote is not a verbatim excerpt"),
    ]);

    // A Card can also fail: after a retry the Grader answers twice without JSON.
    await api(server, cardPaths.retry(cardId));
    grades.set("заголовкам", ["Отлично!"]);
    expect((await api(server, cardPaths.check(cardId))).status).toBe(202);
    set = await graded(server, placed.practice_set_id);
    expect(card(set, 0)).toMatchObject({ status: "failed", error: "Проверяющий дважды ответил не по формату. Попробуйте проверить ещё раз." });

    grades.set("заголовкам", [verdict(3, "по заголовкам", "Верно.", "")]);
    await api(server, cardPaths.check(cardId));
    set = await graded(server, placed.practice_set_id);
    expect(card(set, 0)).toMatchObject({ status: "graded", error: null, attempt: { score: 3 } });
  });

  it("fails open answers with a clear message while no agent is chosen", async () => {
    const harness = await start([], makeTempDirs(), { agent: false });
    const call = await connectMcp(harness.server);
    const placed = await place(call, { title: "X", cards: [openRag] });
    await draft(harness.server, placed.cards[0]!.card_id, { text: "Ответ" });
    await api(harness.server, practiceSetPaths.submit(placed.practice_set_id));
    const set = await graded(harness.server, placed.practice_set_id);
    expect(card(set, 0)).toMatchObject({ status: "failed", error: "Выберите агента в настройках чата, чтобы проверить ответ." });
  });

  it("records Skipped as a status, not a score of 0, also for Cards left unanswered at submit", async () => {
    const { server, call } = await setUp();
    const placed = await place(call, { title: "X", cards: [openRag, singleEvals, multiEvals] });
    const [open, single, multi] = placed.cards.map((c) => c.card_id);

    const skipped = (await api(server, cardPaths.skip(open!))).body as PracticeSetNode;
    expect(card(skipped, 0)).toMatchObject({ status: "skipped", attempt: { status: "skipped", score: null }, referenceAnswer: openRag.reference_answer });
    await draft(server, multi!, { choices: [0, 1] });
    await api(server, practiceSetPaths.submit(placed.practice_set_id));

    const set = await graded(server, placed.practice_set_id);
    expect(set.data.cards.map((c) => [c.status, c.attempt?.score])).toEqual([
      ["skipped", null],
      ["skipped", null],
      ["graded", 3],
    ]);
    expect(set.data.result).toEqual({ score: 3, max: 3, skipped: 2 });
    expect(single).toBeDefined();
    // Skipped Attempts do not count as 0 in Mastery: RAG stays untouched, Evals is mastered.
    const progress = await get<ProgressResponse>(server, apiPaths.progress);
    expect(progress.topics.map((t) => [t.name, t.mastery])).toEqual([
      ["RAG", null],
      ["Evals", 1],
    ]);
  });

  it("caps the score by the Hint ladder and reveals hints one rung at a time", async () => {
    const { server, call, grades } = await setUp();
    const placed = await place(call, { title: "X", cards: [openRag, singleEvals] });
    const [open, single] = placed.cards.map((c) => c.card_id);

    let set = (await api(server, cardPaths.hint(open!))).body as PracticeSetNode;
    expect(card(set, 0)).toMatchObject({ hints: ["Начните с границ смысла."], maxScore: 2 });
    set = (await api(server, cardPaths.hint(open!))).body as PracticeSetNode;
    expect(card(set, 0)).toMatchObject({ hints: openRag.hints, maxScore: 1 });
    expect(await api(server, cardPaths.hint(open!))).toEqual({ status: 400, body: { error: "подсказок больше нет." } });
    expect(await api(server, cardPaths.hint(single!))).toEqual({ status: 400, body: { error: "подсказок больше нет." } });

    await draft(server, open!, { text: "Режу по смыслу, проверяю recall." });
    await draft(server, single!, { choices: [0] });
    grades.set("по смыслу", [verdict(3, "Режу по смыслу", "Всё верно.", "")]);
    await api(server, practiceSetPaths.submit(placed.practice_set_id));
    set = await graded(server, placed.practice_set_id);
    expect(card(set, 0).attempt).toMatchObject({ score: 1, maxScore: 1 });
    expect(set.data.result).toEqual({ score: 4, max: 6, skipped: 0 });
  });

  it("grades each answer right away in training mode and a Quiz, but only after submit otherwise", async () => {
    const { server, call } = await setUp();
    const quiz = await place(call, { title: "Квиз", kind: "quiz", cards: [singleEvals, multiEvals] });
    const [single, multi] = quiz.cards.map((c) => c.card_id);
    await draft(server, single!, { choices: [0] });
    let set = (await api(server, cardPaths.check(single!))).body as PracticeSetNode;
    expect(set.data).toMatchObject({ reveal: "each_answer", status: "active" });
    expect(card(set, 0).attempt).toMatchObject({ score: 3 });
    expect(await api(server, cardPaths.check(multi!))).toEqual({ status: 400, body: { error: "сначала ответьте или пропустите карточку." } });
    await draft(server, multi!, { choices: [0] });
    set = (await api(server, cardPaths.check(multi!))).body as PracticeSetNode;
    // The last Card completes the Quiz: some correct and no wrong options score 1.
    expect(set.data).toMatchObject({ status: "graded", result: { score: 4, max: 6, skipped: 0 } });

    const practice = await place(call, { title: "Подборка", cards: [singleEvals] });
    const cardId = practice.cards[0]!.card_id;
    await draft(server, cardId, { choices: [0] });
    expect(await api(server, cardPaths.check(cardId))).toEqual({ status: 400, body: { error: "оценки появятся после отправки подборки." } });
    expect((await api(server, practiceSetPaths.reveal(practice.practice_set_id), { method: "PUT", body: { reveal: "each_answer" } })).status).toBe(200);
    set = (await api(server, cardPaths.check(cardId))).body as PracticeSetNode;
    expect(set.data.status).toBe("graded");
  });

  it("keeps graded sets collapsed into result Cards when the next set is placed", async () => {
    const { server, call } = await setUp();
    const first = await place(call, { title: "Первая", kind: "quiz", cards: [singleEvals] });
    await draft(server, first.cards[0]!.card_id, { choices: [0] });
    await api(server, cardPaths.check(first.cards[0]!.card_id));
    const second = await place(call, { title: "Вторая", cards: [multiEvals] });

    expect((await sets(server)).map((s) => [s.id, s.collapsed, s.position.x > 0])).toEqual([
      [first.practice_set_id, true, false],
      [second.practice_set_id, false, true],
    ]);
  });
});

describe("Grading edge cases", () => {
  it("discards a Grader verdict that arrives after its set was dropped", async () => {
    const { server, call, grades, gate } = await setUp();
    const placed = await place(call, { title: "Первая", reveal: "each_answer", cards: [openRag, singleEvals] });
    const cardId = placed.cards[0]!.card_id;
    await draft(server, cardId, { text: "Режу по заголовкам." });
    grades.set("заголовкам", [verdict(3, "Режу по заголовкам", "Верно.", "")]);
    let release: () => void = () => undefined;
    gate.wait = new Promise<void>((resolve) => (release = resolve));
    await api(server, cardPaths.check(cardId));

    await place(call, { title: "Вторая", cards: [multiEvals], replace_unfinished: true });
    release();
    await expect.poll(async () => (await sets(server)).map((s) => s.data.title)).toEqual(["Вторая"]);
    // No Attempt was recorded for the dropped Card: its Question was never practised.
    const progress = await get<ProgressResponse>(server, apiPaths.progress);
    expect(progress.topics.find((t) => t.name === "RAG")?.mastery).toBeNull();
  });

  it("lets the Candidate skip a Card whose grading failed", async () => {
    const harness = await start([], makeTempDirs(), { agent: false });
    const call = await connectMcp(harness.server);
    const placed = await place(call, { title: "X", cards: [openRag] });
    const cardId = placed.cards[0]!.card_id;
    await draft(harness.server, cardId, { text: "Ответ" });
    await api(harness.server, practiceSetPaths.submit(placed.practice_set_id));
    expect(card(await graded(harness.server, placed.practice_set_id), 0).status).toBe("failed");

    const skipped = (await api(harness.server, cardPaths.skip(cardId))).body as PracticeSetNode;
    expect(card(skipped, 0)).toMatchObject({ status: "skipped", error: null });
    expect(skipped.data).toMatchObject({ status: "graded", result: { score: 0, max: 0, skipped: 1 } });
  });

  it("keeps the practice_set Activity running until its last set is graded", async () => {
    const { server, call, grades, gate } = await setUp();
    const first = await place(call, { title: "Первая", cards: [openRag] });
    await draft(server, first.cards[0]!.card_id, { text: "Режу по заголовкам." });
    grades.set("заголовкам", [verdict(2, "Режу по заголовкам", "Есть идея.", "Нет метрик.")]);
    let release: () => void = () => undefined;
    gate.wait = new Promise<void>((resolve) => (release = resolve));
    await api(server, practiceSetPaths.submit(first.practice_set_id));
    const second = await place(call, { title: "Вторая", cards: [singleEvals] });
    expect(second.activity_id).toBe(first.activity_id);

    gate.wait = undefined;
    release();
    await graded(server, first.practice_set_id);
    expect((await call("get_profile")).data.activity).toMatchObject({ kind: "practice_set" });
  });

  it("submits a timed Quiz whose time ran out and refuses answers after the deadline", async () => {
    const { server, call, setDay } = await setUp();
    const quiz = await place(call, { title: "Блиц", kind: "quiz", time_limit_minutes: 5, cards: [singleEvals] });
    const cardId = quiz.cards[0]!.card_id;
    await draft(server, cardId, { choices: [0] });
    expect((await sets(server))[0]!.data.deadline).toBe(day(22).getTime() + 5 * 60_000);
    setDay(23);
    expect(await draft(server, cardId, { choices: [1] })).toEqual({ status: 400, body: { error: "время квиза вышло." } });

    // Nobody submitted it; the next set does not wait for it, and the Quiz counts what was answered.
    await place(call, { title: "Следующая", cards: [multiEvals] });
    const expired = (await sets(server)).find((s) => s.id === quiz.practice_set_id)!;
    expect(expired.data).toMatchObject({ status: "graded", result: { score: 3, max: 3, skipped: 0 } });
  });

  it("reuses the bank Question with the same prompt instead of adding a copy", async () => {
    const { call } = await setUp();
    const own = await call("add_question", { topic: "RAG", prompt: openRag.prompt, type: "open", reference_answer: openRag.reference_answer });
    await place(call, { title: "X", cards: [openRag] });
    const queue = (await call("get_progress")).data as { new_questions: { question_id: string }[] };
    expect(queue.new_questions.map((q) => q.question_id)).toEqual([(own.data as { question_id: string }).question_id]);
  });
});

describe("Scheduling, Mastery, and readiness", () => {
  it("moves Leitner boxes, marks Questions Due, and derives Mastery and readiness from Attempts", async () => {
    const { server, call, grades, setDay } = await setUp();
    const placed = await place(call, { title: "День 1", cards: [openRag, singleEvals] });
    const [open, single] = placed.cards.map((c) => c.card_id);
    await draft(server, open!, { text: "Чанки по 500 токенов." });
    await draft(server, single!, { choices: [0] });
    grades.set("500", [verdict(1, "Чанки по 500 токенов", "Размер назван.", "Нет перекрытия и проверки.")]);
    await api(server, practiceSetPaths.submit(placed.practice_set_id));
    await graded(server, placed.practice_set_id);

    let progress = (await call("get_progress")).data as Record<string, unknown> & { due_questions: { box: number; due_on: string }[] };
    expect(progress).toMatchObject({
      readiness: 60, // RAG 1/3 at high (weight 3), Evals 3/3 at medium (weight 2).
      due: 0,
      topics: [
        { name: "RAG", mastery: 33, questions: 1, due: 0 },
        { name: "Evals", mastery: 100, questions: 1, due: 0 },
      ],
    });
    // A score of 1 sends the Question to box 1 (Due tomorrow); 3 moves it up to box 2 (Due in 3 days).
    const targetsDue = async () => (await get<TargetsResponse>(server, apiPaths.targets)).targets[0]!;
    expect(await targetsDue()).toMatchObject({ readiness: 60, due: 0 });

    setDay(23);
    progress = (await call("get_progress")).data as typeof progress;
    expect(progress.due_questions).toMatchObject([{ topic: "RAG", box: 1, due_on: "2026-10-23" }]);
    expect(await targetsDue()).toMatchObject({ due: 1 });

    setDay(25);
    progress = (await call("get_progress")).data as typeof progress;
    expect(progress.due_questions.map((q) => [q.box, q.due_on])).toEqual([
      [1, "2026-10-23"],
      [2, "2026-10-25"],
    ]);

    // Today's set repeats the RAG Question; a 3 moves it up and recent Attempts weigh more.
    const repeat = await place(call, { title: "День 4", cards: [{ question_id: placed.cards[0]!.question_id }] });
    await draft(server, repeat.cards[0]!.card_id, { text: "По смыслу, 300–800 токенов, перекрытие, recall@k." });
    grades.set("смыслу", [verdict(3, "300–800 токенов", "Полно.", "")]);
    await api(server, practiceSetPaths.submit(repeat.practice_set_id));
    await graded(server, repeat.practice_set_id);
    progress = (await call("get_progress")).data as typeof progress;
    expect(progress).toMatchObject({ due: 1, topics: [{ name: "RAG", mastery: 73 }, { name: "Evals" }] });
    expect(await targetsDue()).toMatchObject({ readiness: 84, due: 1 });
  });

  it("records a retry after feedback without moving the Leitner box or Mastery", async () => {
    const { server, call, grades } = await setUp();
    const placed = await place(call, { title: "X", cards: [openRag] });
    const cardId = placed.cards[0]!.card_id;
    await draft(server, cardId, { text: "Не знаю, может 100 токенов." });
    grades.set("100 токенов", [verdict(0, "", "", "Ключевая идея не названа.")]);
    await api(server, practiceSetPaths.submit(placed.practice_set_id));
    await graded(server, placed.practice_set_id);

    let set = (await api(server, cardPaths.retry(cardId))).body as PracticeSetNode;
    expect(card(set, 0)).toMatchObject({ status: "open", attempt: null, referenceAnswer: openRag.reference_answer });
    await draft(server, cardId, { text: "По смыслу, 300–800 токенов, перекрытие." });
    grades.set("смыслу", [verdict(3, "По смыслу", "Полно.", "")]);
    await api(server, cardPaths.check(cardId));
    set = await graded(server, placed.practice_set_id);
    expect(card(set, 0).attempt).toMatchObject({ score: 3 });
    // The set's result and Mastery keep the first Attempt.
    expect(set.data.result).toEqual({ score: 0, max: 3, skipped: 0 });
    expect((await get<ProgressResponse>(server, apiPaths.progress)).topics[0]).toMatchObject({ name: "RAG", mastery: 0 });
  });
});

describe("Chat and the Interviewer", () => {
  it("asks the Interviewer for a Practice set from the toolbar and loads the practice skill", async () => {
    const { server, driver } = await setUp([[reply("Собираю подборку.")]]);
    const res = await api(server, apiPaths.practiceRequest, { body: { kind: "topic", topic: "RAG" } });
    expect(res.status).toBe(202);
    const chat = await settledChat(server);
    expect(chat.messages[0]).toMatchObject({ role: "candidate", text: "Хочу подборку по теме «RAG»." });
    const prompt = driver().prompts[0]!;
    expect((prompt.hiddenState as HiddenState).activity).toMatchObject({ kind: "practice_set" });
    expect(prompt.context?.[0]).toMatchObject({ uri: skillUri("practice_set") });
  });

  it("sends the grading result to the Interviewer once, and a discussed Card with its answer and grade", async () => {
    const { server, call, driver, grades, reviews } = await setUp([[reply("Разберём.")], [reply("Ещё раз про чанки.")]]);
    const placed = await place(call, { title: "Подборка", cards: [openRag] });
    const cardId = placed.cards[0]!.card_id;
    await draft(server, cardId, { text: "Режу по заголовкам." });
    grades.set("заголовкам", [verdict(2, "Режу по заголовкам", "Идея есть.", "Нет метрик.")]);
    await api(server, practiceSetPaths.submit(placed.practice_set_id));
    await graded(server, placed.practice_set_id);

    expect((await api(server, cardPaths.discuss(cardId))).status).toBe(202);
    const chat = await settledChat(server);
    const discussed = chat.messages.find((m) => m.role === "candidate");
    expect(discussed).toMatchObject({ text: "Обсудим эту карточку.", card: { id: cardId, prompt: openRag.prompt } });

    // The graded set completed its Activity: the review the app started received the result.
    expect(reviews.map((r) => r.context?.map((c) => c.uri))).toEqual([[skillUri("review"), `app://context/practice-set/${placed.practice_set_id}`]]);
    const result = reviews[0]?.context?.[1]?.text ?? "";
    expect(result).toContain('"score": 2');
    expect(result).toContain("Нет метрик.");
    const first = driver().prompts[0]!;
    expect(first.context?.map((c) => c.uri)).toEqual([`app://context/card/${cardId}`]);
    const cardContext = first.context?.[0]?.text ?? "";
    for (const part of [openRag.prompt, "Режу по заголовкам.", '"score": 2', "Нет метрик.", openRag.reference_answer]) expect(cardContext).toContain(part);

    await api(server, apiPaths.chatMessages, { body: { text: "А как проверить?" } });
    await settledChat(server);
    expect(driver().prompts[1]?.context).toBeUndefined();
  });

  it("keeps the Reference answer out of a Card discussed before any Attempt", async () => {
    const { server, call, driver } = await setUp([[reply("Подумаем вместе.")]]);
    const placed = await place(call, { title: "Подборка", cards: [openRag] });
    await api(server, cardPaths.discuss(placed.cards[0]!.card_id));
    await settledChat(server);
    const text = driver().prompts[0]?.context?.find((c) => c.uri.includes("card/"))?.text ?? "";
    expect(text).toContain('"reference_answer": null');
    expect(text).not.toContain(openRag.reference_answer);
  });

  it("asks before replacing an unsubmitted set through the Interviewer's tool", async () => {
    const { server, driver } = await setUp([
      [tool("place_practice_set", { title: "Первая", cards: [singleEvals] }), reply("Готово.")],
      [reply("Отправьте сначала текущую подборку?")],
    ]);
    await api(server, apiPaths.chatMessages, { body: { text: "Дай подборку" } });
    await settledChat(server);
    await api(server, apiPaths.chatMessages, { body: { text: "Ещё одну" } });
    await settledChat(server);
    expect((driver().prompts[1]?.hiddenState as HiddenState).unfinished_practice_set).toMatchObject({ title: "Первая", answered: 0, cards: 1 });
  });
});
