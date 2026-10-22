// Contract between the app server and the browser client: REST paths, Canvas and Chat shapes, and
// live events pushed over the WebSocket channel.

export * from "./bank.ts";

export const apiPaths = {
  canvas: "/api/canvas",
  /** PUT a {@link LayoutUpdateRequest}: where nodes sit and whether they are collapsed. */
  canvasLayout: "/api/canvas/layout",
  events: "/api/events",
  chat: "/api/chat",
  chatMessages: "/api/chat/messages",
  chatStop: "/api/chat/stop",
  agents: "/api/agents",
  agentSettings: "/api/settings/agent",
  /** GET a {@link TargetsResponse}. */
  targets: "/api/targets",
  /** PUT a {@link SwitchTargetRequest}. */
  activeTarget: "/api/targets/active",
  /** POST: starts onboarding for a new Preparation target and asks the Interviewer in the Chat. */
  newTarget: "/api/targets/new",
  /** GET the Topic names of the Question bank. */
  topics: "/api/topics",
  /** POST an {@link AddQuestionRequest}: the Candidate's own Question. */
  questions: "/api/questions",
  /** POST a {@link PracticeRequest}: asks the Interviewer for a Practice set or a Quiz in the Chat. */
  practiceRequest: "/api/practice/request",
  /** GET a {@link ProgressResponse}: Mastery and Due per Topic of the active Preparation target. */
  progress: "/api/progress",
  /** POST a {@link MockRequest}: starts a Mock interview and asks the Interviewer in the Chat. */
  mockRequest: "/api/mock/request",
  mcp: "/mcp",
} as const;

/** Query parameter that carries the access token in the URL printed at start. */
export const tokenQueryParam = "token";

export interface CanvasPosition {
  x: number;
  y: number;
}

/** How a node sits on the Canvas; kept in the layout store, apart from domain data. */
export interface NodeLayout {
  position: CanvasPosition;
  collapsed: boolean;
}

interface CanvasNodeBase extends NodeLayout {
  id: string;
}

/** REST paths of Card actions. */
export const cardPaths = {
  /** PUT a {@link CardDraft}; the draft survives reload. */
  draft: (cardId: string) => `/api/cards/${cardId}/draft`,
  /** POST: reveals the next rung of the Hint ladder. */
  hint: (cardId: string) => `/api/cards/${cardId}/hint`,
  /** POST: records the Card as Skipped. */
  skip: (cardId: string) => `/api/cards/${cardId}/skip`,
  /** POST: grades this Card now (training mode, a Quiz, or after a failed grading). */
  check: (cardId: string) => `/api/cards/${cardId}/check`,
  /** POST: opens a graded or skipped Card for another answer. */
  retry: (cardId: string) => `/api/cards/${cardId}/retry`,
  /** POST: brings the Card into the Chat with its question, answer, and grade. */
  discuss: (cardId: string) => `/api/cards/${cardId}/discuss`,
} as const;

/** REST paths of a Mock interview. */
export const mockPaths = {
  /** POST: gives the Card's saved draft as the answer (empty: «Не знаю»); the Interviewer reacts in the Chat. */
  answer: (cardId: string) => `/api/cards/${cardId}/answer`,
  /** POST: ends the Mock interview early; the Grader then grades every answer. */
  finish: (setId: string) => `/api/mock-interviews/${setId}/finish`,
} as const;

export const practiceSetPaths = {
  /** POST: submits the whole Practice set. */
  submit: (setId: string) => `/api/practice-sets/${setId}/submit`,
  /** PUT a {@link RevealRequest}: grades after each answer or only after submitting. */
  reveal: (setId: string) => `/api/practice-sets/${setId}/reveal`,
} as const;

export const topicPriorities = ["high", "medium", "low"] as const;
export type TopicPriority = (typeof topicPriorities)[number];
export const questionTypes = ["open", "single_choice", "multiple_choice"] as const;
export type QuestionType = (typeof questionTypes)[number];
/** `answered`: a Mock interview Card whose answer waits for the Grader until the mock ends. */
export const cardStatuses = ["open", "answered", "grading", "graded", "skipped", "failed"] as const;
export type CardStatus = (typeof cardStatuses)[number];
export const practiceSetKinds = ["practice", "quiz"] as const;
export type PracticeSetKind = (typeof practiceSetKinds)[number];
/** When grades appear: after the whole set is submitted, or right after each answer (training). */
export const revealModes = ["after_submit", "each_answer"] as const;
export type RevealMode = (typeof revealModes)[number];
/** Statuses the Canvas shows; a dropped (abandoned) set leaves the Canvas. */
export type PracticeSetStatus = "active" | "grading" | "graded";
/** Most Cards in one Practice set. */
export const maxPracticeCards = 12;
/** A Practice set with this many Cards renders two columns wide (800 px instead of 440 px). */
export const wideSetCards = 3;
/** Longest open answer a Card accepts. */
export const maxAnswerLength = 20_000;

export interface CardDraft {
  text: string;
  /** Chosen option indexes of a test Card. */
  choices: number[];
}

/** The latest Attempt shown on a Card. */
export interface CardAttempt {
  status: "graded" | "skipped";
  /** 0–3 after the Hint ladder cap; `null` when Skipped. */
  score: number | null;
  maxScore: number;
  /** Evidence quoted from the answer. */
  quote: string | null;
  /** What was right. */
  strengths: string | null;
  gap: string | null;
  /** Correct option indexes of a test Card. */
  correct: number[] | null;
}

/** One Question placed on the Canvas, as the Candidate sees it. */
export interface CardView {
  id: string;
  questionId: string;
  topic: string;
  type: QuestionType;
  prompt: string;
  /** Option texts of a test Card. */
  options: string[] | null;
  status: CardStatus;
  /** The draft while open; the submitted answer afterwards. */
  draft: CardDraft;
  /** Hint ladder rungs revealed so far, in order. */
  hints: string[];
  /** Rungs the Card offers in total. */
  hintRungs: number;
  /** Highest score the next Attempt can get after the hints used. */
  maxScore: number;
  attempt: CardAttempt | null;
  /** Revealed only once an Attempt exists. */
  referenceAnswer: string | null;
  /** Why grading failed, in Russian; the Candidate can check again. */
  error: string | null;
  /** In a Mock interview, the answered Card this follow-up probes and the quoted piece of that answer. */
  followUp: { cardId: string; quote: string } | null;
}

/** Practice sets are `training`; a Mock interview is a set in `mock` mode. Attempts carry the same mode. */
export const practiceModes = ["training", "mock"] as const;
export type PracticeMode = (typeof practiceModes)[number];

/** What a Mock interview shows in its header besides its Cards. */
export interface MockInterviewView {
  /** Milliseconds since the epoch. */
  startedAt: number;
  /** When it ended (early, on time, or by the Interviewer); `null` while it runs. */
  finishedAt: number | null;
  /** The chosen focus, in Russian, such as «слабые места». */
  focus: string;
}

export interface PracticeSetView {
  title: string;
  mode: PracticeMode;
  /** Only for a Mock interview; its `deadline` is when it ends. */
  mock: MockInterviewView | null;
  kind: PracticeSetKind;
  reveal: RevealMode;
  status: PracticeSetStatus;
  /** Milliseconds since the epoch when a timed Quiz submits itself or a Mock interview ends. */
  deadline: number | null;
  cards: CardView[];
  /** Totals once graded: points out of the maximum of the graded Cards, and Skipped Cards. */
  result: { score: number; max: number; skipped: number } | null;
}

/** A Practice set with its Cards; collapsed, it shows as a small result Card. */
export interface PracticeSetNode extends CanvasNodeBase {
  kind: "practice_set";
  data: PracticeSetView;
}

/** The single Chat node; the Canvas always has it, whether or not the Candidate shows it. */
export const chatNodeId = "chat";

export interface ChatNode extends CanvasNodeBase {
  id: typeof chatNodeId;
  kind: "chat";
  data: Record<string, never>;
}

export type CanvasNode = PracticeSetNode | ChatNode;
export type CanvasNodeKind = CanvasNode["kind"];

export interface CanvasSnapshot {
  nodes: CanvasNode[];
}

/** One node's layout change; omitted fields keep their stored value. */
export interface LayoutUpdate {
  nodeId: string;
  position?: CanvasPosition;
  collapsed?: boolean;
}

export interface LayoutUpdateRequest {
  updates: LayoutUpdate[];
}

export interface NodeLayoutEntry extends NodeLayout {
  nodeId: string;
}

// Agents and settings

export const agentIds = ["claude", "codex", "opencode"] as const;
export type AgentId = (typeof agentIds)[number];

export const agentLabels: Record<AgentId, string> = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
};

/** Whether a supported coding agent is installed on the Candidate's machine. */
export interface AgentAvailability {
  id: AgentId;
  label: string;
  installed: boolean;
  /** Where the agent's command was found, or how to install it when missing. */
  detail: string;
}

export interface AgentSettings {
  /** The agent the Interviewer runs on; `null` until the Candidate picks one. */
  agent: AgentId | null;
  /** Optional model per agent; the agent's own default when absent. */
  models: Partial<Record<AgentId, string>>;
}

export interface AgentsResponse {
  agents: AgentAvailability[];
  settings: AgentSettings;
}

export interface AgentSettingsUpdate {
  agent: AgentId;
  /** Empty or `null` returns to the agent's default model. */
  model?: string | null;
}

// Chat

/** `notice` carries app messages such as a plain-language agent error. */
export type ChatRole = "candidate" | "interviewer" | "notice";
export type ChatMessageStatus = "streaming" | "complete" | "cancelled" | "failed";

export interface ChatToolCall {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  /** App MCP server and tool when the call targets the app; absent for built-in tools. */
  server?: string;
  tool?: string;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  status: ChatMessageStatus;
  /** Milliseconds since the epoch. */
  createdAt: number;
  toolCalls: ChatToolCall[];
  /** The Card the message is about, such as after «Обсудить». */
  card?: { id: string; prompt: string };
}

export interface ChatSnapshot {
  messages: ChatMessage[];
  /** True while the Interviewer is replying; the Candidate can stop it. */
  busy: boolean;
}

export interface ChatSendRequest {
  text: string;
}

export type ServerEvent =
  | { type: "canvas.node_added"; node: CanvasNode }
  /** A node's content changed, such as a Card graded; its layout stays as it is. */
  | { type: "canvas.node_updated"; node: CanvasNode }
  | { type: "canvas.node_removed"; nodeId: string }
  | { type: "canvas.layout_changed"; layouts: NodeLayoutEntry[] }
  /** A message was added or changed (status, final text, tool calls). */
  | { type: "chat.message"; message: ChatMessage }
  /** Streamed text appended to a message. */
  | { type: "chat.delta"; messageId: string; text: string }
  | { type: "chat.busy"; busy: boolean }
  | { type: "agent.settings"; settings: AgentSettings }
  /** Preparation targets or the active one changed. */
  | { type: "targets.changed"; targets: TargetsResponse }
  /** The Question bank or the Proposed queue changed; `proposed` items wait for review. */
  | { type: "bank.changed"; proposed: number };

// Preparation targets and the Question bank

/** What the Control panel shows about one Preparation target; all numbers come from the server. */
export interface TargetSummary {
  id: string;
  name: string;
  role: string;
  grade: string | null;
  /** Local calendar date `YYYY-MM-DD`. */
  interviewDate: string | null;
  /** Calendar days until the interview date; `null` without a date or once it has passed. */
  daysLeft: number | null;
  /** Overall readiness 0–100; `null` while no Topic of the target has Mastery. */
  readiness: number | null;
  /** Questions of the target's Topics Due for repetition today. */
  due: number | null;
}

export interface TargetsResponse {
  activeId: string | null;
  targets: TargetSummary[];
}

export interface SwitchTargetRequest {
  targetId: string;
}

export interface TopicsResponse {
  topics: string[];
}

export interface AddQuestionRequest {
  /** Topic name; a new Topic is created when the bank has none by that name. */
  topic: string;
  prompt: string;
}

export interface AddQuestionResponse {
  questionId: string;
  topic: string;
}

// Practice and progress

export interface PracticeRequest {
  /** «Подборка на сегодня», «Подборка по теме…», or «Квиз». */
  kind: "today" | "topic" | "quiz";
  /** Topic name for `topic`. */
  topic?: string;
}

/** Most and fewest minutes a Mock interview may last. */
export const mockDurationLimits = { min: 5, max: 90 } as const;

export interface MockRequest {
  durationMinutes: number;
  /** The whole active Preparation target, its weak spots, or chosen Topics by name. */
  focus: { kind: "target" } | { kind: "weak_spots" } | { kind: "topics"; topics: string[] };
}

export interface RevealRequest {
  reveal: RevealMode;
}

export interface TopicProgress {
  topicId: string;
  name: string;
  /** Group Topic this one nests under. */
  group: string | null;
  priority: TopicPriority;
  /** 0–1; `null` for a never-touched Topic. */
  mastery: number | null;
  /** Active Questions in the Topic and its subtopics. */
  questions: number;
  due: number;
}

export interface ProgressResponse {
  targetId: string | null;
  readiness: number | null;
  due: number;
  topics: TopicProgress[];
}

// Hidden state

/** URI of the hidden state block sent first in every turn (ADR-0002). */
export const sessionStateUri = "app://session-state";

/** URI of the hidden block carrying an Activity's skill, sent once per Agent session. */
export const skillUri = (activity: string) => `app://skill/${activity}`;

/** URI of a hidden block of app facts for one turn, such as a graded Practice set or a discussed Card. */
export const appContextUri = (path: string) => `app://context/${path}`;

const hiddenStatePatterns = [
  /<context ref="app:\/\/[^"]*">[\s\S]*?<\/context>/g,
  /<session_state>[\s\S]*?<\/session_state>/g,
  /\[app:\/\/[^\]\s]*\]/g,
  /<activity_skill[^>]*>[\s\S]*?<\/activity_skill>/g,
  /<app_context[^>]*>[\s\S]*?<\/app_context>/g,
  /app:\/\/(?:session-state|skill\/[\w-]+|context\/[\w./-]+)/g,
];

/**
 * Removes echoes of the hidden state block from Chat text. Agents replay it on `session/load` in
 * their own formats: `<context ref="app://…">…</context>`, `[app://…]`, or bare
 * `<session_state>…</session_state>`, `<activity_skill>…</activity_skill>`, and `<app_context>…</app_context>`.
 */
export function stripHiddenState(text: string): string {
  if (!text.includes("app://") && !text.includes("<session_state>") && !text.includes("<activity_skill") && !text.includes("<app_context")) {
    return text;
  }
  let result = text;
  for (const pattern of hiddenStatePatterns) result = result.replace(pattern, "");
  return result === text ? text : result.trimStart();
}
