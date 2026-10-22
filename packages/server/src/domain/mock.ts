// Mock interviews of the domain core (ADR-0004): a Practice set in `mock` mode whose Cards the
// Interviewer places one at a time, follow-ups quoting the Candidate's answer, a deadline the
// server enforces, and grading of every answer only once the mock ends.
import crypto from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { MockInterviewView, PracticeSetNode, QuestionType } from "@prepare-to-interview/shared";
import type { Database } from "../db/database.ts";
import { cards, practiceSets, questions, topics, type MockFocus } from "../db/schema.ts";
import { DomainError, type Domain, type PracticeQuestion } from "./domain.ts";
import type { GradingJob, Practice } from "./practice.ts";

/** Most Cards one Mock interview holds. */
export const maxMockCards = 20;
const minute = 60_000;

export const mockEndReasons = ["early", "time", "interviewer"] as const;
/** Why a Mock interview ended: the Candidate ended it early, its time ran out, or the Interviewer ended it. */
export type MockEndReason = (typeof mockEndReasons)[number];

export interface MockStartInput {
  durationMinutes: number;
  focus: MockFocus;
}

export interface MockQuestionInput {
  question: PracticeQuestion;
  /** An answered Card of this mock the new Card follows up on. */
  followUpOf?: string;
  /** A piece of that Card's answer, verbatim; required with `followUpOf`. */
  quote?: string;
}

/** The running Mock interview, as the hidden state and the tools report it. */
export interface RunningMock {
  setId: string;
  activityId: string;
  startedAt: Date;
  deadline: Date;
  focus: MockFocus;
  minutesLeft: number;
  questionsAsked: number;
  /** The Card on the Canvas waiting for the Candidate's answer. */
  awaitingCardId: string | null;
}

/** A Candidate's answer in a running Mock interview, as the Interviewer receives it next turn. */
export interface MockAnswer {
  setId: string;
  cardId: string;
  questionNumber: number;
  topic: string;
  type: QuestionType;
  question: string;
  options: string[] | null;
  /** The open answer; empty when the Candidate said they do not know. */
  answer: string;
  choices: number[];
  /** The Candidate gave no answer («Не знаю»). */
  dontKnow: boolean;
  followUpOf: string | null;
  minutesLeft: number;
  /** The mock already ended, such as when its time ran out right after the answer. */
  ended: boolean;
}

export interface MockEnd {
  setId: string;
  activityId: string;
  reason: MockEndReason;
  questionCount: number;
  node: PracticeSetNode;
  jobs: GradingJob[];
}

type SetRow = typeof practiceSets.$inferSelect;
type CardRow = typeof cards.$inferSelect;

/**
 * Mock interviews on top of Practice: one runs at a time, inside a mock_interview Activity. Its
 * Attempts are recorded with mode `mock` once it ends, through the same grading as Practice sets.
 */
export class MockInterviews {
  readonly #db: Database;
  readonly #domain: Domain;
  readonly #practice: Practice;
  readonly #now: () => Date;

  constructor(options: { db: Database; domain: Domain; practice: Practice; now: () => Date }) {
    this.#db = options.db;
    this.#domain = options.domain;
    this.#practice = options.practice;
    this.#now = options.now;
  }

  // Reads

  running(): RunningMock | null {
    const set = this.#runningSet();
    if (!set?.deadline) return null;
    const rows = this.#cards(set.id);
    return {
      setId: set.id,
      activityId: set.activityId,
      startedAt: set.createdAt,
      deadline: set.deadline,
      focus: set.focus ?? { topics: [], weakSpots: false },
      minutesLeft: this.#minutesLeft(set),
      questionsAsked: rows.length,
      awaitingCardId: rows.find((c) => c.status === "open")?.id ?? null,
    };
  }

  /** Whether the running Mock interview is past its deadline and must end. */
  overdue(): boolean {
    const set = this.#runningSet();
    return set?.deadline !== undefined && set.deadline !== null && set.deadline.getTime() <= this.#now().getTime();
  }

  /**
   * The answer the Candidate gave on a Mock interview Card, also when the mock ended since (the
   * time ran out before the Interviewer's turn); null for other Cards and once the Card is graded.
   */
  answerContext(cardId: string): MockAnswer | null {
    const card = this.#db.select().from(cards).where(eq(cards.id, cardId)).get();
    const set = card && this.#db.select().from(practiceSets).where(eq(practiceSets.id, card.setId)).get();
    // Once graded, a Card is discussed like any other.
    if (!card || set?.mode !== "mock" || (card.status !== "answered" && card.status !== "grading")) return null;
    return this.#answer(set, card);
  }

  /**
   * The latest answer of the running Mock interview while no Card awaits one, such as after the
   * Interviewer's turn on it failed or was stopped; the next turn picks the interview up from it.
   */
  pendingAnswer(): MockAnswer | null {
    const set = this.#runningSet();
    const last = set && this.#cards(set.id).at(-1);
    return set && last?.status === "answered" ? this.#answer(set, last) : null;
  }

  // Changes

  /** Starts a Mock interview with a deadline the server enforces; its node appears on the Canvas. */
  start(input: MockStartInput): { node: PracticeSetNode; activity: { id: string; started: boolean } } {
    if (this.#runningSet()) {
      throw new DomainError(
        "A Mock interview is already running.",
        "Continue it with next_mock_question, or end it with finish_mock_interview.",
        { candidateMessage: "мок-интервью уже идёт." },
      );
    }
    const unfinished = this.#practice.unfinished();
    if (unfinished) {
      throw new DomainError(
        `The Candidate has an unsubmitted Practice set "${unfinished.title}" (${unfinished.answered} of ${unfinished.cards} Cards answered).`,
        "Ask the Candidate to submit it first; start the Mock interview after that.",
        { candidateMessage: "сначала отправьте текущую подборку." },
      );
    }
    const topics = input.focus.topics.map((name) => {
      const topicId = this.#domain.findTopic(name);
      if (!topicId) throw new DomainError(`The bank has no Topic "${name}".`, "Use Topic names from get_progress, or omit topics.", { kind: "not_found", candidateMessage: `темы «${name}» нет в банке.` });
      return name.trim();
    });
    const targetId = this.#domain.activeTargetId();
    const { activity, started } = this.#domain.startActivity("mock_interview", { targetId });
    // Auto-tidy as for a new Practice set (ADR-0004).
    this.#practice.tidyResults();
    const now = this.#now();
    const id = crypto.randomUUID();
    this.#db
      .insert(practiceSets)
      .values({
        id,
        activityId: activity.id,
        targetId,
        title: "Мок-интервью",
        kind: "practice",
        reveal: "after_submit",
        status: "active",
        mode: "mock",
        deadline: new Date(now.getTime() + input.durationMinutes * minute),
        focus: { topics, weakSpots: input.focus.weakSpots },
        createdAt: now,
      })
      .run();
    return { node: this.#practice.placeNode(id), activity: { id: activity.id, started } };
  }

  /**
   * Places the next Card: one at a time, only once the previous one is answered and before the
   * deadline. A follow-up names the answered Card it probes and quotes that answer verbatim.
   */
  ask(input: MockQuestionInput): { cardId: string; questionNumber: number; minutesLeft: number } {
    const set = this.#runningSet();
    if (!set) throw noMock();
    if (this.overdue()) throw new DomainError("The Mock interview time is up.", "Call finish_mock_interview.");
    const rows = this.#cards(set.id);
    const awaiting = rows.find((c) => c.status === "open");
    if (awaiting) {
      throw new DomainError(
        `The Candidate has not answered question ${awaiting.position + 1} yet.`,
        "Wait for the Candidate's answer; it arrives in your next turn. Do not place another Card now.",
      );
    }
    if (rows.length >= maxMockCards) {
      throw new DomainError(`A Mock interview holds at most ${maxMockCards} Cards.`, "Call finish_mock_interview.");
    }
    const quote = this.#checkFollowUp(rows, input);
    this.#practice.checkQuestions({ kind: "practice", questions: [input.question] });
    const [questionId] = this.#domain.practiceQuestions([input.question]);
    if (!questionId) throw new Error("practiceQuestions returned no Question.");
    if (rows.some((c) => c.questionId === questionId)) {
      throw new DomainError("This Question was already asked in this Mock interview.", "Ask another Question, or a follow-up with a new prompt.");
    }
    const cardId = crypto.randomUUID();
    this.#db
      .insert(cards)
      .values({
        id: cardId,
        setId: set.id,
        questionId,
        position: rows.length,
        status: "open",
        draftChoices: [],
        followUpOf: input.followUpOf ?? null,
        followUpQuote: quote,
      })
      .run();
    this.#practice.changed(set.id);
    return { cardId, questionNumber: rows.length + 1, minutesLeft: this.#minutesLeft(set) };
  }

  /** Takes the Card's saved draft as the Candidate's answer; it is graded only when the mock ends. */
  answer(cardId: string): { node: PracticeSetNode; answer: MockAnswer } {
    const card = this.#db.select().from(cards).where(eq(cards.id, cardId)).get();
    const set = this.#runningSet();
    if (!card || !set || card.setId !== set.id) {
      throw new DomainError(`Card "${cardId}" is not in a running Mock interview.`, "Use the open Card of the running Mock interview.", {
        kind: "not_found",
        candidateMessage: "эта карточка не из идущего мок-интервью. Обновите страницу.",
      });
    }
    if (card.status !== "open") throw new DomainError("This Card is already answered.", "Answer the open Card.", { candidateMessage: "на карточку уже есть ответ." });
    if (this.overdue()) throw new DomainError("The Mock interview time is up.", "Reload the Canvas.", { candidateMessage: "время интервью вышло." });
    this.#db.update(cards).set({ status: "answered" }).where(eq(cards.id, cardId)).run();
    const node = this.#practice.changed(set.id);
    return { node, answer: this.#answer(set, { ...card, status: "answered" }) };
  }

  /**
   * Ends the running Mock interview and completes its Activity. The open Card's saved draft counts
   * as its answer; Cards without an answer become Skipped. Returns the grading jobs of open answers.
   */
  finish(reason: MockEndReason, setId?: string): MockEnd {
    const set = this.#runningSet();
    if (!set || (setId !== undefined && set.id !== setId)) {
      throw new DomainError("No Mock interview is running.", "Nothing to finish.", { kind: setId ? "not_found" : "invalid", candidateMessage: "мок-интервью уже завершено." });
    }
    const questionCount = this.#cards(set.id).length;
    const { node, jobs } = this.#practice.submit(set.id, { endingMock: true });
    this.#domain.completeActivity(set.activityId, `Mock interview (${mockFocusLabel(set.focus)}): ${questionCount} questions; ${endedBy[reason]}.`);
    return { setId: set.id, activityId: set.activityId, reason, questionCount, node, jobs };
  }

  // Internals

  #checkFollowUp(rows: CardRow[], input: MockQuestionInput): string | null {
    if (input.followUpOf === undefined) {
      if (input.quote !== undefined) throw new DomainError("A quote belongs to a follow-up.", 'Pass "follow_up_of" with the Card id the quote comes from, or drop "quote".');
      return null;
    }
    const parent = rows.find((c) => c.id === input.followUpOf);
    if (!parent) throw new DomainError(`Card "${input.followUpOf}" is not in this Mock interview.`, "Use a card_id from next_mock_question.", { kind: "not_found" });
    if (parent.status !== "answered") throw new DomainError("A follow-up probes an answered Card.", "Follow up on a Card the Candidate already answered.");
    const quote = input.quote?.trim();
    if (!quote) throw new DomainError("A follow-up quotes the Candidate's answer.", 'Pass "quote" with a short piece of their answer, copied verbatim.');
    if (!normalize(parent.draftText).includes(normalize(quote))) {
      throw new DomainError("The quote is not in the Candidate's answer.", "Copy a short piece of the answer verbatim, as it appears in the answer context.");
    }
    return quote;
  }

  #answer(set: SetRow, card: CardRow): MockAnswer {
    const row = this.#db
      .select({ question: questions, topic: topics.name })
      .from(questions)
      .innerJoin(topics, eq(topics.id, questions.topicId))
      .where(eq(questions.id, card.questionId))
      .get();
    if (!row) throw new Error(`Card refers to a missing Question ${card.questionId}.`);
    const { question, topic } = row;
    return {
      setId: set.id,
      cardId: card.id,
      questionNumber: card.position + 1,
      topic,
      type: question.type,
      question: question.prompt,
      options: question.options?.map((o) => o.text) ?? null,
      answer: card.draftText,
      choices: card.draftChoices,
      dontKnow: question.type === "open" ? !card.draftText.trim() : !card.draftChoices.length,
      followUpOf: card.followUpOf,
      minutesLeft: set.status === "active" ? this.#minutesLeft(set) : 0,
      ended: set.status !== "active",
    };
  }

  #runningSet(): SetRow | undefined {
    return this.#db
      .select()
      .from(practiceSets)
      .where(and(eq(practiceSets.status, "active"), eq(practiceSets.mode, "mock")))
      .orderBy(asc(practiceSets.createdAt))
      .get();
  }

  #cards(setId: string): CardRow[] {
    return this.#db.select().from(cards).where(eq(cards.setId, setId)).orderBy(asc(cards.position)).all();
  }

  #minutesLeft(set: SetRow): number {
    return Math.max(0, Math.ceil(((set.deadline?.getTime() ?? 0) - this.#now().getTime()) / minute));
  }
}

/** How a set shows as a Mock interview; null for a Practice set. */
export function mockView(set: SetRow): MockInterviewView | null {
  if (set.mode !== "mock") return null;
  return { startedAt: set.createdAt.getTime(), finishedAt: set.submittedAt?.getTime() ?? null, focus: mockFocusLabel(set.focus) };
}

/** The Mock interview focus as the Candidate reads it. */
export function mockFocusLabel(focus: MockFocus | null): string {
  const parts = [...(focus?.topics ?? []), ...(focus?.weakSpots ? ["слабые места"] : [])];
  return parts.length ? parts.join(", ") : "вся цель подготовки";
}

const endedBy: Record<MockEndReason, string> = {
  early: "the Candidate ended it early",
  time: "the time ran out",
  interviewer: "the Interviewer ended it",
};

function noMock(): DomainError {
  return new DomainError("No Mock interview is running.", "Call start_mock_interview first, once the Candidate chose duration and focus.");
}

/** Whitespace- and case-insensitive text, so a quote survives line breaks and capitalization. */
function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}
