// Contract of the Skill map, the Question bank, the Proposed queue, Research, and search: REST
// paths and shapes between the app server and the browser client.
import type { QuestionType, TopicPriority } from "./index.ts";

export const bankPaths = {
  /** GET a {@link SkillMapResponse} for the active Preparation target. */
  skillMap: "/api/skill-map",
  /** GET a {@link TopicDetailResponse}: the Topic's Questions with Attempt history. */
  topic: (topicId: string) => `/api/skill-map/topics/${topicId}`,
  /** GET a {@link BankResponse}: every Topic of the shared Question bank with its active Questions. */
  bank: "/api/bank",
  /** GET a {@link ProposedResponse}: Research output waiting for the Candidate's approval. */
  proposed: "/api/proposed",
  /** POST a {@link ReviewRequest}: approves or rejects Proposed items. */
  review: "/api/proposed/review",
  /** PUT a {@link ReferenceUpdate}: the Candidate edits a Reference answer or marks it verified. */
  reference: (questionId: string) => `/api/questions/${questionId}/reference`,
  /** POST: asks the Interviewer in the Chat to run Research for the active Preparation target. */
  researchRequest: "/api/research/request",
  /** GET `?q=…`: a {@link SearchResponse} over the bank, notes, Sources, and transcripts. */
  search: "/api/search",
} as const;

export const sourceKindLabels = {
  article: "статья",
  documentation: "документация",
  vacancy: "вакансия",
  question_list: "список вопросов",
  forum: "обсуждение",
  video_page: "страница видео",
  candidate_material: "материалы кандидата",
  other: "источник",
} as const;
export type SourceKindName = keyof typeof sourceKindLabels;

/** An archived Source a Topic, Question, or note is based on. */
export interface SourceRef {
  id: string;
  kind: SourceKindName;
  url: string | null;
  title: string | null;
  /** Milliseconds since the epoch. */
  fetchedAt: number;
}

export interface SkillMapTopic {
  topicId: string;
  name: string;
  group: string | null;
  priority: TopicPriority;
  /** 0–1; `null` for a never-touched Topic, shown grey. */
  mastery: number | null;
  questions: number;
  due: number;
}

export interface SkillMapResponse {
  targetId: string | null;
  targetName: string | null;
  /** Overall readiness 0–100; `null` while no Topic has Mastery. */
  readiness: number | null;
  due: number;
  topics: SkillMapTopic[];
  /** Proposed items waiting for review, across Research batches. */
  proposed: number;
}

/** One Attempt in a Question's history, newest first. */
export interface AttemptRecord {
  id: string;
  /** Milliseconds since the epoch. */
  createdAt: number;
  mode: "training" | "mock";
  status: "graded" | "skipped";
  score: number | null;
  maxScore: number;
  hintRung: number;
  answer: string | null;
  quote: string | null;
  strengths: string | null;
  gap: string | null;
  /** A retry after feedback: kept in history, left out of Mastery and scheduling. */
  retry: boolean;
}

export type QuestionStatus = "proposed" | "active" | "rejected";

export interface BankQuestion {
  id: string;
  topic: string;
  type: QuestionType;
  prompt: string;
  options: { text: string; correct: boolean }[] | null;
  referenceAnswer: string | null;
  verified: boolean;
  status: QuestionStatus;
  origin: "candidate" | "research" | "interviewer";
  /** Leitner box 1–5; `null` when never practised. */
  box: number | null;
  /** Local date `YYYY-MM-DD` it is Due from. */
  dueOn: string | null;
  due: boolean;
  mastery: number | null;
  sources: SourceRef[];
  attempts: AttemptRecord[];
}

export interface TopicDetailResponse {
  topic: { id: string; name: string; group: string | null; mastery: number | null; due: number; sources: SourceRef[] };
  /** Active Questions of the Topic and its subtopics, then Proposed ones. */
  questions: BankQuestion[];
}

export interface BankTopic {
  topicId: string;
  name: string;
  group: string | null;
  mastery: number | null;
  questions: { id: string; type: QuestionType; prompt: string; verified: boolean; due: boolean }[];
}

export interface BankResponse {
  topics: BankTopic[];
}

export interface ProposedTopic {
  /** Id of the proposal, not of the Topic. */
  id: string;
  name: string;
  group: string | null;
  priority: TopicPriority;
  reason: string | null;
  sources: SourceRef[];
}

export interface ProposedQuestion {
  id: string;
  topic: string;
  type: QuestionType;
  prompt: string;
  referenceAnswer: string | null;
  options: { text: string; correct: boolean }[] | null;
  sources: SourceRef[];
}

/** Proposed items from one Research batch, or from the Interviewer outside Research (`id` null). */
export interface ProposedBatch {
  id: string | null;
  targetName: string | null;
  /** Milliseconds since the epoch. */
  startedAt: number | null;
  running: boolean;
  summary: string | null;
  topics: ProposedTopic[];
  questions: ProposedQuestion[];
}

export interface ProposedResponse {
  count: number;
  batches: ProposedBatch[];
}

export interface ReviewRequest {
  action: "approve" | "reject";
  /** Topic proposal ids. */
  topics?: string[];
  questions?: string[];
  /** Every Proposed item of this Research batch; `null` for items proposed outside Research. */
  batchId?: string | null;
  /** Every Proposed item. */
  all?: boolean;
}

export interface ReviewResponse {
  approved: number;
  rejected: number;
  /** Proposed items still waiting. */
  proposed: number;
}

export interface ReferenceUpdate {
  referenceAnswer?: string | null;
  verified?: boolean;
}

export const searchKinds = ["question", "note", "source", "transcript"] as const;
export type SearchKind = (typeof searchKinds)[number];

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  /** Matched text with `[` `]` around the hits. */
  snippet: string;
  /** Question status, Source URL, or the note slug. */
  detail: string | null;
}

export interface SearchResponse {
  hits: SearchHit[];
}
