import fs from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import {
  apiPaths,
  bankPaths,
  cardPaths,
  practiceSetPaths,
  type BankResponse,
  type ChatSnapshot,
  type ProposedResponse,
  type SkillMapResponse,
  type TopicDetailResponse,
} from "@prepare-to-interview/shared";
import type { AgentDriver, SessionConfig, TurnInput } from "../src/agent/driver.ts";
import { FakeDriver, type FakeStep, type FakeTurn } from "../src/agent/fake-driver.ts";
import type { HiddenState } from "../src/interviewer/interviewer.ts";
import type { RunningServer } from "../src/server.ts";
import { authHeaders, makeTempDirs, startTestServer } from "./helpers.ts";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const isResearch = (config: SessionConfig) => config.persona.startsWith("# Research");
const isGrader = (config: SessionConfig) => config.persona.startsWith("# Grader");

interface Harness {
  server: RunningServer;
  dataDir: string;
  driver: () => FakeDriver;
  /** Research sessions: their config and the brief they received. */
  research: { config: SessionConfig; input: TurnInput }[];
  /** Turns the next Research sessions replay, in order; a function builds the turn from the brief. */
  researchTurns: (FakeTurn | ((brief: string) => FakeTurn))[];
  call: (name: string, args?: Record<string, unknown>) => Promise<{ isError: boolean; text: string; data: Record<string, unknown> }>;
}

async function start(turns: FakeTurn[] = [], dirs = makeTempDirs()): Promise<Harness> {
  const research: Harness["research"] = [];
  const researchTurns: Harness["researchTurns"] = [];
  const respond = (config: SessionConfig, input: TurnInput): FakeTurn | undefined => {
    if (isGrader(config)) return [reply(JSON.stringify({ score: 2, quote: input.text.match(/<answer>\n(\S+)/)?.[1] ?? "", right: "Верно.", gap: "Мало деталей." }))];
    if (!isResearch(config)) return undefined;
    research.push({ config, input });
    const next = researchTurns.shift() ?? [reply("Ничего не нашлось.")];
    return typeof next === "function" ? next(input.text) : next;
  };
  const driver = new FakeDriver(turns, { respond });
  const { server } = await startTestServer(dirs, {
    now: () => new Date(2026, 9, 22, 12, 0, 0),
    drivers: (): AgentDriver => driver,
    detectAgents: () => [{ id: "claude", label: "Claude Code", installed: true, detail: "/bin/claude" }],
  });
  cleanups.push(() => server.close());
  cleanups.push(dirs.cleanup);
  await api(server, apiPaths.agentSettings, { method: "PUT", body: { agent: "claude" } });
  const client = new Client({ name: "test-agent", version: "0.0.0" });
  const headers = Object.fromEntries(server.mcpServer.headers.map((h) => [h.name, h.value]));
  await client.connect(new StreamableHTTPClientTransport(new URL(server.mcpServer.url), { requestInit: { headers } }));
  cleanups.push(() => client.close());
  const call: Harness["call"] = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    return { isError: result.isError === true, text: (result.content as { text: string }[])[0]?.text ?? "", data: result.structuredContent as Record<string, unknown> };
  };
  return { server, dataDir: dirs.dataDir, driver: () => driver, research, researchTurns, call };
}

async function api(server: RunningServer, path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; body: unknown }> {
  const res = await fetch(new URL(path, server.url), {
    method: init.method ?? "POST",
    headers: { ...authHeaders(server), "Content-Type": "application/json" },
    ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as unknown) : undefined };
}

const get = async <T>(server: RunningServer, path: string) => (await api(server, path, { method: "GET" })).body as T;
const tool = (name: string, args: Record<string, unknown>): FakeStep => ({ callTool: { server: "interview", tool: name, arguments: args } });
const reply = (text: string): FakeStep => ({ event: { type: "message_chunk", text } });

const target = {
  role: "Backend developer",
  name: "Backend Go",
  vacancies: [{ title: "Go-разработчик в финтех", text: "Требования: PostgreSQL, индексы, транзакции, Kafka." }],
  topics: [
    { name: "PostgreSQL", priority: "high" },
    { name: "Go concurrency", priority: "medium" },
  ],
};

async function withTarget(turns: FakeTurn[] = []) {
  const h = await start(turns);
  expect((await h.call("save_target", target)).isError).toBe(false);
  return h;
}

async function archive(h: Harness, content: string, extra: Record<string, unknown> = {}): Promise<string> {
  const result = await h.call("archive_source", { kind: "article", url: "https://habr.com/ru/articles/1/", title: "Вопросы про PostgreSQL", content, ...extra });
  expect(result.isError, result.text).toBe(false);
  return (result.data.source as { source_id: string }).source_id;
}

const indexQuestion = (sourceId: string, prompt = "Какие типы индексов есть в PostgreSQL?") => ({
  topic: "PostgreSQL",
  prompt,
  type: "open",
  reference_answer: "B-tree по умолчанию, Hash, GiST, SP-GiST, GIN, BRIN; выбор зависит от операторов запроса.",
  hints: ["Начните с индекса по умолчанию."],
  source_ids: [sourceId],
});

/** The archived vacancy's source id, from a Research brief. */
const vacancySource = (brief: string) => /<source_data source_id="([\w-]+)" kind="vacancy/.exec(brief)![1]!;

const proposed = (h: Harness) => get<ProposedResponse>(h.server, bankPaths.proposed);
const skillMap = (h: Harness) => get<SkillMapResponse>(h.server, bankPaths.skillMap);

describe("Proposed queue", () => {
  it("keeps Research output out of the bank until the Candidate approves it, then adds its Topic to the target", async () => {
    const h = await withTarget();
    const sourceId = await archive(h, "PostgreSQL поддерживает индексы B-tree, Hash, GiST, GIN и BRIN.");
    const result = await h.call("propose_questions", {
      topics: [{ name: "Kafka", priority: "high", reason: "Названа в 3 из 4 вакансий", source_ids: [sourceId] }],
      questions: [
        indexQuestion(sourceId),
        { topic: "Kafka", prompt: "Что гарантирует consumer group в Kafka?", type: "single_choice", source_ids: [sourceId], options: [{ text: "Каждую партицию читает один consumer группы", correct: true }, { text: "Порядок между партициями", correct: false }] },
      ],
    });
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toContain("Questions: 2 proposed");

    const queue = await proposed(h);
    expect(queue.count).toBe(3);
    expect(queue.batches).toHaveLength(1);
    const batch = queue.batches[0]!;
    expect(batch.id).toBeNull();
    expect(batch.targetName).toBe("Backend Go");
    expect(batch.topics.map((t) => [t.name, t.priority, t.reason])).toEqual([["Kafka", "high", "Названа в 3 из 4 вакансий"]]);
    expect(batch.questions.map((q) => q.prompt)).toEqual(["Какие типы индексов есть в PostgreSQL?", "Что гарантирует consumer group в Kafka?"]);
    expect(batch.questions[0]!.sources).toEqual([expect.objectContaining({ id: sourceId, kind: "article", url: "https://habr.com/ru/articles/1/", title: "Вопросы про PostgreSQL" })]);
    expect((await skillMap(h)).proposed).toBe(3);
    // A Topic named only by a proposal stays out of the bank's Topic list until approved.
    expect((await get<{ topics: string[] }>(h.server, apiPaths.topics)).topics).toEqual(["Go concurrency", "PostgreSQL"]);

    // Proposed Questions stay out of practice and progress.
    const indexId = batch.questions[0]!.id;
    const refused = await h.call("place_practice_set", { title: "Тест", cards: [{ question_id: indexId }] });
    expect(refused.isError).toBe(true);
    expect((await skillMap(h)).topics.find((t) => t.name === "PostgreSQL")?.questions).toBe(0);
    expect((await skillMap(h)).topics.map((t) => t.name)).toEqual(["PostgreSQL", "Go concurrency"]);

    // Approving the Kafka Question brings its Proposed Topic into the target.
    const kafkaId = batch.questions[1]!.id;
    const approved = await api(h.server, bankPaths.review, { body: { action: "approve", questions: [kafkaId] } });
    expect(approved.body).toEqual({ approved: 2, rejected: 0, proposed: 1 });
    const map = await skillMap(h);
    expect(map.topics.map((t) => [t.name, t.priority, t.questions, t.mastery])).toEqual([
      ["PostgreSQL", "high", 0, null],
      ["Go concurrency", "medium", 0, null],
      ["Kafka", "high", 1, null],
    ]);
    expect(map.proposed).toBe(1);
    expect((await get<{ topics: string[] }>(h.server, apiPaths.topics)).topics).toEqual(["Go concurrency", "Kafka", "PostgreSQL"]);

    // Rejected Questions leave the queue and are not proposed again.
    expect((await api(h.server, bankPaths.review, { body: { action: "reject", questions: [indexId] } })).body).toEqual({ approved: 0, rejected: 1, proposed: 0 });
    const again = await h.call("propose_questions", { questions: [indexQuestion(sourceId, "какие типы индексов есть в postgresql")] });
    expect(again.data.questions).toEqual([expect.objectContaining({ outcome: "rejected_before", status: "rejected", question_id: indexId })]);
    expect((await proposed(h)).count).toBe(0);
  });

  it("rejects a Proposed Topic together with its batch's Questions, and approves whole batches or everything", async () => {
    const h = await withTarget();
    const sourceId = await archive(h, "Kafka: партиции, consumer groups, offsets. Redis: кэширование.");
    await h.call("propose_questions", {
      topics: [{ name: "Kafka", priority: "medium", source_ids: [sourceId] }],
      questions: [
        { topic: "Kafka", prompt: "Что такое offset в Kafka?", reference_answer: "Позиция сообщения в партиции.", source_ids: [sourceId] },
        { topic: "Redis", prompt: "Когда кэш в Redis вредит?", reference_answer: "При частой инвалидации и рассинхроне.", source_ids: [sourceId] },
      ],
    });
    let queue = await proposed(h);
    // A Question in a Topic the target lacks proposes that Topic too.
    expect(queue.batches[0]!.topics.map((t) => t.name).sort()).toEqual(["Kafka", "Redis"]);
    const kafka = queue.batches[0]!.topics.find((t) => t.name === "Kafka")!;
    expect((await api(h.server, bankPaths.review, { body: { action: "reject", topics: [kafka.id] } })).body).toEqual({ approved: 0, rejected: 2, proposed: 2 });
    queue = await proposed(h);
    expect(queue.batches[0]!.questions.map((q) => q.prompt)).toEqual(["Когда кэш в Redis вредит?"]);

    // Questions in a Topic the Candidate rejected for the target are not proposed again.
    const again = await h.call("propose_questions", { questions: [{ topic: "kafka", prompt: "Зачем нужны партиции?", reference_answer: "Для параллелизма.", source_ids: [sourceId] }] });
    expect(again.data.questions).toEqual([expect.objectContaining({ outcome: "topic_rejected", question_id: null })]);

    expect((await api(h.server, bankPaths.review, { body: { action: "approve", all: true } })).body).toEqual({ approved: 2, rejected: 0, proposed: 0 });
    expect((await skillMap(h)).topics.map((t) => t.name)).toEqual(["PostgreSQL", "Go concurrency", "Redis"]);
    const bank = await get<BankResponse>(h.server, bankPaths.bank);
    expect(bank.topics.map((t) => [t.name, t.questions.map((q) => q.prompt)])).toEqual([["Redis", ["Когда кэш в Redis вредит?"]]]);
  });

  it("merges duplicates into the bank Question they repeat, joining their Sources", async () => {
    const h = await withTarget();
    const first = await archive(h, "Первая статья про индексы.");
    const second = await archive(h, "Вторая статья про индексы.", { url: "https://www.postgresql.org/docs/current/indexes-types.html" });
    const own = await h.call("add_question", { topic: "PostgreSQL", prompt: "Что такое индекс в PostgreSQL?" });
    const ownId = own.data.question_id as string;

    const result = await h.call("propose_questions", {
      questions: [
        indexQuestion(first, "Что такое индекс в Postgresql"),
        indexQuestion(first),
        indexQuestion(second, "  какие ТИПЫ индексов есть в PostgreSQL ? "),
        { ...indexQuestion(second, "Какие типы индексов есть в PostgreSQL?"), topic: "Базы данных" },
      ],
    });
    expect(result.isError, result.text).toBe(false);
    const outcomes = (result.data.questions as { outcome: string; status: string; question_id: string }[]).map((q) => [q.outcome, q.status]);
    expect(outcomes).toEqual([
      ["merged", "active"],
      ["proposed", "proposed"],
      ["merged", "proposed"],
      ["merged", "proposed"],
    ]);
    expect((result.data.questions as { question_id: string }[])[0]!.question_id).toBe(ownId);

    const queue = await proposed(h);
    expect(queue.batches[0]!.questions).toHaveLength(1);
    expect(queue.batches[0]!.questions[0]!.sources.map((s) => s.id).sort()).toEqual([first, second].sort());
    // The active bank Question got the Source; its content stays the Candidate's.
    const postgres = (await skillMap(h)).topics.find((t) => t.name === "PostgreSQL")!;
    const detail = await get<TopicDetailResponse>(h.server, bankPaths.topic(postgres.topicId));
    const merged = detail.questions.find((q) => q.id === ownId)!;
    expect(merged.sources.map((s) => s.id)).toEqual([first]);
    expect(merged.referenceAnswer).toBeNull();
    // "Базы данных" was only named by a merged duplicate: nothing about it waits for review.
    expect(queue.batches[0]!.topics).toEqual([]);
  });

  it("refuses Questions without Sources or with unknown ones", async () => {
    const h = await withTarget();
    const noSources = await h.call("propose_questions", { questions: [{ ...indexQuestion("x"), source_ids: [] }] });
    expect(noSources.isError).toBe(true);
    const unknown = await h.call("propose_questions", { questions: [indexQuestion("no-such-source")] });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toContain("Fix: Pass source_id values that archive_source returned.");
    const noReference = await h.call("propose_questions", { questions: [{ ...indexQuestion(await archive(h, "Текст.")), reference_answer: undefined }] });
    expect(noReference.isError).toBe(true);
    expect((await proposed(h)).count).toBe(0);
  });
});

describe("Research archive and search", () => {
  it("archives raw Sources once with URL, fetch time, hash, and kind, and keeps notes that link to them", async () => {
    const h = await withTarget();
    const content = "PostgreSQL: B-tree подходит для сравнений и сортировки.";
    const first = await h.call("archive_source", { kind: "documentation", url: "https://www.postgresql.org/docs/", title: "Docs", content, fetched_at: "2026-10-21T09:30:00+03:00" });
    const again = await h.call("archive_source", { kind: "documentation", url: "https://www.postgresql.org/docs/", content });
    expect(again.data.duplicate).toBe(true);
    expect((again.data.source as { source_id: string }).source_id).toBe((first.data.source as { source_id: string }).source_id);
    const sourceId = (first.data.source as { source_id: string }).source_id;

    const file = path.join(h.dataDir, "research", first.data.archive_path as string);
    const text = fs.readFileSync(file, "utf8");
    expect(text).toContain("kind: documentation");
    expect(text).toContain('url: "https://www.postgresql.org/docs/"');
    expect(text).toContain("fetched_at: 2026-10-21T06:30:00.000Z");
    expect(text).toContain("sha256: ");
    expect(text.endsWith(content)).toBe(true);
    expect(fs.statSync(file).mode & 0o222).toBe(0);

    const note = await h.call("save_note", { title: "PostgreSQL: индексы", body: "Вакансии спрашивают про B-tree и GIN.", source_ids: [sourceId] });
    expect(note.isError, note.text).toBe(false);
    const notePath = path.join(h.dataDir, "research", note.data.path as string);
    expect(fs.readFileSync(notePath, "utf8")).toContain(`(https://www.postgresql.org/docs/) · documentation · archived [${sourceId}](../${first.data.archive_path as string})`);
    const updated = await h.call("save_note", { title: "PostgreSQL: индексы", body: "Обновлено: ещё BRIN.", source_ids: [await archive(h, "BRIN для больших таблиц.")] });
    expect(updated.data).toMatchObject({ updated: true, sources: 2, slug: note.data.slug });
    expect((await h.call("save_note", { title: "Без ссылок", body: "Текст", source_ids: ["nope"] })).isError).toBe(true);
    // Titles that share a slug keep separate notes.
    const cpp = await h.call("save_note", { title: "C++: память", body: "RAII.", source_ids: [sourceId] });
    const csharp = await h.call("save_note", { title: "C#: память", body: "GC.", source_ids: [sourceId] });
    expect(csharp.data.updated).toBe(false);
    expect(csharp.data.slug).not.toBe(cpp.data.slug);
    expect(fs.readFileSync(path.join(h.dataDir, "research", cpp.data.path as string), "utf8")).toContain("RAII.");
  });

  it("returns ranked hits in Russian and English over Questions, Reference answers, notes, Sources, and transcripts", async () => {
    const h = await withTarget([[reply("Обсудим изоляцию транзакций: начнём с уровня Read Committed.")]]);
    const sourceId = await archive(h, "Партиционирование таблиц в PostgreSQL ускоряет запросы к большим таблицам.", { url: "https://example.com/partitioning" });
    await h.call("add_question", { topic: "PostgreSQL", prompt: "Какие индексы бывают в PostgreSQL?", reference_answer: "B-tree, Hash, GIN, BRIN." });
    await h.call("add_question", { topic: "PostgreSQL", prompt: "How do indexes speed up queries?" });
    await h.call("add_question", { topic: "Go concurrency", prompt: "Что такое горутина?", reference_answer: "Лёгкий поток, которым управляет рантайм Go; индексы тут ни при чём." });
    await h.call("save_note", { title: "Ёмкость кластера", body: "Заметка о ёмкости и индексах.", source_ids: [sourceId] });
    await api(h.server, apiPaths.chatMessages, { body: { text: "Расскажи про уровни изоляции транзакций" } });
    await expect.poll(async () => (await get<ChatSnapshot>(h.server, apiPaths.chat)).busy).toBe(false);

    const search = async (q: string, kinds?: string[]) => {
      const r = await h.call("search", { query: q, ...(kinds && { kinds }) });
      expect(r.isError, r.text).toBe(false);
      return r.data.hits as { kind: string; title: string; snippet: string; detail: string | null }[];
    };
    // Russian word forms find each other; the prompt match ranks above a Reference answer match.
    const ru = await search("индексов", ["question"]);
    expect(ru.map((hit) => hit.title)).toEqual(["Какие индексы бывают в PostgreSQL?", "Что такое горутина?"]);
    expect(ru[0]!.snippet).toContain("[индексы]");
    expect(ru[0]!.detail).toBe("active · PostgreSQL");
    expect((await search("index", ["question"])).map((hit) => hit.title)).toEqual(["How do indexes speed up queries?"]);
    // ё and е match, case is folded.
    expect((await search("ЕМКОСТЬ")).map((hit) => [hit.kind, hit.title])).toEqual([["note", "Ёмкость кластера"]]);
    expect((await search("партиционирование")).map((hit) => [hit.kind, hit.detail])).toEqual([["source", "https://example.com/partitioning"]]);
    const transcripts = await search("изоляции транзакций", ["transcript"]);
    expect(transcripts.map((hit) => hit.snippet)).toEqual([expect.stringContaining("[изоляции]"), expect.stringContaining("[изоляцию]")]);
    expect(await search("?!")).toEqual([]);

    const rest = await get<{ hits: { kind: string }[] }>(h.server, `${bankPaths.search}?q=${encodeURIComponent("горутина")}`);
    expect(rest.hits.map((hit) => hit.kind)).toEqual(["question"]);
  });
});

describe("Research Activity", () => {
  it("runs in its own hidden Agent session, proposes with Sources, and reports to the Chat", async () => {
    const h = await withTarget([
      [tool("start_activity", { kind: "practice_set" }), tool("start_research", { focus: "PostgreSQL для Middle", materials: "Мои заметки: спросили про VACUUM." }), reply("Запустил исследование.")],
      [reply("Вижу итоги исследования.")],
    ]);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    h.researchTurns.push((brief) => [
      { waitFor: gate },
      tool("archive_source", { kind: "article", url: "https://habr.com/ru/articles/2/", title: "VACUUM", content: "VACUUM освобождает место после UPDATE и DELETE." }),
      tool("search", { query: "VACUUM" }),
      tool("propose_questions", { questions: [{ topic: "PostgreSQL", prompt: "Зачем нужен VACUUM?", reference_answer: "Убирает мёртвые версии строк.", source_ids: [vacancySource(brief)] }] }),
      reply("Посмотрел Хабр и вакансию: предложил вопрос про VACUUM."),
    ]);
    await api(h.server, apiPaths.chatMessages, { body: { text: "Найди вопросы по PostgreSQL" } });
    await expect.poll(() => h.research.length).toBe(1);
    await expect.poll(async () => (await get<ChatSnapshot>(h.server, apiPaths.chat)).busy).toBe(false);

    const session = h.research[0]!;
    expect(session.config.persona).toContain("Market guide: the Russian-speaking IT market");
    expect(session.config.allowedBuiltins).toEqual(["web_fetch", "web_search"]);
    expect(session.config.mcpServers.map((s) => s.name)).toEqual(["interview"]);
    // The hidden session gathers and proposes; it cannot approve or touch the Chat's work.
    const researchClient = new Client({ name: "research-agent", version: "0.0.0" });
    const researchServer = session.config.mcpServers[0]!;
    await researchClient.connect(
      new StreamableHTTPClientTransport(new URL(researchServer.url), { requestInit: { headers: Object.fromEntries(researchServer.headers.map((x) => [x.name, x.value])) } }),
    );
    cleanups.push(() => researchClient.close());
    expect((await researchClient.listTools()).tools.map((t) => t.name).sort()).toEqual(["archive_source", "propose_questions", "save_note", "search"]);
    expect((await researchClient.callTool({ name: "review_proposed", arguments: { action: "approve", all: true } })).isError).toBe(true);
    // The brief fences the vacancy and the Candidate's material as archived data.
    expect(session.input.text).toContain("<focus>\nPostgreSQL для Middle\n</focus>");
    expect(session.input.text).toMatch(/<source_data source_id="[\w-]+" kind="vacancy: Go-разработчик в финтех">\nТребования: PostgreSQL, индексы, транзакции, Kafka\.\n<\/source_data>/);
    expect(session.input.text).toMatch(/<source_data source_id="[\w-]+" kind="candidate_material">\nМои заметки: спросили про VACUUM\.\n<\/source_data>/);

    // While Research runs, the Chat keeps its own Activity and sees Research as running.
    const second = await h.call("start_research", {});
    expect(second.isError).toBe(true);
    expect(second.text).toContain("already running");
    await api(h.server, apiPaths.chatMessages, { body: { text: "Как дела?" } });
    await expect.poll(async () => (await get<ChatSnapshot>(h.server, apiPaths.chat)).busy).toBe(false);
    const state = h.driver().prompts[1]!.hiddenState as HiddenState;
    expect(state.activity?.kind).toBe("practice_set");
    expect(state.research).toEqual({ running: true, proposed_waiting: 0 });

    release();
    await expect.poll(async () => (await get<ChatSnapshot>(h.server, apiPaths.chat)).messages.at(-1)?.text).toBe(
      "Исследование завершено: предложено (вопросов — 1). Одобрите или отклоните их во вкладке «Предложено» (B).",
    );
    const queue = await proposed(h);
    expect(queue.batches).toHaveLength(1);
    expect(queue.batches[0]).toMatchObject({ running: false, summary: "Посмотрел Хабр и вакансию: предложил вопрос про VACUUM.", targetName: "Backend Go" });
    expect(queue.batches[0]!.questions[0]!.sources.map((s) => s.kind)).toEqual(["vacancy"]);

    // The next Chat turn hears the result once.
    h.driver().script([reply("Ок.")]);
    await api(h.server, apiPaths.chatMessages, { body: { text: "Что нашлось?" } });
    await expect.poll(async () => (await get<ChatSnapshot>(h.server, apiPaths.chat)).busy).toBe(false);
    await api(h.server, apiPaths.chatMessages, { body: { text: "Ещё раз?" } });
    await expect.poll(async () => (await get<ChatSnapshot>(h.server, apiPaths.chat)).busy).toBe(false);
    const contexts = h.driver().prompts.map((p) => (p.context ?? []).map((c) => c.uri).filter((uri) => uri.startsWith("app://context/research/")));
    expect(contexts.slice(2)).toEqual([[`app://context/research/${queue.batches[0]!.id!}`], []]);
    const block = h.driver().prompts[2]!.context!.find((c) => c.uri.startsWith("app://context/research/"))!;
    expect(block.text).toContain('"proposed_questions": 1');
  });

  it("auto-approves a batch when the Candidate asked for it", async () => {
    const h = await withTarget();
    h.researchTurns.push((brief) => [
      tool("propose_questions", {
        topics: [{ name: "Kafka", priority: "high", source_ids: [vacancySource(brief)] }],
        questions: [{ topic: "Kafka", prompt: "Что такое партиция в Kafka?", reference_answer: "Упорядоченный лог внутри топика.", source_ids: [vacancySource(brief)] }],
      }),
      reply("Готово."),
    ]);
    const started = await h.call("start_research", { auto_approve: true });
    expect(started.isError, started.text).toBe(false);
    await expect
      .poll(async () => (await get<ChatSnapshot>(h.server, apiPaths.chat)).messages.at(-1)?.text)
      .toBe("Исследование завершено: в банк добавлено (вопросов — 1, тем — 1). Посмотреть можно на карте навыков (K).");
    expect((await proposed(h)).count).toBe(0);
    expect((await skillMap(h)).topics.find((t) => t.name === "Kafka")).toMatchObject({ priority: "high", questions: 1 });

    // A batch that finds nothing says so.
    await h.call("start_research", {});
    await expect.poll(async () => (await get<ChatSnapshot>(h.server, apiPaths.chat)).messages.at(-1)?.text).toBe("Исследование завершено: нового для банка не нашлось.");
  });

  it("tells the Candidate when Research cannot start without an agent session", async () => {
    const h = await withTarget();
    h.driver().sessionFailures.push(Object.assign(new Error("Authentication required"), { code: -32000 }));
    expect((await h.call("start_research", {})).isError).toBe(false);
    await expect.poll(async () => (await get<ChatSnapshot>(h.server, apiPaths.chat)).messages.at(-1)?.text).toBe(
      "Исследование прервалось: Claude Code не авторизован — войдите в него в терминале. То, что агент успел предложить, ждёт во вкладке «Предложено» (B).",
    );
    // The failed batch no longer blocks the next one.
    expect((await h.call("start_research", {})).isError).toBe(false);
  });

  it("abandons a batch the app stopped during, so the next one can start", async () => {
    const dirs = makeTempDirs();
    const first = await start([], dirs);
    expect((await first.call("save_target", target)).isError).toBe(false);
    first.researchTurns.push([{ waitForCancel: true }]);
    expect((await first.call("start_research", {})).isError).toBe(false);
    await expect.poll(() => first.research.length).toBe(1);
    await first.server.close();

    const second = await start([], dirs);
    const queue = await proposed(second);
    expect(queue.count).toBe(0);
    expect((await second.call("start_research", {})).isError).toBe(false);
    await expect.poll(async () => (await get<ChatSnapshot>(second.server, apiPaths.chat)).messages.at(-1)?.text).toBe("Исследование завершено: нового для банка не нашлось.");
  });

  it("needs a Preparation target", async () => {
    const h = await start();
    const result = await h.call("start_research", {});
    expect(result.isError).toBe(true);
    expect(result.text).toContain("Fix: Run onboarding first");
  });
});

describe("Skill map", () => {
  it("shows Mastery, Due, untouched Topics, readiness, and a Topic's Questions with Attempt history", async () => {
    const h = await withTarget();
    const placed = await h.call("place_practice_set", {
      title: "PostgreSQL",
      cards: [
        { topic: "PostgreSQL", prompt: "Что такое MVCC?", type: "open", reference_answer: "Версии строк для параллельных транзакций." },
        { topic: "PostgreSQL", prompt: "Индекс по умолчанию?", type: "single_choice", options: [{ text: "B-tree", correct: true }, { text: "Hash", correct: false }] },
      ],
    });
    expect(placed.isError, placed.text).toBe(false);
    const [open, test] = (placed.data.cards as { card_id: string }[]).map((c) => c.card_id);
    await api(h.server, cardPaths.draft(open!), { method: "PUT", body: { text: "Версии строк." } });
    await api(h.server, cardPaths.draft(test!), { method: "PUT", body: { choices: [0] } });
    await api(h.server, practiceSetPaths.submit(placed.data.practice_set_id as string));
    await expect.poll(async () => (await skillMap(h)).readiness).not.toBeNull();

    const map = await skillMap(h);
    expect(map).toMatchObject({ targetName: "Backend Go", readiness: 50, due: 0, proposed: 0 });
    const postgres = map.topics.find((t) => t.name === "PostgreSQL")!;
    expect(postgres).toMatchObject({ mastery: (2 / 3 + 1) / 2, questions: 2, due: 0, priority: "high" });
    expect(map.topics.find((t) => t.name === "Go concurrency")).toMatchObject({ mastery: null, questions: 0 });

    const detail = await get<TopicDetailResponse>(h.server, bankPaths.topic(postgres.topicId));
    expect(detail.topic).toMatchObject({ name: "PostgreSQL", due: 0 });
    const mvcc = detail.questions.find((q) => q.prompt === "Что такое MVCC?")!;
    expect(mvcc).toMatchObject({ type: "open", status: "active", verified: false, box: 1, dueOn: "2026-10-23", due: false });
    expect(mvcc.attempts).toEqual([
      expect.objectContaining({ mode: "training", status: "graded", score: 2, maxScore: 3, quote: "Версии", strengths: "Верно.", gap: "Мало деталей.", answer: "Версии строк." }),
    ]);
    expect(detail.questions.find((q) => q.type === "single_choice")!.attempts).toEqual([expect.objectContaining({ score: 3 })]);
    expect((await api(h.server, bankPaths.topic("nope"), { method: "GET" })).status).toBe(404);
  });

  it("lets the Candidate edit a Reference answer and mark it verified", async () => {
    const h = await withTarget();
    const own = await h.call("add_question", { topic: "PostgreSQL", prompt: "Что делает EXPLAIN ANALYZE?" });
    const id = own.data.question_id as string;
    const refused = await api(h.server, bankPaths.reference(id), { method: "PUT", body: { verified: true } });
    expect(refused).toEqual({ status: 400, body: { error: "сначала напишите эталонный ответ." } });
    const saved = await api(h.server, bankPaths.reference(id), { method: "PUT", body: { referenceAnswer: "Выполняет запрос и показывает реальный план с временем." } });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ referenceAnswer: "Выполняет запрос и показывает реальный план с временем.", verified: false });
    expect((await api(h.server, bankPaths.reference(id), { method: "PUT", body: { verified: true } })).body).toMatchObject({ verified: true });
    const cleared = await api(h.server, bankPaths.reference(id), { method: "PUT", body: { referenceAnswer: "" } });
    expect(cleared.status).toBe(400);
    expect((await api(h.server, bankPaths.reference("nope"), { method: "PUT", body: { verified: false } })).status).toBe(404);
    // The edit reaches the Grader's material and search.
    expect((await h.call("search", { query: "реальный план" })).data.hits).toEqual([expect.objectContaining({ kind: "question", title: "Что делает EXPLAIN ANALYZE?" })]);
  });

  it("asks the Interviewer for Research from the toolbar", async () => {
    const h = await withTarget([[reply("Начинаю.")]]);
    const res = await api(h.server, bankPaths.researchRequest);
    expect(res.status).toBe(202);
    await expect.poll(async () => (await get<ChatSnapshot>(h.server, apiPaths.chat)).messages.map((m) => m.text)).toContain(
      "Хочу, чтобы ты исследовал темы и вопросы для моей цели подготовки.",
    );
  });
});
