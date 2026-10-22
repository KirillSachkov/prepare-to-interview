import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { appContextUri, skillUri } from "@prepare-to-interview/shared";
import type { AllowedBuiltin, McpServerConfig, SessionConfig, TurnInput } from "../agent/driver.ts";
import type { ActivityKind } from "../db/schema.ts";
import type { Domain } from "../domain/domain.ts";
import { callerHeader } from "../mcp/tool.ts";
import type { CardContext, Practice, SetResult } from "../domain/practice.ts";

export const defaultContentDir = fileURLToPath(new URL("../../../../interviewer", import.meta.url));

/** Hidden state the agent receives first in every turn; the Candidate never sees it. */
export interface HiddenState {
  app: "prepare-to-interview";
  /** Current local date and time, so the Interviewer can reason about days and deadlines. */
  now: string;
  /** Language the Interviewer replies in: the active Preparation target's, Russian by default. */
  language: string;
  /** The running Activity; its skill arrives as a separate hidden block once per Agent session. */
  activity: { id: string; kind: ActivityKind } | null;
  active_target: { id: string; name: string; days_left: number | null; due_questions: number | null; readiness: number | null } | null;
  has_profile: boolean;
  /** The Candidate's unsubmitted Practice set on the Canvas. */
  unfinished_practice_set: { id: string; title: string; answered: number; cards: number } | null;
}

export interface InterviewerOptions {
  /** Directory with `persona.md`, `skills/<activity>/SKILL.md`, and `references/`. */
  contentDir?: string;
  domain: Domain;
  practice: Practice;
  /** The app's MCP servers; read lazily because the URL is known only after the server listens. */
  mcpServers: () => McpServerConfig[];
  /** The Briefing a fresh Chat Agent session starts from (see `continuity.ts`). */
  briefings?: Briefings;
  now?: () => Date;
}

export interface Briefings {
  /** The Briefing for the session, or `null` once it has one. */
  briefing(agentSessionId: string): string | null;
  briefed(agentSessionId: string): void;
}

/** Activities that have a skill file in the product directory. */
const skilledActivities: readonly ActivityKind[] = ["onboarding", "practice_set", "review"];

/** Shared references appended to an Activity's skill. */
const skillReferences: Partial<Record<ActivityKind, string[]>> = {
  practice_set: ["references/rubric.md", "references/modes.md"],
};

/**
 * Seam between the Chat and Interviewer orchestration: decides what each Agent session gets
 * (persona, tools, MCP servers), starts Activities the server owns, and composes each turn's
 * hidden state, the Briefing of a fresh session, and the Activity's skill. Session rotation lives in `continuity.ts`.
 */
export class Interviewer {
  readonly #persona: string;
  readonly #skills: ReadonlyMap<ActivityKind, string>;
  readonly #domain: Domain;
  readonly #practice: Practice;
  readonly #mcpServers: () => McpServerConfig[];
  readonly #briefings: Briefings | undefined;
  readonly #now: () => Date;
  /** `<agent session>:<activity>` pairs whose skill the agent already has. */
  readonly #delivered = new Set<string>();
  #lastSession: string | undefined;
  readonly allowedBuiltins: AllowedBuiltin[] = ["web_fetch", "web_search"];

  constructor(options: InterviewerOptions) {
    const dir = options.contentDir ?? defaultContentDir;
    this.#persona = fs.readFileSync(`${dir}/persona.md`, "utf8");
    this.#skills = new Map(skilledActivities.map((kind) => [kind, loadSkill(dir, kind)]));
    this.#domain = options.domain;
    this.#practice = options.practice;
    this.#mcpServers = options.mcpServers;
    this.#briefings = options.briefings;
    this.#now = options.now ?? (() => new Date());
  }

  /**
   * What the agent receives for one Candidate message in the given Agent session: the hidden
   * state; the Briefing when the session is new; until the session has the running Activity's skill, that skill; results of Practice
   * sets graded since the last turn; and the Card the message is about. A Candidate without any
   * Preparation target starts in onboarding unless they skipped it before. Call `sent` once the
   * agent took the turn, so a failed turn sends the skill and the results again.
   */
  turnInput(text: string, agentSessionId: string, options: { cardId?: string } = {}): { input: TurnInput; sent: () => void } {
    this.#lastSession = agentSessionId;
    if (!this.#domain.targets().targets.length && !this.#domain.onboardingStarted() && !this.#domain.currentActivity()) {
      this.#domain.startActivity("onboarding");
    }
    const hiddenState = this.hiddenState();
    const activity = hiddenState.activity;
    const skill = activity && this.#skills.get(activity.kind);
    const key = activity && `${agentSessionId}:${activity.id}`;
    const context: NonNullable<TurnInput["context"]> = [];
    const briefing = this.#briefings?.briefing(agentSessionId);
    if (briefing) context.push({ uri: appContextUri("briefing"), text: briefing });
    const sendSkill = skill && key && !this.#delivered.has(key);
    if (sendSkill) context.push({ uri: skillUri(activity.kind), text: skill });
    const results = this.#practice.unreported();
    for (const result of results) context.push({ uri: appContextUri(`practice-set/${result.setId}`), text: describeResult(result) });
    if (options.cardId) {
      context.push({ uri: appContextUri(`card/${options.cardId}`), text: describeCard(this.#practice.cardContext(options.cardId)) });
    }
    return {
      input: { text, hiddenState, ...(context.length && { context }) },
      sent: () => {
        if (briefing) this.#briefings?.briefed(agentSessionId);
        if (sendSkill) this.#delivered.add(key);
        this.#practice.markReported(results.map((r) => r.setId));
      },
    };
  }

  /**
   * The skill text for an Activity started by a tool call during a turn; the tool returns it to
   * the agent, so the next turn of the same Agent session does not send it again.
   */
  skillForStartedActivity(activity: { id: string; kind: ActivityKind }): string | undefined {
    const skill = this.#skills.get(activity.kind);
    if (skill && this.#lastSession) this.#delivered.add(`${this.#lastSession}:${activity.id}`);
    return skill;
  }

  sessionConfig(model: string | undefined): SessionConfig {
    return {
      persona: this.#persona,
      allowedBuiltins: this.allowedBuiltins,
      // Marks the Chat's tool calls, which end_session and the review rules act on.
      mcpServers: this.#mcpServers().map((server) => ({ ...server, headers: [...server.headers, { name: callerHeader, value: "chat" }] })),
      ...(model && { model }),
    };
  }

  hiddenState(): HiddenState {
    const { activeTarget, profile, activity } = this.#domain.overview();
    return {
      app: "prepare-to-interview",
      now: localIso(this.#now()),
      language: activeTarget?.language ?? "ru",
      activity: activity && { id: activity.id, kind: activity.kind },
      active_target: activeTarget && {
        id: activeTarget.id,
        name: activeTarget.name,
        days_left: activeTarget.daysLeft,
        due_questions: activeTarget.due,
        readiness: activeTarget.readiness,
      },
      has_profile: profile !== null,
      unfinished_practice_set: unfinished(this.#practice.unfinished()),
    };
  }
}

/** A skill as the agent reads it: the skill file and its references, wrapped so the Chat can strip its echoes. */
function loadSkill(dir: string, kind: ActivityKind): string {
  const parts = [`${dir}/skills/${kind}/SKILL.md`, ...(skillReferences[kind] ?? []).map((ref) => `${dir}/${ref}`)];
  const body = parts.map((file) => fs.readFileSync(file, "utf8").trim()).join("\n\n");
  return `<activity_skill name="${kind}">\n${body}\n</activity_skill>`;
}

function unfinished(set: ReturnType<Practice["unfinished"]>): HiddenState["unfinished_practice_set"] {
  return set && { id: set.setId, title: set.title, answered: set.answered, cards: set.cards };
}

/** The grading result of a Practice set, as hidden context for the Interviewer's next turn. */
function describeResult(result: SetResult): string {
  return appContext("practice_result", {
    practice_set_id: result.setId,
    title: result.title,
    kind: result.kind,
    score: result.score,
    max: result.max,
    skipped: result.skipped,
    cards: result.cards.map((c) => ({
      topic: c.topic,
      question: c.prompt,
      status: c.status,
      score: c.score,
      max_score: c.maxScore,
      hints_used: c.hintsUsed,
      gap: c.gap,
    })),
    note: "The Candidate saw the grades on the Cards and a short summary in the Chat. Discuss weak spots when they ask. Never regrade on your own; a disputed grade is corrected only through correct_grade, as the skill says.",
  });
}

/** A Card the Candidate brought into the Chat with «Обсудить». */
function describeCard(card: CardContext): string {
  return appContext("card", {
    card_id: card.cardId,
    practice_set: card.setTitle,
    topic: card.topic,
    type: card.type,
    question: card.question,
    ...(card.options && { options: card.options, chosen: card.choices }),
    answer: card.type === "open" ? card.answer : undefined,
    status: card.status,
    hints_used: card.hintsUsed,
    attempt: card.attempt && {
      status: card.attempt.status,
      score: card.attempt.score,
      max_score: card.attempt.maxScore,
      quote: card.attempt.quote,
      right: card.attempt.strengths,
      gap: card.attempt.gap,
    },
    reference_answer: card.referenceAnswer,
    note: card.attempt
      ? "The Candidate wants to discuss this Card."
      : "The Candidate wants to discuss this Card before answering: help without giving away the answer.",
  });
}

function appContext(name: string, data: unknown): string {
  return `<app_context name="${name}">\n${JSON.stringify(data, null, 2)}\n</app_context>`;
}

function localIso(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  const local = new Date(date.getTime() + offset * 60_000).toISOString().slice(0, 19);
  return `${local}${sign}${pad(offset / 60)}:${pad(offset % 60)}`;
}
