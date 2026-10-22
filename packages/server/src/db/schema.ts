import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { ChatToolCall } from "@prepare-to-interview/shared";

/** Placeholder domain record for the walking skeleton; real domain tables replace it. */
export const demoNotes = sqliteTable("demo_notes", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

/** Canvas layout is stored apart from domain data: one row per node shown on the Canvas. */
export const canvasLayout = sqliteTable("canvas_layout", {
  nodeId: text("node_id").primaryKey(),
  x: real("x").notNull(),
  y: real("y").notNull(),
});

/** App settings as JSON values by key, such as the chosen agent. */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).notNull(),
});

/** Internal conversations with the coding agent; the Candidate never manages them. */
export const agentSessions = sqliteTable("agent_sessions", {
  id: text("id").primaryKey(),
  agent: text("agent").notNull(),
  /** The agent's own session id, used to load the session after a restart. */
  externalId: text("external_id").notNull(),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  endedAt: integer("ended_at", { mode: "timestamp_ms" }),
  endedReason: text("ended_reason"),
  /** Latest context usage reported by the agent, for session rotation. */
  usedTokens: integer("used_tokens"),
  contextSize: integer("context_size"),
});

/** The single continuous Chat the Candidate sees, spanning many Agent sessions. */
export const chatMessages = sqliteTable("chat_messages", {
  id: text("id").primaryKey(),
  role: text("role", { enum: ["candidate", "interviewer", "notice"] }).notNull(),
  text: text("text").notNull(),
  status: text("status", { enum: ["streaming", "complete", "cancelled", "failed"] }).notNull(),
  toolCalls: text("tool_calls", { mode: "json" }).$type<ChatToolCall[]>().notNull(),
  agentSessionId: text("agent_session_id").references(() => agentSessions.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  /** Insertion order; createdAt can tie within a millisecond. */
  seq: integer("seq").notNull(),
});
