import { integer, primaryKey, real, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import type { ChatToolCall } from "@prepare-to-interview/shared";

/** Placeholder domain record for the walking skeleton; real domain tables replace it. */
export const demoNotes = sqliteTable("demo_notes", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

/**
 * Canvas layout is stored apart from domain data: one row per node the Canvas has placed or the
 * Candidate has moved. Rows hold no domain meaning and can be rebuilt by placing nodes again.
 */
export const canvasLayout = sqliteTable("canvas_layout", {
  nodeId: text("node_id").primaryKey(),
  x: real("x").notNull(),
  y: real("y").notNull(),
  collapsed: integer("collapsed", { mode: "boolean" }).notNull().default(false),
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

// Domain core (ADR-0003): Candidate profile, Preparation targets, the shared Question bank,
// Decision log, and Activities. Only the domain core writes these tables.

/** What the Interviewer knows about the Candidate; a single row with id `candidate`. */
export const candidateProfile = sqliteTable("candidate_profile", {
  id: text("id").primaryKey(),
  experience: text("experience"),
  stack: text("stack", { mode: "json" }).$type<string[]>().notNull(),
  strengths: text("strengths", { mode: "json" }).$type<string[]>().notNull(),
  weakSpots: text("weak_spots", { mode: "json" }).$type<string[]>().notNull(),
  preferences: text("preferences"),
  /** Starting levels from the onboarding calibration probe, by Topic id. */
  calibration: text("calibration", { mode: "json" }).$type<CalibrationEntry[]>().notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export interface CalibrationEntry {
  topicId: string;
  /** 0–3 on the Rubric scale, from the calibration probe. */
  level: number;
  note: string | null;
}

export interface Mission {
  why: string | null;
  success: string | null;
  constraints: string | null;
  outOfScope: string | null;
}

export interface Vacancy {
  title: string | null;
  url: string | null;
  text: string | null;
}

export const preparationTargets = sqliteTable("preparation_targets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  grade: text("grade"),
  market: text("market").notNull(),
  language: text("language").notNull(),
  /** Local calendar date `YYYY-MM-DD`. */
  interviewDate: text("interview_date"),
  mission: text("mission", { mode: "json" }).$type<Mission>().notNull(),
  vacancies: text("vacancies", { mode: "json" }).$type<Vacancy[]>().notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

/** Topics of the shared Question bank (ADR-0003); Preparation targets reference them. */
export const topics = sqliteTable(
  "topics",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    /** Case- and space-insensitive name, unique across the bank. */
    key: text("key").notNull(),
    parentId: text("parent_id").references((): AnySQLiteColumn => topics.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [uniqueIndex("topics_key").on(t.key)],
);

export const topicPriorities = ["high", "medium", "low"] as const;
export type TopicPriority = (typeof topicPriorities)[number];

export const targetTopics = sqliteTable(
  "target_topics",
  {
    targetId: text("target_id")
      .notNull()
      .references(() => preparationTargets.id, { onDelete: "cascade" }),
    topicId: text("topic_id")
      .notNull()
      .references(() => topics.id),
    priority: text("priority", { enum: topicPriorities }).notNull(),
    position: integer("position").notNull(),
  },
  (t) => [primaryKey({ columns: [t.targetId, t.topicId] })],
);

export interface TestOption {
  text: string;
  correct: boolean;
}

export const questions = sqliteTable("questions", {
  id: text("id").primaryKey(),
  topicId: text("topic_id")
    .notNull()
    .references(() => topics.id),
  type: text("type", { enum: ["open", "single_choice", "multiple_choice"] }).notNull(),
  prompt: text("prompt").notNull(),
  options: text("options", { mode: "json" }).$type<TestOption[]>(),
  referenceAnswer: text("reference_answer"),
  verified: integer("verified", { mode: "boolean" }).notNull().default(false),
  rubricAnchors: text("rubric_anchors", { mode: "json" }).$type<Partial<Record<"0" | "1" | "2" | "3", string>>>(),
  status: text("status", { enum: ["proposed", "active", "rejected"] }).notNull(),
  /** Who brought the Question into the bank. */
  origin: text("origin", { enum: ["candidate", "research"] }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const decisionLog = sqliteTable("decision_log", {
  id: text("id").primaryKey(),
  targetId: text("target_id").references(() => preparationTargets.id, { onDelete: "set null" }),
  decision: text("decision").notNull(),
  reason: text("reason"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const activityKinds = ["onboarding", "research", "practice_set", "mock_interview", "review"] as const;
export type ActivityKind = (typeof activityKinds)[number];

/** One bounded piece of work with the Interviewer; at most one is active at a time. */
export const activities = sqliteTable("activities", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: activityKinds }).notNull(),
  status: text("status", { enum: ["active", "completed", "skipped", "abandoned"] }).notNull(),
  targetId: text("target_id").references(() => preparationTargets.id, { onDelete: "set null" }),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  endedAt: integer("ended_at", { mode: "timestamp_ms" }),
  summary: text("summary"),
});
