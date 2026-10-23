import fs from "node:fs";
import path from "node:path";
import { upgradeWebSocket } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { z } from "zod";
import {
  apiPaths,
  agentIds,
  type AgentId,
  type AgentModelsResponse,
  bankPaths,
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
import { describeAgentError, toAgentError } from "../agent/errors.ts";
import { UnknownNodeError, type Canvas } from "../canvas/canvas.ts";
import { ChatBusyError, type Chat } from "../chat/chat.ts";
import { revealModes } from "../db/schema.ts";
import type { Domain } from "../domain/domain.ts";
import type { Practice } from "../domain/practice.ts";
import type { Continuity } from "../interviewer/continuity.ts";
import type { MockRunner } from "../interviewer/mock-runner.ts";
import type { PracticeRunner } from "../interviewer/practice-runner.ts";
import type { EventBus } from "../events.ts";
import type { McpHandler } from "../mcp/handler.ts";
import { agentSettingsUpdate, type Settings } from "../settings/settings.ts";
import { bearerToken, hostGuard, sameToken, tokenGuard } from "./access.ts";
import { registerBankRoutes, type BankRouteDeps } from "./bank-routes.ts";
import { mockRoutes } from "./mock-routes.ts";
import { chatBusyMessage, domainResult, idParam, readJson, sendToChat } from "./respond.ts";

export interface AppDeps {
  token: string;
  allowedHosts: () => ReadonlySet<string>;
  canvas: Canvas;
  chat: Chat;
  domain: Domain;
  practice: Practice;
  runner: PracticeRunner;
  continuity: Continuity;
  mock: MockRunner;
  settings: Settings;
  detectAgents: AgentDetector;
  listAgentModels: (agent: AgentId) => Promise<AgentModelsResponse>;
  events: EventBus;
  /** MCP endpoint of the Chat's Agent session, with every tool. */
  mcp: McpHandler;
  /** MCP endpoint of hidden Research sessions, with only the Research tools. */
  researchMcp: McpHandler;
  /**
   * Per-role tokens of the MCP endpoints: each Agent session gets only its own role's token, which
   * opens only that endpoint (not the REST API) and determines the caller's role.
   */
  mcpTokens: { chat: string; research: string };
  /** The Skill map, the Question bank, the Proposed queue, and search. */
  bankRoutes: Omit<BankRouteDeps, "chat">;
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
  // Registered before the app token guard: each MCP endpoint takes its role token or the app token
  // (the Candidate's own scripts), and the role comes from the token alone.
  const mcpRoute = (route: string, handler: McpHandler, roleToken: string, role: "chat" | "research") => {
    app.post(route, (c) => {
      const bearer = bearerToken(c.req.header("authorization"));
      if (sameToken(bearer, roleToken)) return handler(c.req.raw, { fromChat: role === "chat" });
      if (sameToken(bearer, deps.token)) return handler(c.req.raw, { fromChat: false });
      return c.text("Unauthorized: use the MCP token the app gave this Agent session.", 401);
    });
  };
  mcpRoute(apiPaths.mcp, deps.mcp, deps.mcpTokens.chat, "chat");
  mcpRoute(bankPaths.researchMcp, deps.researchMcp, deps.mcpTokens.research, "research");
  app.use("*", tokenGuard(deps.token));

  app.on(["GET", "DELETE"], [apiPaths.mcp, bankPaths.researchMcp], (c) => c.text("Stateless MCP endpoint: use POST", 405));

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
    return domainResult(() => {
      deps.domain.startActivity("onboarding", { newTarget: true });
      return sendToChat(() => deps.chat.send(newTargetMessage));
    });
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
    if (deps.mock.running()) return c.json({ error: "сначала завершите мок-интервью." }, 409);
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
  mockRoutes(app, deps);

  app.get(apiPaths.agents, (c) =>
    c.json({ agents: deps.detectAgents(), settings: deps.settings.agentSettings() } satisfies AgentsResponse),
  );
  app.get("/api/agents/:agent/models", async (c) => {
    const parsed = z.enum(agentIds).safeParse(c.req.param("agent"));
    if (!parsed.success) return c.json({ error: "Unknown agent." }, 400);
    const agent = deps.detectAgents().find((a) => a.id === parsed.data);
    if (!agent?.installed) return c.json({ error: `${agent?.label ?? parsed.data} is not installed.` }, 400);
    try {
      return c.json(await deps.listAgentModels(parsed.data));
    } catch (error) {
      return c.json({ error: describeAgentError(parsed.data, toAgentError(error)) }, 502);
    }
  });
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

  registerBankRoutes(app, { ...deps.bankRoutes, chat: deps.chat });

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
