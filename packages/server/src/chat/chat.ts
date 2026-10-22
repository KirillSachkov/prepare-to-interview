import crypto from "node:crypto";
import { and, desc, eq, isNull, max } from "drizzle-orm";
import {
  stripHiddenState,
  type AgentId,
  type ChatMessage,
  type ChatRole,
  type ChatSnapshot,
} from "@prepare-to-interview/shared";
import type { AgentDriver, AgentEvent, AgentSession } from "../agent/driver.ts";
import { describeAgentError, toAgentError } from "../agent/errors.ts";
import type { Database } from "../db/database.ts";
import { agentSessions, chatMessages } from "../db/schema.ts";
import type { EventBus } from "../events.ts";
import type { Interviewer } from "../interviewer/interviewer.ts";
import type { Settings } from "../settings/settings.ts";

export type DriverProvider = (agent: AgentId) => AgentDriver;

export class ChatBusyError extends Error {
  constructor(message = "The Interviewer is still replying. Wait for the reply or stop it first.") {
    super(message);
    this.name = "ChatBusyError";
  }
}

export interface ChatDeps {
  db: Database;
  events: EventBus;
  settings: Settings;
  interviewer: Interviewer;
  drivers: DriverProvider;
  /** The prompt of a Card a message refers to, for the chip the Chat shows. */
  cardPrompt?: (cardId: string) => string | undefined;
}

export interface SendOptions {
  /** The Card the message is about («Обсудить»); the Interviewer receives its context hidden. */
  cardId?: string;
  /** The message gives the Candidate's answer on that Mock interview Card rather than asking to discuss it. */
  mockAnswer?: boolean;
}

interface LiveSession {
  agent: AgentId;
  model: string | undefined;
  /** Row id in `agent_sessions`. */
  rowId: string;
  session: AgentSession;
}

interface Turn {
  stopRequested: boolean;
  prompting?: AgentSession;
  reply?: ChatMessage;
  /** When the streaming reply text was last written to the database. */
  savedAt: number;
  done: Promise<void>;
}

/** How often a streaming reply is saved, so a crash keeps most of the text. */
const saveIntervalMs = 1000;
/** How long closing waits for a stopped turn before giving up on the agent. */
const closeTimeoutMs = 5000;

const noAgentNotice = "Choose your coding agent in settings to start the Chat.";
const interruptedNotice = "The app stopped while the Interviewer was replying. Send your message again.";

/**
 * The single continuous Chat: stores messages, runs one Interviewer turn at a time on the chosen
 * agent, streams replies to live clients, and resumes the stored Agent session after a restart.
 */
export class Chat {
  readonly #deps: ChatDeps;
  #live: LiveSession | undefined;
  #turn: Turn | undefined;
  #closing = false;

  constructor(deps: ChatDeps) {
    this.#deps = deps;
    this.#recoverInterrupted();
  }

  snapshot(): ChatSnapshot {
    const rows = this.#deps.db.select().from(chatMessages).orderBy(chatMessages.seq).all();
    const reply = this.#turn?.reply;
    const messages = rows.map((row) => (reply && row.id === reply.id ? visible(reply) : this.#toMessage(row)));
    return { messages, busy: this.#turn !== undefined };
  }

  /** True while an Interviewer reply is running. */
  get busy(): boolean {
    return this.#turn !== undefined;
  }

  /** Stores the Candidate's message and starts the Interviewer's reply in the background. */
  send(text: string, options: SendOptions = {}): ChatMessage {
    if (this.#closing) throw new ChatBusyError("The app is shutting down.");
    if (this.#turn) throw new ChatBusyError();
    const message = this.#insert("candidate", text, "complete", undefined, options.cardId);
    const turn: Turn = { stopRequested: false, savedAt: Date.now(), done: Promise.resolve() };
    this.#turn = turn;
    this.#deps.events.publish({ type: "chat.busy", busy: true });
    turn.done = this.#run(turn, text, options).finally(() => {
      this.#turn = undefined;
      this.#deps.events.publish({ type: "chat.busy", busy: false });
    });
    return message;
  }

  /**
   * Adds a message the app composed on the Interviewer's side, such as a grading summary. The agent
   * does not see it in the Chat; the Interviewer orchestration passes the facts on as hidden context.
   */
  post(text: string): ChatMessage {
    return this.#insert("interviewer", text, "complete");
  }

  /** Stops the running reply; the partial reply stays in the Chat marked as cancelled. */
  async stop(): Promise<void> {
    const turn = this.#turn;
    if (!turn) return;
    turn.stopRequested = true;
    await turn.prompting?.cancel().catch(() => undefined);
  }

  /** Resolves when no reply is running. */
  async idle(): Promise<void> {
    await this.#turn?.done;
  }

  /** Stops the running reply and the live session; an agent that ignores the stop is left behind. */
  async close(): Promise<void> {
    this.#closing = true;
    await this.stop();
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([this.idle(), new Promise((resolve) => (timer = setTimeout(resolve, closeTimeoutMs)))]);
    clearTimeout(timer);
    await this.#dropLive();
  }

  async #run(turn: Turn, text: string, options: SendOptions): Promise<void> {
    const { agent, models } = this.#deps.settings.agentSettings();
    if (!agent) {
      this.#insert("notice", noAgentNotice, "complete");
      return;
    }
    try {
      const live = await this.#session(agent, models[agent]);
      if (turn.stopRequested) return;
      turn.prompting = live.session;
      const prepared = this.#deps.interviewer.turnInput(text, live.rowId, options);
      const result = await live.session.prompt(prepared.input, (event) => this.#onEvent(turn, live, event));
      prepared.sent();
      this.#finishReply(turn, result.stopReason === "cancelled" ? "cancelled" : "complete");
    } catch (error) {
      // A turn cut off by shutdown leaves its reply streaming; the next start marks it interrupted.
      if (this.#closing) return;
      this.#finishReply(turn, "failed");
      // The next turn loads the stored session again, which also recovers from a crashed agent.
      await this.#dropLive();
      this.#insert("notice", describeAgentError(agent, toAgentError(error)), "complete");
    }
  }

  async #session(agent: AgentId, model: string | undefined): Promise<LiveSession> {
    if (this.#live && (this.#live.agent !== agent || this.#live.model !== model)) await this.#dropLive();
    if (this.#live) return this.#live;

    const driver = this.#deps.drivers(agent);
    const config = this.#deps.interviewer.sessionConfig(model);
    const stored = this.#deps.db
      .select()
      .from(agentSessions)
      .where(and(eq(agentSessions.agent, agent), eq(agentSessions.role, "chat"), isNull(agentSessions.endedAt)))
      .orderBy(desc(agentSessions.startedAt))
      .get();
    if (stored) {
      try {
        const session = await driver.loadSession(stored.externalId, config);
        this.#live = { agent, model, rowId: stored.id, session };
        return this.#live;
      } catch (error) {
        const agentError = toAgentError(error);
        // Login, limit, or a missing agent would fail a new session too.
        if (agentError.kind !== "failed") throw agentError;
        this.#endSession(stored.id, "load_failed");
      }
    }
    const session = await driver.startSession(config);
    const rowId = crypto.randomUUID();
    this.#deps.db
      .insert(agentSessions)
      .values({ id: rowId, agent, externalId: session.id, startedAt: new Date() })
      .run();
    this.#live = { agent, model, rowId, session };
    return this.#live;
  }

  async #dropLive(): Promise<void> {
    const live = this.#live;
    this.#live = undefined;
    await live?.session.close().catch(() => undefined);
  }

  #endSession(rowId: string, reason: string): void {
    this.#deps.db
      .update(agentSessions)
      .set({ endedAt: new Date(), endedReason: reason })
      .where(eq(agentSessions.id, rowId))
      .run();
  }

  #onEvent(turn: Turn, live: LiveSession, event: AgentEvent): void {
    // After shutdown the database may be closed; a late stream is dropped.
    if (this.#closing) return;
    switch (event.type) {
      case "message_chunk": {
        const reply = this.#reply(turn, live);
        reply.text += event.text;
        this.#deps.events.publish({ type: "chat.delta", messageId: reply.id, text: event.text });
        if (Date.now() - turn.savedAt >= saveIntervalMs) {
          turn.savedAt = Date.now();
          this.#deps.db.update(chatMessages).set({ text: reply.text }).where(eq(chatMessages.id, reply.id)).run();
        }
        return;
      }
      case "tool_call": {
        const reply = this.#reply(turn, live);
        reply.toolCalls.push({
          id: event.toolCallId,
          title: event.title,
          status: event.status,
          ...(event.server && { server: event.server }),
          ...(event.tool && { tool: event.tool }),
        });
        this.#deps.events.publish({ type: "chat.message", message: visible(reply) });
        return;
      }
      case "tool_call_update": {
        const call = turn.reply?.toolCalls.find((c) => c.id === event.toolCallId);
        if (!call || !turn.reply) return;
        if (event.status) call.status = event.status;
        if (event.title) call.title = event.title;
        if (event.server && event.tool) Object.assign(call, { server: event.server, tool: event.tool });
        this.#deps.events.publish({ type: "chat.message", message: visible(turn.reply) });
        return;
      }
      case "usage":
        this.#deps.db
          .update(agentSessions)
          .set({ usedTokens: event.used, contextSize: event.size })
          .where(eq(agentSessions.id, live.rowId))
          .run();
        return;
      case "thought_chunk":
      case "session_info":
        return;
    }
  }

  /** The Interviewer's reply message, created on the first streamed event. */
  #reply(turn: Turn, live: LiveSession): ChatMessage {
    turn.reply ??= this.#insert("interviewer", "", "streaming", live.rowId);
    return turn.reply;
  }

  #finishReply(turn: Turn, status: ChatMessage["status"]): void {
    const reply = turn.reply;
    if (!reply) return;
    reply.status = status;
    reply.text = stripHiddenState(reply.text);
    this.#deps.db
      .update(chatMessages)
      .set({ text: reply.text, status, toolCalls: reply.toolCalls })
      .where(eq(chatMessages.id, reply.id))
      .run();
    this.#deps.events.publish({ type: "chat.message", message: visible(reply) });
  }

  #insert(role: ChatRole, text: string, status: ChatMessage["status"], agentSessionId?: string, cardId?: string): ChatMessage {
    const card = this.#card(cardId ?? null);
    const message: ChatMessage = { id: crypto.randomUUID(), role, text, status, createdAt: Date.now(), toolCalls: [], ...(card && { card }) };
    this.#deps.db.transaction((tx) => {
      const seq = (tx.select({ last: max(chatMessages.seq) }).from(chatMessages).get()?.last ?? 0) + 1;
      const { card: _card, ...row } = message;
      tx.insert(chatMessages)
        .values({ ...row, createdAt: new Date(message.createdAt), agentSessionId: agentSessionId ?? null, cardId: cardId ?? null, seq })
        .run();
    });
    this.#deps.events.publish({ type: "chat.message", message: visible(message) });
    return message;
  }

  #toMessage(row: typeof chatMessages.$inferSelect): ChatMessage {
    const card = this.#card(row.cardId);
    return visible({
      id: row.id,
      role: row.role,
      text: row.text,
      status: row.status,
      createdAt: row.createdAt.getTime(),
      toolCalls: row.toolCalls,
      ...(card && { card }),
    });
  }

  #card(cardId: string | null): ChatMessage["card"] {
    if (!cardId) return undefined;
    const prompt = this.#deps.cardPrompt?.(cardId);
    return prompt === undefined ? undefined : { id: cardId, prompt };
  }

  /** A reply still streaming when the app stopped can never finish; mark it and tell the Candidate. */
  #recoverInterrupted(): void {
    const interrupted = this.#deps.db
      .update(chatMessages)
      .set({ status: "failed" })
      .where(eq(chatMessages.status, "streaming"))
      .returning({ id: chatMessages.id })
      .all();
    if (interrupted.length > 0) this.#insert("notice", interruptedNotice, "complete");
  }
}

/** A copy safe to show: hidden state echoes removed. */
function visible(message: ChatMessage): ChatMessage {
  return { ...message, text: stripHiddenState(message.text), toolCalls: message.toolCalls.map((c) => ({ ...c })) };
}
