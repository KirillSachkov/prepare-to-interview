import fs from "node:fs";
import path from "node:path";
import { upgradeWebSocket } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  apiPaths,
  cardPaths,
  maxAnswerLength,
  practiceSetPaths,
  proposalPaths,
  type AddQuestionResponse,
  type HistoryResponse,
  type AgentsResponse,
  type ProgressResponse,
  type ServerEvent,
  type TopicsResponse,
} from "@prepare-to-interview/shared";
import type { AgentDetector } from "../agent/detect.ts";
import { UnknownNodeError, type Canvas } from "../canvas/canvas.ts";
import { ChatBusyError, type Chat } from "../chat/chat.ts";
import { revealModes } from "../db/schema.ts";
import { DomainError, type Domain } from "../domain/domain.ts";
import type { Practice } from "../domain/practice.ts";
import type { Continuity } from "../interviewer/continuity.ts";
import type { PracticeRunner } from "../interviewer/practice-runner.ts";
import type { EventBus } from "../events.ts";
import type { McpHandler } from "../mcp/handler.ts";
import { agentSettingsUpdate, type Settings } from "../settings/settings.ts";
import { hostGuard, tokenGuard } from "./access.ts";

export interface AppDeps {
  token: string;
  allowedHosts: () => ReadonlySet<string>;
  canvas: Canvas;
  chat: Chat;
  domain: Domain;
  practice: Practice;
  runner: PracticeRunner;
  continuity: Continuity;
  settings: Settings;
  detectAgents: AgentDetector;
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
    const parsed = layoutUpdateRequest.safeParse(await readJson(c.req.raw));
    if (!parsed.success) return c.text(`Invalid layout update: ${z.prettifyError(parsed.error)}`, 400);
    try {
      return c.json({ layouts: deps.canvas.updateLayout(parsed.data.updates) });
    } catch (error) {
      if (error instanceof UnknownNodeError) return c.text(error.message, 404);
      throw error;
    }
  });

  app.get(apiPaths.chat, (c) => c.json(deps.chat.snapshot()));
  app.post(apiPaths.chatMessages, async (c) => {
    const body = chatSendRequest.safeParse(await readJson(c.req.raw));
    if (!body.success) return c.json({ error: "Send {\"text\": \"<1-20000 characters>\"}." }, 400);
    try {
      return c.json({ message: deps.chat.send(body.data.text) }, 202);
    } catch (error) {
      if (error instanceof ChatBusyError) return c.json({ error: error.message }, 409);
      throw error;
    }
  });
  app.post(apiPaths.chatStop, async (c) => {
    await deps.chat.stop();
    return c.body(null, 204);
  });

  app.get(apiPaths.targets, (c) => c.json(deps.domain.targets()));
  app.put(apiPaths.activeTarget, async (c) => {
    const body = switchTargetRequest.safeParse(await readJson(c.req.raw));
    if (!body.success) return c.json({ error: "Не указана цель подготовки." }, 400);
    return domainResult(() => c.json(deps.domain.switchTarget(body.data.targetId)));
  });
  app.post(apiPaths.newTarget, (c) => {
    if (deps.chat.busy) return c.json({ error: chatBusyMessage }, 409);
    deps.domain.startActivity("onboarding", { newTarget: true });
    return sendToChat(() => deps.chat.send(newTargetMessage));
  });
  app.get(apiPaths.topics, (c) => c.json({ topics: deps.domain.topicNames() } satisfies TopicsResponse));
  app.post(apiPaths.questions, async (c) => {
    const body = addQuestionRequest.safeParse(await readJson(c.req.raw));
    if (!body.success) return c.json({ error: "Укажите тему (до 120 символов) и текст вопроса (до 4000 символов)." }, 400);
    return domainResult(() => {
      const question = deps.domain.addQuestion({ ...body.data, origin: "candidate" });
      return c.json({ questionId: question.id, topic: question.topic } satisfies AddQuestionResponse, 201);
    });
  });

  app.get(apiPaths.progress, (c) => {
    const targetId = deps.domain.activeTargetId();
    const progress = targetId ? deps.domain.progress.forTarget(targetId) : { readiness: null, due: 0, topics: [] };
    return c.json({ targetId, ...progress } satisfies ProgressResponse);
  });
  app.post(apiPaths.practiceRequest, async (c) => {
    const body = practiceRequest.safeParse(await readJson(c.req.raw));
    if (!body.success) return c.json({ error: "Не указано, какую подборку собрать." }, 400);
    if (deps.chat.busy) return c.json({ error: chatBusyMessage }, 409);
    deps.domain.startActivity("practice_set", { targetId: deps.domain.activeTargetId() });
    return sendToChat(() => deps.chat.send(practiceRequestMessage(body.data)));
  });

  const card = (path: (id: string) => string) => path(":id");
  app.put(card(cardPaths.draft), async (c) => {
    const body = cardDraft.safeParse(await readJson(c.req.raw));
    if (!body.success) return c.json({ error: "Черновик не сохранён: неверные данные." }, 400);
    return domainResult(() => {
      deps.practice.saveDraft(idParam(c), body.data);
      return c.body(null, 204);
    });
  });
  app.post(card(cardPaths.hint), (c) => domainResult(() => c.json(deps.practice.hint(idParam(c)))));
  app.post(card(cardPaths.skip), (c) => domainResult(() => c.json(deps.practice.skip(idParam(c)))));
  app.post(card(cardPaths.retry), (c) => domainResult(() => c.json(deps.practice.retry(idParam(c)))));
  app.post(card(cardPaths.check), (c) => domainResult(() => c.json(deps.runner.check(idParam(c)), 202)));
  app.post(card(cardPaths.discuss), (c) => {
    if (deps.chat.busy) return c.json({ error: chatBusyMessage }, 409);
    return domainResult(() => {
      const cardId = idParam(c);
      // Refuses an unknown Card or one in a dropped set before the Candidate's message is stored.
      deps.practice.cardContext(cardId);
      return sendToChat(() => deps.chat.send(discussMessage, { cardId }));
    });
  });
  app.post(practiceSetPaths.submit(":id"), (c) => domainResult(() => c.json(deps.runner.submit(idParam(c)), 202)));
  app.put(practiceSetPaths.reveal(":id"), async (c) => {
    const body = revealRequest.safeParse(await readJson(c.req.raw));
    if (!body.success) return c.json({ error: "Не указан режим оценок." }, 400);
    return domainResult(() => c.json(deps.practice.setReveal(idParam(c), body.data.reveal)));
  });

  app.get(apiPaths.history, (c) =>
    c.json({
      entries: deps.practice.history().map((e) => ({ id: e.id, gradedAt: e.gradedAt.getTime(), set: e.set })),
    } satisfies HistoryResponse),
  );
  app.post(proposalPaths.accept(":id"), (c) => domainResult(() => c.json(deps.continuity.acceptProposal(idParam(c)))));
  app.post(proposalPaths.decline(":id"), (c) => domainResult(() => c.json(deps.continuity.declineProposal(idParam(c)))));

  app.get(apiPaths.agents, (c) =>
    c.json({ agents: deps.detectAgents(), settings: deps.settings.agentSettings() } satisfies AgentsResponse),
  );
  app.put(apiPaths.agentSettings, async (c) => {
    const body = agentSettingsUpdate.safeParse(await readJson(c.req.raw));
    if (!body.success) {
      return c.json({ error: 'Send {"agent": "claude" | "codex" | "opencode", "model": "<optional>"}.' }, 400);
    }
    const agent = deps.detectAgents().find((a) => a.id === body.data.agent);
    if (!agent?.installed) return c.json({ error: `${agent?.label ?? body.data.agent} is not installed. ${agent?.detail ?? ""}`.trim() }, 400);
    return c.json(deps.settings.updateAgent(body.data));
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

const chatSendRequest = z.strictObject({ text: z.string().trim().min(1).max(20_000) });
const switchTargetRequest = z.strictObject({ targetId: z.string().min(1) });
const addQuestionRequest = z.strictObject({
  topic: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1).max(4000),
});

const practiceRequest = z.strictObject({
  kind: z.enum(["today", "topic", "quiz"]),
  topic: z.string().trim().min(1).max(120).optional(),
}).refine((r) => r.kind !== "topic" || r.topic, { message: "A topic request names the topic." });
const cardDraft = z.strictObject({
  text: z.string().max(maxAnswerLength).optional(),
  choices: z.array(z.number().int().min(0).max(20)).max(20).optional(),
});
const revealRequest = z.strictObject({ reveal: z.enum(revealModes) });

/** What the Candidate says in the Chat when they ask for practice from the toolbar or a menu. */
export function practiceRequestMessage(request: z.output<typeof practiceRequest>): string {
  switch (request.kind) {
    case "today":
      return "Хочу подборку на сегодня.";
    case "topic":
      return `Хочу подборку по теме «${request.topic ?? ""}».`;
    case "quiz":
      return "Хочу квиз.";
  }
}

/** What the Candidate says in the Chat when they press «Обсудить» on a Card. */
export const discussMessage = "Обсудим эту карточку.";

/** What the Candidate says in the Chat when they press «Новая цель». */
export const newTargetMessage = "Хочу добавить новую цель подготовки.";

const chatBusyMessage = "Интервьюер ещё отвечает: дождитесь ответа или остановите его.";

/** Answers 202 with the Candidate's Chat message, or 409 while the Interviewer is replying. */
function sendToChat(send: () => unknown): Response {
  try {
    return Response.json({ message: send() }, { status: 202 });
  } catch (error) {
    if (error instanceof ChatBusyError) return Response.json({ error: chatBusyMessage }, { status: 409 });
    throw error;
  }
}

/** Answers a refused domain change with its Russian text: 404 for an unknown record, 400 otherwise. */
function domainResult(respond: () => Response): Response {
  try {
    return respond();
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    const message = error.candidateMessage ?? "приложение отклонило запрос.";
    return Response.json({ error: message }, { status: error.kind === "not_found" ? 404 : 400 });
  }
}

/** The `:id` of a Card or Practice set route. */
function idParam(c: Context): string {
  return c.req.param("id") ?? "";
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}
