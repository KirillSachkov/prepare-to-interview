// Continuity at the server seam (ADR-0002, ADR-0004): Agent session rotation at Activity
// boundaries, on a new day, and on the usage threshold; the review and its proposals; the
// Briefing; auto-tidy into history; and disputed grade correction.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import {
  apiPaths,
  cardPaths,
  practiceSetPaths,
  proposalPaths,
  skillUri,
  type CanvasSnapshot,
  type ChatSnapshot,
  type HistoryResponse,
  type PracticeSetNode,
} from "@prepare-to-interview/shared";
import type { AgentDriver, SessionConfig, TurnInput } from "../src/agent/driver.ts";
import { FakeDriver, type FakeStep, type FakeTurn } from "../src/agent/fake-driver.ts";
import { maxBriefingChars } from "../src/interviewer/briefing.ts";
import type { HiddenState } from "../src/interviewer/interviewer.ts";
import type { RunningServer } from "../src/server.ts";
import { authHeaders, makeTempDirs, practiceSets, startTestServer } from "./helpers.ts";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** Local noon, so calendar dates do not depend on the machine's time zone. */
const day = (d: number) => new Date(2026, 9, d, 12, 0, 0);

const isReview = (input: TurnInput) => input.text.includes('<app_context name="activity_ended">');

interface Options {
  /** Review turns take scripted turns; otherwise they answer with an empty turn. */
  scriptReviews?: boolean;
}

interface Harness {
  server: RunningServer;
  driver: () => FakeDriver;
  /** Grader scores by a word the answer contains; 0 otherwise. */
  scores: Map<string, number>;
  reviews: TurnInput[];
  setDay: (d: number) => void;
  call: Awaited<ReturnType<typeof connectMcp>>;
}

async function start(turns: FakeTurn[] = [], options: Options = {}, dirs = makeTempDirs(), startDay = 22): Promise<Harness> {
  let now = day(startDay);
  const scores = new Map<string, number>();
  const reviews: TurnInput[] = [];
  let driver: FakeDriver | undefined;
  const respond = (config: SessionConfig, input: TurnInput): FakeTurn | undefined => {
    if (config.persona.startsWith("# Grader")) {
      const answer = /<answer>\n([\s\S]*?)\n<\/answer>/.exec(input.text)?.[1] ?? "";
      const score = [...scores.entries()].find(([word]) => answer.includes(word))?.[1] ?? 0;
      const quote = answer.split(" ").slice(0, 2).join(" ");
      return [{ event: { type: "message_chunk", text: JSON.stringify({ score, quote, right: "Есть идея.", gap: "Нет метрик." }) } }];
    }
    if (isReview(input) && !options.scriptReviews) {
      reviews.push(input);
      return [];
    }
    return undefined;
  };
  const { server } = await startTestServer(dirs, {
    now: () => now,
    drivers: (): AgentDriver => (driver ??= new FakeDriver(turns, { respond })),
    detectAgents: () => [{ id: "claude", label: "Claude Code", installed: true, detail: "/bin/claude" }],
  });
  let closed = false;
  cleanups.push(async () => {
    if (!closed) await server.close();
    closed = true;
  });
  await api(server, apiPaths.agentSettings, { method: "PUT", body: { agent: "claude" } });
  const call = await connectMcp(server);
  return { server, driver: () => driver!, scores, reviews, setDay: (d) => (now = day(d)), call };
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

async function say(server: RunningServer, text: string): Promise<ChatSnapshot> {
  expect((await api(server, apiPaths.chatMessages, { body: { text } })).status).toBe(202);
  return settledChat(server);
}

const sets = async (server: RunningServer): Promise<PracticeSetNode[]> => practiceSets(await get<CanvasSnapshot>(server, apiPaths.canvas));

const openRag = {
  topic: "RAG",
  prompt: "Как выбрать размер чанков для RAG?",
  type: "open",
  reference_answer: "По смыслу, 300–800 токенов с перекрытием, проверка на метриках ретривера.",
  hints: ["Начните с границ смысла."],
};

const singleEvals = {
  topic: "Evals",
  prompt: "Что считается галлюцинацией в RAG-ответе?",
  type: "single_choice",
  options: [
    { text: "Утверждение без опоры на документы", correct: true },
    { text: "Медленный ответ", correct: false },
  ],
};

async function withTarget(harness: Harness): Promise<Harness> {
  const saved = await harness.call("save_target", {
    role: "AI engineer",
    name: "AI Engineer",
    topics: [
      { name: "RAG", priority: "high" },
      { name: "Evals", priority: "medium" },
    ],
  });
  expect(saved.isError).toBe(false);
  return harness;
}

/** Places a set, answers each open Card with `answer`, submits, and waits for its grades. */
async function practise(h: Harness, title: string, answer = "Чанки по 500 токенов.", cards: unknown[] = [openRag]): Promise<{ setId: string; cardIds: string[] }> {
  const placed = await h.call("place_practice_set", { title, cards });
  expect(placed.isError, placed.text).toBe(false);
  const data = placed.data as { practice_set_id: string; cards: { card_id: string; type: string }[] };
  for (const c of data.cards) {
    const body = c.type === "open" ? { text: answer } : { choices: [0] };
    expect((await api(h.server, cardPaths.draft(c.card_id), { method: "PUT", body })).status).toBe(204);
  }
  expect((await api(h.server, practiceSetPaths.submit(data.practice_set_id))).status).toBe(202);
  await expect.poll(async () => (await sets(h.server)).find((s) => s.id === data.practice_set_id)?.data.status).toBe("graded");
  return { setId: data.practice_set_id, cardIds: data.cards.map((c) => c.card_id) };
}

/** Chat Agent sessions the fake agent opened, leaving out Grader sessions. */
const chatSessions = (h: Harness) => h.driver().sessions.filter((s) => !s.config.persona.startsWith("# Grader")).map((s) => s.action);

const contextUris = (input: TurnInput | undefined) => input?.context?.map((c) => c.uri) ?? [];
const briefingOf = (input: TurnInput | undefined) => {
  const text = input?.context?.find((c) => c.uri === "app://context/briefing")?.text;
  return text === undefined ? undefined : (JSON.parse(text.replace(/^<app_context name="briefing">\n/, "").replace(/\n<\/app_context>$/, "")) as Record<string, unknown>);
};

describe("Agent session rotation", () => {
  it("reviews a graded Practice set in its session, saves profile and Decision log updates only on confirmation, and continues in a fresh session from a Briefing", async () => {
    const h = await withTarget(
      await start(
        [
          [reply("Привет! Начнём.")],
          [
            reply("Сильная сторона: размер чанков. Слабое место: метрики. Приоритет: оценка ретривера."),
            tool("end_session", {
              summary: "Practice set on RAG: chunk size known, retriever metrics missing.",
              observations: ["Forgets retriever metrics"],
              profile: { weak_spots: ["Метрики ретривера"] },
              decisions: [{ decision: "Focus on retriever evaluation this week", reason: "Weakest area" }],
            }),
          ],
          [reply("Продолжим с метрик.")],
        ],
        { scriptReviews: true },
      ),
    );
    await say(h.server, "Привет");
    await practise(h, "Подборка на сегодня");
    let chat = await settledChat(h.server);

    // The app started the review in the same Agent session, without a Candidate message.
    const review = h.driver().prompts[1]!;
    expect(review.text).toContain('"ended_activity": "practice_set"');
    expect((review.hiddenState as HiddenState).activity).toMatchObject({ kind: "review" });
    expect(contextUris(review)).toEqual([skillUri("review"), expect.stringMatching(/^app:\/\/context\/practice-set\//)]);
    expect(chatSessions(h)).toEqual(["start"]);

    // The visible Chat: one thread with the grading summary, the review, and a proposal to confirm.
    expect(chat.messages.map((m) => m.role)).toEqual(["candidate", "interviewer", "interviewer", "interviewer", "interviewer"]);
    expect(chat.messages.some((m) => m.text.includes("activity_ended"))).toBe(false);
    const proposal = chat.messages.find((m) => m.proposal)!.proposal!;
    expect(proposal).toEqual({
      id: proposal.id,
      kind: "memory",
      status: "pending",
      items: ["Слабые места: Метрики ретривера", "Решение: Focus on retriever evaluation this week (Weakest area)"],
    });
    // Nothing is saved before the Candidate confirms.
    expect((await h.call("get_profile")).data).toMatchObject({ profile: null, recent_decisions: [], activity: null });

    expect((await api(h.server, proposalPaths.accept(proposal.id))).status).toBe(200);
    expect((await h.call("get_profile")).data).toMatchObject({
      profile: { weak_spots: ["Метрики ретривера"] },
      recent_decisions: [{ decision: "Focus on retriever evaluation this week", reason: "Weakest area" }],
    });
    chat = await get<ChatSnapshot>(h.server, apiPaths.chat);
    expect(chat.messages.find((m) => m.proposal)?.proposal?.status).toBe("accepted");
    expect((await api(h.server, proposalPaths.accept(proposal.id))).status).toBe(400);

    // The next Candidate message goes to a fresh Agent session that starts from the Briefing.
    chat = await say(h.server, "Что дальше?");
    expect(chatSessions(h)).toEqual(["start", "start"]);
    const next = h.driver().prompts[2]!;
    expect(contextUris(next)).toEqual(["app://context/briefing"]);
    const briefing = briefingOf(next)!;
    expect(briefing).toMatchObject({
      active_target: { name: "AI Engineer", role: "AI engineer" },
      weak_topics: [{ name: "RAG", priority: "high", mastery: 0 }],
      profile: { weak_spots: ["Метрики ретривера"] },
      recent_decisions: ["Focus on retriever evaluation this week"],
      recent_summaries: [{ summary: "Practice set on RAG: chunk size known, retriever metrics missing. Observations: Forgets retriever metrics" }],
    });
    expect(JSON.stringify(briefing.recent_chat)).toContain("Сильная сторона: размер чанков.");
    expect(chat.messages.at(-1)?.text).toBe("Продолжим с метрик.");
    // The Briefing goes out once per session.
    h.driver().script([reply("Да.")]);
    await say(h.server, "Ок");
    expect(contextUris(h.driver().prompts[3])).toEqual([]);
  });

  it("drops a declined proposal and refuses direct profile and Decision log saves during the review", async () => {
    const h = await withTarget(
      await start(
        [
          [
            tool("save_profile", { weak_spots: ["Метрики"] }),
            tool("end_session", { summary: "Short review.", decisions: [{ decision: "Skip Evals" }] }),
          ],
        ],
        { scriptReviews: true },
      ),
    );
    await practise(h, "Подборка");
    const chat = await settledChat(h.server);
    const reviewReply = chat.messages.find((m) => m.toolCalls.length);
    expect(reviewReply?.toolCalls.map((c) => [c.tool, c.status])).toEqual([
      ["save_profile", "failed"],
      ["end_session", "completed"],
    ]);
    const proposal = chat.messages.find((m) => m.proposal)!.proposal!;
    expect((await api(h.server, proposalPaths.decline(proposal.id))).status).toBe(200);
    expect((await h.call("get_profile")).data).toMatchObject({ profile: null, recent_decisions: [] });
    expect((await get<ChatSnapshot>(h.server, apiPaths.chat)).messages.find((m) => m.proposal)?.proposal?.status).toBe("declined");
  });

  it("rotates at the boundary when the Candidate moves on before the review ends, with an app summary", async () => {
    const h = await withTarget(await start([[reply("Первый ответ.")], [reply("Собираю новую подборку.")]]));
    await say(h.server, "Привет");
    await practise(h, "Первая");
    await settledChat(h.server);
    expect(h.reviews).toHaveLength(1);

    // «Подборка на сегодня» from the toolbar starts practice_set, abandoning the review.
    expect((await api(h.server, apiPaths.practiceRequest, { body: { kind: "today" } })).status).toBe(202);
    await settledChat(h.server);
    expect(chatSessions(h)).toEqual(["start", "start"]);
    const briefing = briefingOf(h.driver().prompts[1])!;
    const [summary] = briefing.recent_summaries as { summary: string }[];
    expect(summary?.summary).toMatch(/^The app ended the session \(activity:practice_set\) without an Interviewer summary\. Activities: practice_set \(completed\): Practice set "Первая"/);
    expect(contextUris(h.driver().prompts[1])).toEqual(["app://context/briefing", skillUri("practice_set")]);
  });

  it("closes a review whose turn failed, so the boundary rotation still happens", async () => {
    const h = await withTarget(
      await start([[reply("Привет.")], [{ fail: new Error("agent crashed") }], [reply("Продолжим.")]], { scriptReviews: true }),
    );
    await say(h.server, "Привет");
    await practise(h, "Подборка");
    await settledChat(h.server);
    expect((await h.call("get_profile")).data.activity).toBeNull();
    await say(h.server, "Что дальше?");
    // The failed review never delivered the grading result, so the fresh session gets it.
    expect(contextUris(h.driver().prompts[2])).toEqual(["app://context/briefing", expect.stringMatching(/^app:\/\/context\/practice-set\//)]);
  });

  it("closes a review the app stopped during, so after a restart nothing waits behind it", async () => {
    const dirs = makeTempDirs();
    const first = await withTarget(await start([[reply("Привет.")], [{ waitForCancel: true }]], { scriptReviews: true }, dirs));
    await say(first.server, "Привет");
    await practise(first, "Подборка");
    await expect.poll(async () => ((await first.call("get_profile")).data.activity as { kind: string } | null)?.kind).toBe("review");
    await first.server.close();

    const h = await start([[reply("Продолжим.")]], {}, dirs);
    expect((await h.call("get_profile")).data.activity).toBeNull();
    // The boundary rotation is no longer held: the next turn starts a fresh session.
    await say(h.server, "Что дальше?");
    expect(chatSessions(h)).toEqual(["start"]);
  });

  it("drops a queued review once another Activity took over, and never rotates mid Practice set", async () => {
    const h = await start([
      [reply("Расскажите о себе.")],
      [
        tool("save_target", { role: "AI engineer", topics: [{ name: "Evals", priority: "high" }] }),
        tool("finish_activity", { status: "completed", summary: "AI engineer target." }),
        tool("place_practice_set", { title: "Первая", cards: [singleEvals] }),
        reply("Цель готова, подборка на холсте."),
      ],
      [reply("Ответьте на карточку.")],
    ]);
    await say(h.server, "Привет");
    await say(h.server, "AI engineer");
    // The review queued at the onboarding boundary was dropped: the Practice set took over.
    expect((await h.call("get_profile")).data.activity).toMatchObject({ kind: "practice_set" });
    await say(h.server, "Что дальше?");
    expect(h.driver().prompts.map((p) => p.text)).toEqual(["Привет", "AI engineer", "Что дальше?"]);
    // The boundary rotation waits until the set is submitted.
    expect(chatSessions(h)).toEqual(["start"]);
  });

  it("acts on end_session and the review rules only for the Chat's own tool calls", async () => {
    const h = await withTarget(await start([[reply("Привет.")]]));
    await say(h.server, "Привет");
    // A hidden session (no Chat marker) cannot end the Chat's session.
    const ended = await h.call("end_session", { summary: "Not mine." });
    expect(ended.isError).toBe(true);
    expect(ended.text).toMatch(/^Only the Chat's Agent session can end itself\./);
    expect((await h.call("save_profile", { weak_spots: ["Метрики"] })).isError).toBe(false);
  });

  it("rotates on a new day, also after a restart, and keeps one continuous Chat", async () => {
    const dirs = makeTempDirs();
    const first = await start([[reply("Сегодня.")]], {}, dirs);
    await say(first.server, "Привет");
    await first.server.close();

    const h = await start([[reply("Новый день.")]], {}, dirs, 23);
    const chat = await say(h.server, "Доброе утро");
    // Yesterday's session is not loaded again: a fresh one starts from the Briefing.
    expect(chatSessions(h)).toEqual(["start"]);
    expect(briefingOf(h.driver().prompts[0])).toMatchObject({
      recent_summaries: [{ summary: expect.stringMatching(/^The app ended the session \(new_day\)/) as string }],
      recent_chat: [
        { role: "candidate", text: "Привет" },
        { role: "interviewer", text: "Сегодня." },
        { role: "candidate", text: "Доброе утро" },
      ],
    });
    expect(chat.messages.map((m) => m.text)).toEqual(["Привет", "Сегодня.", "Доброе утро", "Новый день."]);
  });

  it("rotates once the context usage crosses the threshold", async () => {
    const h = await start([
      [{ event: { type: "usage", used: 50_000, size: 200_000 } }, reply("Раз.")],
      [{ event: { type: "usage", used: 160_000, size: 200_000 } }, reply("Два.")],
      [reply("Три.")],
    ]);
    await say(h.server, "1");
    await say(h.server, "2");
    expect(chatSessions(h)).toHaveLength(1);
    await say(h.server, "3");
    expect(chatSessions(h)).toEqual(["start", "start"]);
    expect(briefingOf(h.driver().prompts[2])).toMatchObject({
      recent_summaries: [{ summary: expect.stringMatching(/^The app ended the session \(usage_threshold\)/) as string }],
    });
  });

  it("keeps every Briefing within its bound", async () => {
    const h = await withTarget(await start([[reply("x".repeat(5000))], [reply("y")]]));
    const long = "Очень длинная мысль ".repeat(200);
    for (let i = 0; i < 12; i++) expect((await h.call("record_decision", { decision: `${i} ${long}`.slice(0, 500) })).isError).toBe(false);
    await h.call("save_profile", { experience: long.slice(0, 2000), strengths: Array.from({ length: 30 }, () => long.slice(0, 200)) });
    for (let i = 0; i < 5; i++) await h.call("add_question", { topic: "RAG", prompt: `${i} ${long}`.slice(0, 4000) });
    await say(h.server, long.slice(0, 4000));
    h.setDay(23);
    await say(h.server, long.slice(0, 4000));
    const text = h.driver().prompts[1]?.context?.find((c) => c.uri === "app://context/briefing")?.text ?? "";
    expect(text.length).toBeGreaterThan(1000);
    expect(text.length).toBeLessThanOrEqual(maxBriefingChars);
    expect(briefingOf(h.driver().prompts[1])).toMatchObject({ active_target: { name: "AI Engineer" } });
  });
});

describe("Canvas auto-tidy and history", () => {
  it("moves older result Cards to history when a new set starts and on a new day", async () => {
    const h = await withTarget(await start());
    const a = await practise(h, "Первая");
    const b = await practise(h, "Вторая");
    // Placing the second set moved nothing yet: the first result Card stays as the latest result.
    const c = await h.call("place_practice_set", { title: "Третья", cards: [singleEvals] });
    const onCanvas = await sets(h.server);
    // The latest result Card stays collapsed beside the new set; older ones went to history.
    expect(onCanvas.map((s) => [s.data.title, s.collapsed])).toEqual([
      ["Вторая", true],
      ["Третья", false],
    ]);
    let history = await get<HistoryResponse>(h.server, apiPaths.history);
    expect(history.entries.map((e) => e.set.title)).toEqual(["Первая"]);
    expect(history.entries[0]?.set.cards[0]?.attempt).toMatchObject({ status: "graded" });
    // A Card in history cannot be retried on the Canvas, but can still be discussed.
    expect((await api(h.server, cardPaths.retry(a.cardIds[0]!))).body).toEqual({ error: "подборка уже в истории." });

    // A new day tidies the rest of the results; the unsubmitted set stays.
    h.setDay(23);
    expect((await sets(h.server)).map((s) => s.data.title)).toEqual(["Третья"]);
    history = await get<HistoryResponse>(h.server, apiPaths.history);
    expect(history.entries.map((e) => e.id)).toEqual([b.setId, a.setId]);
    expect(c.isError).toBe(false);
  });
});

describe("Disputed grades", () => {
  it("corrects an Attempt through MCP and recomputes Mastery and the Leitner schedule", async () => {
    const h = await withTarget(await start());
    h.scores.set("500", 1);
    const { setId, cardIds } = await practise(h, "Подборка", "Чанки по 500 токенов.", [openRag, singleEvals]);
    const before = (await h.call("get_progress")).data as { topics: { name: string; mastery: number | null }[]; due_questions: unknown[] };
    expect(before.topics.find((t) => t.name === "RAG")?.mastery).toBe(33);

    const corrected = await h.call("correct_grade", { card_id: cardIds[0], score: 3, reason: "«500 токенов» с перекрытием названы — Грейдер не учёл.", gap: "Стоит добавить метрики." });
    expect(corrected.isError, corrected.text).toBe(false);
    expect(corrected.data).toEqual({ card_id: cardIds[0], topic: "RAG", previous_score: 1, score: 3, max_score: 3, topic_mastery: 100 });

    const set = (await sets(h.server)).find((s) => s.id === setId)!;
    expect(set.data.cards[0]?.attempt).toMatchObject({ score: 3, gap: "Стоит добавить метрики.", corrected: { from: 1, reason: expect.stringContaining("500 токенов") as string } });
    expect(set.data.result).toMatchObject({ score: 6, max: 6 });
    // Score 3 moves the Question to box 2: Due in three days instead of tomorrow.
    h.setDay(23);
    expect(((await h.call("get_progress")).data as { due_questions: unknown[] }).due_questions).toEqual([]);
    h.setDay(25);
    expect(((await h.call("get_progress")).data as { due_questions: { box: number }[] }).due_questions.map((q) => q.box)).toEqual([2, 2]);

    // Test Cards are checked by the app; a score above the Hint ladder cap is refused.
    expect((await h.call("correct_grade", { card_id: cardIds[1], score: 0, reason: "Нет." })).text).toMatch(/^Test Cards are checked by the app/);
    expect((await h.call("correct_grade", { card_id: cardIds[0], score: 3, reason: "Снова." })).text).toMatch(/already has score 3/);
  });

  it("corrects the Attempt that counts, not a later retry", async () => {
    const h = await withTarget(await start());
    h.scores.set("500", 1);
    h.scores.set("перекрытием", 3);
    const { cardIds } = await practise(h, "Подборка", "Чанки по 500 токенов.");
    const cardId = cardIds[0]!;
    await api(h.server, cardPaths.retry(cardId));
    await api(h.server, cardPaths.draft(cardId), { method: "PUT", body: { text: "По смыслу, с перекрытием." } });
    await api(h.server, cardPaths.check(cardId));
    await expect.poll(async () => (await sets(h.server))[0]?.data.cards[0]?.attempt?.score).toBe(3);
    const mastery = async () => ((await h.call("get_progress")).data as { topics: { name: string; mastery: number | null }[] }).topics[0]?.mastery;
    expect(await mastery()).toBe(33);

    const corrected = await h.call("correct_grade", { card_id: cardId, score: 2, reason: "«500 токенов» — ключевая идея есть." });
    expect(corrected.data).toMatchObject({ previous_score: 1, score: 2, topic_mastery: 67 });
    expect(await mastery()).toBe(67);
    expect((await sets(h.server))[0]?.data.result).toMatchObject({ score: 2, max: 3 });
  });

  it("caps a corrected score by the Hint ladder and corrects a set already in history", async () => {
    const h = await withTarget(await start());
    const placed = await h.call("place_practice_set", { title: "С подсказкой", cards: [openRag] });
    const cardId = (placed.data as { cards: { card_id: string }[] }).cards[0]!.card_id;
    await api(h.server, cardPaths.hint(cardId));
    await api(h.server, cardPaths.draft(cardId), { method: "PUT", body: { text: "Чанки по 500 токенов." } });
    h.scores.set("500", 1);
    await api(h.server, practiceSetPaths.submit((placed.data as { practice_set_id: string }).practice_set_id));
    await expect.poll(async () => (await sets(h.server))[0]?.data.status).toBe("graded");
    h.setDay(23);
    expect(await sets(h.server)).toEqual([]);

    const over = await h.call("correct_grade", { card_id: cardId, score: 3, reason: "Полный ответ." });
    expect(over.isError).toBe(true);
    expect(over.text).toMatch(/capped at 2\.\nFix: Pass a score from 0 to 2\./);
    expect((await h.call("correct_grade", { card_id: cardId, score: 2, reason: "Перекрытие названо." })).isError).toBe(false);
    const history = await get<HistoryResponse>(h.server, apiPaths.history);
    expect(history.entries[0]?.set.cards[0]?.attempt).toMatchObject({ score: 2, maxScore: 2, corrected: { from: 1 } });
  });
});
