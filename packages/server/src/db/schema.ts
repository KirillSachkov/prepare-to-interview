import { integer, primaryKey, real, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import {
  cardStatuses,
  practiceModes,
  practiceSetKinds,
  questionTypes,
  revealModes,
  topicPriorities,
  type ChatToolCall,
  type ReviewRequest,
} from "@prepare-to-interview/shared";

export { cardStatuses, practiceSetKinds, questionTypes, revealModes, topicPriorities };
export type { CardStatus, PracticeSetKind, QuestionType, RevealMode, TopicPriority } from "@prepare-to-interview/shared";

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

export const agentSessionRoles = ["chat", "grader", "research"] as const;
export type AgentSessionRole = (typeof agentSessionRoles)[number];

/** Internal conversations with the coding agent; the Candidate never manages them. */
export const agentSessions = sqliteTable("agent_sessions", {
  id: text("id").primaryKey(),
  agent: text("agent").notNull(),
  /**
   * `chat` sessions carry the Chat; `grader` sessions grade one open answer and end; `research`
   * sessions run one Research batch in the background and end.
   */
  role: text("role", { enum: agentSessionRoles }).notNull().default("chat"),
  /** The agent's own session id, used to load the session after a restart. */
  externalId: text("external_id").notNull(),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  endedAt: integer("ended_at", { mode: "timestamp_ms" }),
  endedReason: text("ended_reason"),
  /** Latest context usage reported by the agent, for session rotation. */
  usedTokens: integer("used_tokens"),
  contextSize: integer("context_size"),
  /** Why the app will end this Chat session before the next turn, such as an Activity boundary. */
  rotateReason: text("rotate_reason"),
  /** What happened in the session: the Interviewer's end-session summary, or one the app composed. */
  summary: text("summary"),
  /** When the agent received the Briefing that opens the session. */
  briefedAt: integer("briefed_at", { mode: "timestamp_ms" }),
});

/** The single continuous Chat the Candidate sees, spanning many Agent sessions. */
export const chatMessages = sqliteTable("chat_messages", {
  id: text("id").primaryKey(),
  role: text("role", { enum: ["candidate", "interviewer", "notice"] }).notNull(),
  text: text("text").notNull(),
  status: text("status", { enum: ["streaming", "complete", "cancelled", "failed"] }).notNull(),
  toolCalls: text("tool_calls", { mode: "json" }).$type<ChatToolCall[]>().notNull(),
  agentSessionId: text("agent_session_id").references(() => agentSessions.id),
  /** The Card a message is about, such as the Candidate's «Обсудить» on a Card. */
  cardId: text("card_id"),
  /** Candidate profile and Decision log updates the message asks the Candidate to confirm. */
  proposalId: text("proposal_id"),
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

export type RubricAnchors = Partial<Record<"0" | "1" | "2" | "3", string>>;

export const questionOrigins = ["candidate", "research", "interviewer"] as const;
export type QuestionOrigin = (typeof questionOrigins)[number];

export const questions = sqliteTable("questions", {
  id: text("id").primaryKey(),
  topicId: text("topic_id")
    .notNull()
    .references(() => topics.id),
  type: text("type", { enum: questionTypes }).notNull(),
  prompt: text("prompt").notNull(),
  options: text("options", { mode: "json" }).$type<TestOption[]>(),
  referenceAnswer: text("reference_answer"),
  verified: integer("verified", { mode: "boolean" }).notNull().default(false),
  rubricAnchors: text("rubric_anchors", { mode: "json" }).$type<RubricAnchors>(),
  /** The Hint ladder: rung n reveals hint n; each rung lowers the maximum score by one. */
  hints: text("hints", { mode: "json" }).$type<string[]>(),
  status: text("status", { enum: ["proposed", "active", "rejected"] }).notNull(),
  /**
   * Who brought the Question into the bank: the Candidate, Research (enters as Proposed), or the
   * Interviewer composing a Practice set the Candidate asked for (enters as active).
   */
  origin: text("origin", { enum: questionOrigins }).notNull(),
  /** The Research batch (a `research` Activity) that proposed the Question. */
  activityId: text("activity_id").references((): AnySQLiteColumn => activities.id),
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

export const activityStatuses = ["active", "completed", "skipped", "abandoned"] as const;
export type ActivityStatus = (typeof activityStatuses)[number];

/** One bounded piece of work with the Interviewer; at most one is active at a time. */
export const activities = sqliteTable("activities", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: activityKinds }).notNull(),
  status: text("status", { enum: activityStatuses }).notNull(),
  targetId: text("target_id").references(() => preparationTargets.id, { onDelete: "set null" }),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  endedAt: integer("ended_at", { mode: "timestamp_ms" }),
  summary: text("summary"),
});

// Practice (ADR-0004): Practice sets of Cards, Attempts, and Leitner scheduling.

export const attemptModes = practiceModes;
export type AttemptMode = (typeof attemptModes)[number];

export const practiceSetStatuses = ["active", "grading", "graded", "abandoned"] as const;
export type PracticeSetStatus = (typeof practiceSetStatuses)[number];

/** The focus the Candidate chose for a Mock interview: Topics by name, weak spots, or the whole target. */
export interface MockFocus {
  topics: string[];
  weakSpots: boolean;
}

/**
 * A group of Cards the Candidate answers in any order and submits together. A Mock interview is a
 * set with mode `mock`: the Interviewer adds its Cards one at a time and the app grades them at the end.
 */
export const practiceSets = sqliteTable("practice_sets", {
  id: text("id").primaryKey(),
  activityId: text("activity_id")
    .notNull()
    .references(() => activities.id),
  targetId: text("target_id").references(() => preparationTargets.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  kind: text("kind", { enum: practiceSetKinds }).notNull(),
  reveal: text("reveal", { enum: revealModes }).notNull(),
  status: text("status", { enum: practiceSetStatuses }).notNull(),
  /** Mode of the set's Attempts: `training` for Practice sets and Quizzes, `mock` for a Mock interview. */
  mode: text("mode", { enum: attemptModes }).notNull().default("training"),
  /** A timed Quiz submits itself at this instant; a Mock interview ends at it. */
  deadline: integer("deadline", { mode: "timestamp_ms" }),
  /** What a Mock interview focuses on; null for Practice sets. */
  focus: text("focus", { mode: "json" }).$type<MockFocus>(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  submittedAt: integer("submitted_at", { mode: "timestamp_ms" }),
  gradedAt: integer("graded_at", { mode: "timestamp_ms" }),
  /** When the Interviewer received the grading result in a turn's hidden context. */
  reportedAt: integer("reported_at", { mode: "timestamp_ms" }),
  /** When the graded set left the Canvas for history (ADR-0004 auto-tidy). */
  archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
});

/** One Question placed on the Canvas inside a Practice set; holds the Candidate's draft. */
export const cards = sqliteTable("cards", {
  id: text("id").primaryKey(),
  setId: text("set_id")
    .notNull()
    .references(() => practiceSets.id, { onDelete: "cascade" }),
  questionId: text("question_id")
    .notNull()
    .references(() => questions.id),
  position: integer("position").notNull(),
  status: text("status", { enum: cardStatuses }).notNull(),
  draftText: text("draft_text").notNull().default(""),
  /** Chosen option indexes of a test Card. */
  draftChoices: text("draft_choices", { mode: "json" }).$type<number[]>().notNull(),
  hintsUsed: integer("hints_used").notNull().default(0),
  /** The answer is a retry after feedback: recorded, but it moves neither Leitner boxes nor Mastery. */
  retry: integer("retry", { mode: "boolean" }).notNull().default(false),
  /** In a Mock interview, the answered Card this follow-up probes. */
  followUpOf: text("follow_up_of"),
  /** The piece of the parent Card's answer the follow-up quotes. */
  followUpQuote: text("follow_up_quote"),
  /** Latest Attempt on this Card. */
  attemptId: text("attempt_id"),
  /** Why grading failed, in the Candidate's language. */
  error: text("error"),
});

/** One answer to one Question: a score with its evidence, or Skipped. */
export const attempts = sqliteTable("attempts", {
  id: text("id").primaryKey(),
  questionId: text("question_id")
    .notNull()
    .references(() => questions.id),
  cardId: text("card_id"),
  activityId: text("activity_id").references(() => activities.id),
  mode: text("mode", { enum: attemptModes }).notNull(),
  status: text("status", { enum: ["graded", "skipped"] }).notNull(),
  /** 0–3 after the Hint ladder cap; null when Skipped. */
  score: integer("score"),
  /** The Grader's or the app's score before the cap. */
  rawScore: integer("raw_score"),
  maxScore: integer("max_score").notNull(),
  hintRung: integer("hint_rung").notNull(),
  answer: text("answer"),
  choices: text("choices", { mode: "json" }).$type<number[]>(),
  /** Evidence quoted from the answer: no quote, no rating. */
  quote: text("quote"),
  /** What was right. */
  strengths: text("strengths"),
  /** The single most important gap. */
  gap: text("gap"),
  gradedBy: text("graded_by", { enum: ["app", "grader"] }),
  retry: integer("retry", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  /** The score before the Interviewer corrected a disputed grade; null when never corrected. */
  correctedFrom: integer("corrected_from"),
  correctionReason: text("correction_reason"),
  correctedAt: integer("corrected_at", { mode: "timestamp_ms" }),
});

/** Leitner box and Due date per Question; a Question without a row was never practised. */
export const questionSchedule = sqliteTable("question_schedule", {
  questionId: text("question_id")
    .primaryKey()
    .references(() => questions.id),
  box: integer("box").notNull(),
  /** Local calendar date `YYYY-MM-DD` from which the Question is Due. */
  dueOn: text("due_on").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

// Research (ADR-0003): an immutable archive of raw Sources, the Interviewer's Markdown notes with
// Source links, and Topics Research proposes for a Preparation target. Files live under
// `<data dir>/research/`; these tables index them.

export const sourceKinds = ["article", "documentation", "vacancy", "question_list", "forum", "video_page", "candidate_material", "other"] as const;
export type SourceKind = (typeof sourceKinds)[number];

/** One archived raw Source; never changed once written. The same content is archived once. */
export const sources = sqliteTable(
  "sources",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: sourceKinds }).notNull(),
    /** Where the content came from; `null` for the Candidate's pasted material. */
    url: text("url"),
    title: text("title"),
    /** When the content was fetched or pasted. */
    fetchedAt: integer("fetched_at", { mode: "timestamp_ms" }).notNull(),
    /** SHA-256 of the archived content, hex. */
    hash: text("hash").notNull(),
    /** Path of the archived file, relative to the research directory. */
    archivePath: text("archive_path").notNull(),
    /** The Research batch that archived it, if any. */
    activityId: text("activity_id").references(() => activities.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [uniqueIndex("sources_hash").on(t.hash)],
);

export const questionSources = sqliteTable(
  "question_sources",
  {
    questionId: text("question_id")
      .notNull()
      .references(() => questions.id),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id),
  },
  (t) => [primaryKey({ columns: [t.questionId, t.sourceId] })],
);

export const topicSources = sqliteTable(
  "topic_sources",
  {
    topicId: text("topic_id")
      .notNull()
      .references(() => topics.id),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id),
  },
  (t) => [primaryKey({ columns: [t.topicId, t.sourceId] })],
);

/** The Interviewer's Markdown notes from Research; mirrored to `research/notes/<slug>.md`. */
export const researchNotes = sqliteTable(
  "research_notes",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    targetId: text("target_id").references(() => preparationTargets.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [uniqueIndex("research_notes_slug").on(t.slug)],
);

export const noteSources = sqliteTable(
  "note_sources",
  {
    noteId: text("note_id")
      .notNull()
      .references(() => researchNotes.id, { onDelete: "cascade" }),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id),
  },
  (t) => [primaryKey({ columns: [t.noteId, t.sourceId] })],
);

export const proposalStatuses = ["proposed", "approved", "rejected"] as const;
export type ProposalStatus = (typeof proposalStatuses)[number];

/** A Topic Research proposes for a Preparation target; approved, it joins the target's Topics. */
export const topicProposals = sqliteTable("topic_proposals", {
  id: text("id").primaryKey(),
  targetId: text("target_id")
    .notNull()
    .references(() => preparationTargets.id, { onDelete: "cascade" }),
  topicId: text("topic_id")
    .notNull()
    .references(() => topics.id),
  priority: text("priority", { enum: topicPriorities }).notNull(),
  /** Why the Topic matters for the target, such as how many vacancies name it. */
  reason: text("reason"),
  status: text("status", { enum: proposalStatuses }).notNull(),
  activityId: text("activity_id").references(() => activities.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

// Continuity (ADR-0002): Candidate profile and Decision log updates the Interviewer proposes in a review.

export const reviewProposalStatuses = ["pending", "accepted", "declined"] as const;
export type ReviewProposalStatus = (typeof reviewProposalStatuses)[number];

export interface ProposedProfile {
  experience?: string;
  stack?: string[];
  strengths?: string[];
  weakSpots?: string[];
  preferences?: string;
}

export interface ProposedDecision {
  decision: string;
  reason: string | null;
}

/**
 * A Question bank change the Chat's Interviewer asked for, which waits for the Candidate's
 * confirmation in the Chat: approving or rejecting Proposed items, or approving a Research batch
 * without review. The Chat reads web pages, so its word alone never changes the bank.
 */
export type BankAction =
  /** Approving or rejecting the Proposed items picked when the Interviewer asked, by id; `items` is what the Candidate saw. */
  | { kind: "review"; request: ReviewRequest; items: string[] }
  | { kind: "auto_approve"; batchId: string };

/**
 * Candidate profile and Decision log updates the Interviewer proposed at the end of an Agent
 * session, or a {@link BankAction}; the app applies them only once the Candidate confirms in the Chat.
 */
export const reviewProposals = sqliteTable("review_proposals", {
  id: text("id").primaryKey(),
  agentSessionId: text("agent_session_id").references(() => agentSessions.id),
  targetId: text("target_id").references(() => preparationTargets.id, { onDelete: "set null" }),
  profile: text("profile", { mode: "json" }).$type<ProposedProfile>(),
  decisions: text("decisions", { mode: "json" }).$type<ProposedDecision[]>().notNull(),
  bankAction: text("bank_action", { mode: "json" }).$type<BankAction>(),
  status: text("status", { enum: reviewProposalStatuses }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  settledAt: integer("settled_at", { mode: "timestamp_ms" }),
});
