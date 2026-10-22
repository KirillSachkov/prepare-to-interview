import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { appContextUri, skillUri } from "@prepare-to-interview/shared";
import type { AllowedBuiltin, McpServerConfig, SessionConfig, TurnInput } from "../agent/driver.ts";
import type { ActivityKind } from "../db/schema.ts";
import type { Domain } from "../domain/domain.ts";
import type { MockAnswer, MockInterviews } from "../domain/mock.ts";
import type { CardContext, Practice, SetResult } from "../domain/practice.ts";
import { appContext } from "../agent/inert-json.ts";

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
  /** The running Mock interview; the app ends it at its deadline. */
  mock_interview: {
    id: string;
    focus: { topics: string[]; weak_spots: boolean };
    minutes_left: number;
    questions_asked: number;
    /** The Card waiting for the Candidate's answer; place no other Card meanwhile. */
    awaiting_answer_card_id: string | null;
  } | null;
  /** Whether a Research batch runs in the background, and how many Proposed items wait for review. */
  research: ResearchState;
}

export interface ResearchState {
  running: boolean;
  proposed_waiting: number;
}

/**
 * Hidden context blocks another part of the app has for the next turn, such as a finished
 * Research batch; `sent` runs once the agent took the turn.
 */
export interface TurnContextSource {
  take: () => { blocks: { uri: string; text: string }[]; sent: () => void };
}

export interface InterviewerOptions {
  /** Directory with `persona.md`, `skills/<activity>/SKILL.md`, and `references/`. */
  contentDir?: string;
  domain: Domain;
  practice: Practice;
  mock: MockInterviews;
  /** The app's MCP servers; read lazily because the URL is known only after the server listens. */
  mcpServers: () => McpServerConfig[];
  /** The Briefing a fresh Chat Agent session starts from (see `continuity.ts`). */
  briefings?: Briefings;
  now?: () => Date;
  /** Further hidden context for each turn. */
  turnContext?: TurnContextSource[];
  research?: () => ResearchState;
}

export interface Briefings {
  /** The Briefing for the session, or `null` once it has one. */
  briefing(agentSessionId: string): string | null;
  briefed(agentSessionId: string): void;
}

/** Activities that have a skill file in the product directory. */
const skilledActivities: readonly ActivityKind[] = ["onboarding", "practice_set", "mock_interview", "review"];

/** Skill directories named apart from their Activity. */
const skillDirs: Partial<Record<ActivityKind, string>> = { mock_interview: "interview" };

/** Shared references appended to an Activity's skill. */
const skillReferences: Partial<Record<ActivityKind, string[]>> = {
  practice_set: ["references/rubric.md", "references/modes.md"],
  mock_interview: ["references/modes.md"],
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
  readonly #mock: MockInterviews;
  readonly #mcpServers: () => McpServerConfig[];
  readonly #briefings: Briefings | undefined;
  readonly #now: () => Date;
  readonly #turnContext: TurnContextSource[];
  readonly #research: () => ResearchState;
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
    this.#mock = options.mock;
    this.#mcpServers = options.mcpServers;
    this.#briefings = options.briefings;
    this.#now = options.now ?? (() => new Date());
    this.#turnContext = options.turnContext ?? [];
    this.#research = options.research ?? (() => ({ running: false, proposed_waiting: 0 }));
  }

  /**
   * What the agent receives for one Candidate message in the given Agent session: the hidden
   * state; the Briefing when the session is new; until the session has the running Activity's
   * skill, that skill; results of Practice sets graded since the last turn; and the Card the
   * message is about, or the Candidate's answer when it is a Card of the running Mock interview. A Candidate without any
   * Preparation target starts in onboarding unless they skipped it before. Call `sent` once the
   * agent took the turn, so a failed turn sends the skill and the results again.
   */
  turnInput(text: string, agentSessionId: string, options: { cardId?: string; mockAnswer?: boolean } = {}): { input: TurnInput; sent: () => void } {
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
    const pending = !options.cardId && this.#mock.pendingAnswer();
    if (pending) context.push({ uri: appContextUri(`mock-answer/${pending.cardId}`), text: describeMockAnswer(pending) });
    if (options.cardId) {
      const answer = options.mockAnswer ? this.#mock.answerContext(options.cardId) : null;
      context.push(
        answer
          ? { uri: appContextUri(`mock-answer/${options.cardId}`), text: describeMockAnswer(answer) }
          : { uri: appContextUri(`card/${options.cardId}`), text: describeCard(this.#practice.cardContext(options.cardId)) },
      );
    }
    const extra = this.#turnContext.map((source) => source.take());
    for (const part of extra) context.push(...part.blocks);
    return {
      input: { text, hiddenState, ...(context.length && { context }) },
      sent: () => {
        if (briefing) this.#briefings?.briefed(agentSessionId);
        if (sendSkill) this.#delivered.add(key);
        this.#practice.markReported(results.map((r) => r.setId));
        for (const part of extra) part.sent();
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
      // The servers carry the Chat's role token, which end_session and the review rules act on.
      mcpServers: this.#mcpServers(),
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
      research: this.#research(),
      mock_interview: runningMock(this.#mock.running()),
    };
  }
}

/** A skill as the agent reads it: the skill file and its references, wrapped so the Chat can strip its echoes. */
function loadSkill(dir: string, kind: ActivityKind): string {
  const parts = [`${dir}/skills/${skillDirs[kind] ?? kind}/SKILL.md`, ...(skillReferences[kind] ?? []).map((ref) => `${dir}/${ref}`)];
  const body = parts.map((file) => fs.readFileSync(file, "utf8").trim()).join("\n\n");
  return `<activity_skill name="${kind}">\n${body}\n</activity_skill>`;
}

function unfinished(set: ReturnType<Practice["unfinished"]>): HiddenState["unfinished_practice_set"] {
  return set && { id: set.setId, title: set.title, answered: set.answered, cards: set.cards };
}

function runningMock(mock: ReturnType<MockInterviews["running"]>): HiddenState["mock_interview"] {
  return (
    mock && {
      id: mock.setId,
      focus: { topics: mock.focus.topics, weak_spots: mock.focus.weakSpots },
      minutes_left: mock.minutesLeft,
      questions_asked: mock.questionsAsked,
      awaiting_answer_card_id: mock.awaitingCardId,
    }
  );
}

/** The Candidate's answer in a running Mock interview: the Interviewer reacts and asks the next question. */
function describeMockAnswer(answer: MockAnswer): string {
  return appContext("mock_answer", {
    mock_interview_id: answer.setId,
    card_id: answer.cardId,
    question_number: answer.questionNumber,
    topic: answer.topic,
    type: answer.type,
    question: answer.question,
    ...(answer.options && { options: answer.options, chosen: answer.choices }),
    answer: answer.type === "open" ? answer.answer : undefined,
    said_dont_know: answer.dontKnow,
    follow_up_of: answer.followUpOf,
    minutes_left: answer.minutesLeft,
    note: answer.ended
      ? "The Mock interview has already ended: do not ask more questions. Say in one sentence that grades will appear on the Cards."
      : answer.dontKnow
      ? "The Candidate said they do not know. React neutrally in one short sentence and move on to another Question with next_mock_question."
      : "React neutrally in one short sentence: no grade, no hint, no teaching. Then call next_mock_question: a follow-up with follow_up_of set to this card_id and a quote copied verbatim from the answer, or a new Question. End with finish_mock_interview when the focus is covered or time is nearly up.",
  });
}

/** The grading result of a Practice set or a Mock interview, as hidden context for the Interviewer's next turn. */
function describeResult(result: SetResult): string {
  return appContext("practice_result", {
    practice_set_id: result.setId,
    title: result.title,
    kind: result.kind,
    mode: result.mode,
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
    note:
      result.mode === "mock"
        ? "The Mock interview is over and graded: the Candidate sees grades and feedback on the Cards and a summary in the Chat. When they reply, give the review: strengths first, then the single most important gap, one priority, and the next step. Never regrade on your own; a disputed grade is corrected only through correct_grade."
        : "The Candidate saw the grades on the Cards and a short summary in the Chat. Discuss weak spots when they ask. Never regrade on your own; a disputed grade is corrected only through correct_grade, as the skill says.",
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

function localIso(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  const local = new Date(date.getTime() + offset * 60_000).toISOString().slice(0, 19);
  return `${local}${sign}${pad(offset / 60)}:${pad(offset % 60)}`;
}
