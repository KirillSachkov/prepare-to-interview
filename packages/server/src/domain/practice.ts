// Practice sets, Cards, and Attempts of the domain core (ADR-0004). Every Card action goes
// through here: drafts, hints, Skipped, test checks, Grader results, retries. Scheduling and
// Mastery follow each Attempt in the same transaction.
import crypto from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import {
  maxAnswerLength,
  maxPracticeCards,
  wideSetCards,
  type CardDraft,
  type CardStatus,
  type CardView,
  type PracticeSetNode,
  type PracticeSetView,
  type QuestionType,
} from "@prepare-to-interview/shared";
import type { Canvas } from "../canvas/canvas.ts";
import type { Database } from "../db/database.ts";
import {
  attempts,
  cards,
  practiceSets,
  preparationTargets,
  questions,
  topics,
  type AttemptMode,
  type PracticeSetKind,
  type RevealMode,
  type RubricAnchors,
} from "../db/schema.ts";
import { checkTest, correctOptions, hintCap, maxHintRungs, maxScore } from "./arithmetic.ts";
import { DomainError, languages, localDate, type Domain, type Language, type PracticeQuestion } from "./domain.ts";
import type { Tx } from "./progress.ts";

export interface PlaceSetInput {
  title: string;
  kind: PracticeSetKind;
  /** Defaults to `after_submit`; a Quiz always shows each grade right away. */
  reveal?: RevealMode;
  /** A timed Quiz submits itself after this many minutes. */
  timeLimitMinutes?: number | null;
  /** Drops the Candidate's unsubmitted Practice set; the Candidate must have agreed. */
  replaceUnfinished?: boolean;
  /** Mode of the set's Attempts; `training` unless a Mock interview places the Cards. */
  mode?: AttemptMode;
  questions: PracticeQuestion[];
}

/** An open answer waiting for the Grader: only what the Grader may see. */
export interface GradingJob {
  cardId: string;
  question: string;
  referenceAnswer: string;
  rubricAnchors: RubricAnchors | null;
  answer: string;
  /** Language of the feedback: the Preparation target's, Russian by default. */
  language: Language;
}

/** The Grader's verdict on one answer, before the Hint ladder cap. */
export interface Grade {
  score: number;
  quote: string;
  strengths: string;
  gap: string;
}

export interface CardResult {
  cardId: string;
  topic: string;
  prompt: string;
  status: "graded" | "skipped";
  score: number | null;
  maxScore: number;
  hintsUsed: number;
  gap: string | null;
}

/** A graded Practice set as the Chat summary and the Interviewer receive it. */
export interface SetResult {
  setId: string;
  title: string;
  kind: PracticeSetKind;
  score: number;
  max: number;
  skipped: number;
  cards: CardResult[];
}

/** An Attempt's outcome and evidence, as Cards and the Interviewer see it. */
export interface AttemptEvidence {
  status: "graded" | "skipped";
  score: number | null;
  maxScore: number;
  quote: string | null;
  strengths: string | null;
  gap: string | null;
  /** Set once the Interviewer corrected a disputed grade. */
  corrected?: { from: number; reason: string };
}

/** What the Interviewer receives when the Candidate brings a Card into the Chat. */
export interface CardContext {
  cardId: string;
  setTitle: string;
  topic: string;
  type: QuestionType;
  question: string;
  options: string[] | null;
  answer: string;
  choices: number[];
  status: CardStatus;
  hintsUsed: number;
  attempt: AttemptEvidence | null;
  /** Only once an Attempt exists, so the Interviewer does not give it away. */
  referenceAnswer: string | null;
}

type SetRow = typeof practiceSets.$inferSelect;
type CardRow = typeof cards.$inferSelect;
type QuestionRow = typeof questions.$inferSelect;
type AttemptRow = typeof attempts.$inferSelect;

/** A graded Practice set that left the Canvas for history. */
export interface HistoryEntry {
  id: string;
  gradedAt: Date;
  archivedAt: Date;
  set: PracticeSetView;
}

/** A disputed grade the Interviewer corrects after agreeing with the Candidate. */
export interface GradeCorrection {
  score: number;
  reason: string;
  gap?: string | undefined;
  strengths?: string | undefined;
}

/** Server-side width estimates for placing the next node to the right; the client renders these widths. */
const wideSetWidth = 800;
const narrowSetWidth = 440;
const resultCardWidth = 260;

export interface PracticeOptions {
  db: Database;
  domain: Domain;
  canvas: Canvas;
  now: () => Date;
}

export class Practice {
  readonly #db: Database;
  readonly #domain: Domain;
  readonly #canvas: Canvas;
  readonly #now: () => Date;
  readonly #gradedListeners: ((result: SetResult) => void)[] = [];

  constructor(options: PracticeOptions) {
    this.#db = options.db;
    this.#domain = options.domain;
    this.#canvas = options.canvas;
    this.#now = options.now;
    this.#canvas.addSource(() => {
      this.archiveStale();
      return this.nodes();
    });
  }

  /** Runs after a Practice set's last Card got its Attempt. */
  onGraded(listener: (result: SetResult) => void): void {
    this.#gradedListeners.push(listener);
  }

  // Reads

  /** Practice sets on the Canvas, oldest first; sets in history are left out. */
  nodes(): PracticeSetNode[] {
    const sets = this.#db
      .select()
      .from(practiceSets)
      .where(and(ne(practiceSets.status, "abandoned"), isNull(practiceSets.archivedAt)))
      .orderBy(asc(practiceSets.createdAt))
      .all();
    const layouts = this.#canvas.layouts(sets.map((s) => s.id));
    return sets.flatMap((s) => {
      const layout = layouts.get(s.id);
      return layout ? [{ id: s.id, kind: "practice_set" as const, ...layout, data: this.#view(s) }] : [];
    });
  }

  node(setId: string): PracticeSetNode {
    const set = this.#set(setId);
    const layout = this.#canvas.layouts([setId]).get(setId);
    if (!layout) throw unknownSet(setId);
    return { id: set.id, kind: "practice_set", ...layout, data: this.#view(this.#liveSet(setId)) };
  }

  /** The unsubmitted Practice set, if the Candidate has one; a timed Quiz past its deadline does not count. */
  unfinished(): { setId: string; title: string; answered: number; cards: number } | null {
    const set = this.#db
      .select()
      .from(practiceSets)
      .where(eq(practiceSets.status, "active"))
      .orderBy(asc(practiceSets.createdAt))
      .all()
      .find((s) => !this.#expired(s));
    if (!set) return null;
    const rows = this.#cards(set.id);
    const answered = rows.filter((c) => c.status !== "open" || c.draftText.trim() || c.draftChoices.length).length;
    return { setId: set.id, title: set.title, answered, cards: rows.length };
  }

  cardContext(cardId: string): CardContext {
    const card = this.#card(cardId);
    const set = this.#liveSet(card.setId);
    const question = this.#question(card.questionId);
    const attempt = card.attemptId ? this.#attempt(card.attemptId) : undefined;
    return {
      cardId,
      setTitle: set.title,
      topic: this.#topicName(question.topicId),
      type: question.type,
      question: question.prompt,
      options: question.options?.map((o) => o.text) ?? null,
      answer: attempt?.answer ?? card.draftText,
      choices: attempt?.choices ?? card.draftChoices,
      status: card.status,
      hintsUsed: card.hintsUsed,
      attempt: attempt ? evidence(attempt) : null,
      referenceAnswer: attempt ? question.referenceAnswer : null,
    };
  }

  /** The prompt of a Card's Question, for references in the Chat. */
  cardPrompt(cardId: string): string | undefined {
    return this.#db
      .select({ prompt: questions.prompt })
      .from(cards)
      .innerJoin(questions, eq(questions.id, cards.questionId))
      .where(eq(cards.id, cardId))
      .get()?.prompt;
  }

  /** Graded Practice sets the Interviewer has not received yet, oldest first. */
  unreported(): SetResult[] {
    return this.#db
      .select()
      .from(practiceSets)
      .where(and(eq(practiceSets.status, "graded"), isNull(practiceSets.reportedAt)))
      .orderBy(asc(practiceSets.gradedAt))
      .all()
      .map((s) => this.#result(s));
  }

  /** Graded Practice sets in history, most recently graded first. */
  history(limit = 50): HistoryEntry[] {
    return this.#db
      .select()
      .from(practiceSets)
      .where(isNotNull(practiceSets.archivedAt))
      .orderBy(desc(practiceSets.gradedAt), desc(sql`rowid`))
      .limit(limit)
      .all()
      .map((s) => ({ id: s.id, gradedAt: s.gradedAt ?? s.createdAt, archivedAt: s.archivedAt ?? s.createdAt, set: this.#view(s) }));
  }

  markReported(setIds: string[]): void {
    if (!setIds.length) return;
    this.#db.update(practiceSets).set({ reportedAt: this.#now() }).where(inArray(practiceSets.id, setIds)).run();
  }

  // Changes

  /**
   * Places a Practice set or a Quiz on the Canvas within a practice_set Activity. Graded sets
   * still expanded collapse into result Cards. An unsubmitted set blocks a new one unless the
   * Candidate agreed to drop it (`replaceUnfinished`).
   */
  placeSet(input: PlaceSetInput): { node: PracticeSetNode; activity: { id: string; started: boolean } } {
    if (!input.questions.length || input.questions.length > maxPracticeCards) {
      throw new DomainError(`A Practice set holds 1 to ${maxPracticeCards} Cards.`, `Pass 1-${maxPracticeCards} questions.`);
    }
    this.#checkQuestions(input);
    const unfinished = this.unfinished();
    if (unfinished && !input.replaceUnfinished) {
      throw new DomainError(
        `The Candidate has an unsubmitted Practice set "${unfinished.title}" (${unfinished.answered} of ${unfinished.cards} Cards answered).`,
        'Ask the Candidate to submit it first, or whether to drop it; once they agree to drop it, call again with "replace_unfinished": true.',
        { candidateMessage: "сначала отправьте текущую подборку." },
      );
    }
    const questionIds = this.#domain.practiceQuestions(input.questions);
    if (new Set(questionIds).size !== questionIds.length) {
      throw new DomainError("The same Question is listed twice.", "List each Question once.");
    }
    const { activity, started } = this.#domain.startActivity("practice_set", { targetId: this.#domain.activeTargetId() });
    this.archiveStale();
    const now = this.#now();
    const id = crypto.randomUUID();
    const collapse: string[] = [];
    const archive: string[] = [];
    const expired = this.#db.select().from(practiceSets).where(eq(practiceSets.status, "active")).all().filter((s) => this.#expired(s));
    this.#db.transaction((tx) => {
      if (unfinished) tx.update(practiceSets).set({ status: "abandoned" }).where(eq(practiceSets.id, unfinished.setId)).run();
      // A timed Quiz whose time ran out with nobody to submit it is submitted now: tests need no Grader.
      for (const set of expired) {
        for (const card of this.#cards(set.id, tx)) if (card.status === "open") this.#answer(tx, card);
        tx.update(practiceSets).set({ status: "grading", submittedAt: set.deadline }).where(eq(practiceSets.id, set.id)).run();
      }
      // Auto-tidy (ADR-0004): the latest result Card stays collapsed next to the new set; older ones move to history.
      const results = tx
        .select({ id: practiceSets.id })
        .from(practiceSets)
        .where(and(eq(practiceSets.status, "graded"), isNull(practiceSets.archivedAt)))
        // Insertion order breaks ties within a millisecond.
        .orderBy(desc(practiceSets.gradedAt), desc(sql`rowid`))
        .all()
        .map((r) => r.id);
      collapse.push(...results.slice(0, 1));
      archive.push(...results.slice(1));
      if (archive.length) tx.update(practiceSets).set({ archivedAt: now }).where(inArray(practiceSets.id, archive)).run();
      tx.insert(practiceSets)
        .values({
          id,
          activityId: activity.id,
          targetId: this.#domain.activeTargetId(),
          title: input.title,
          kind: input.kind,
          reveal: input.kind === "quiz" ? "each_answer" : (input.reveal ?? "after_submit"),
          status: "active",
          mode: input.mode ?? "training",
          deadline: input.timeLimitMinutes ? new Date(now.getTime() + input.timeLimitMinutes * 60_000) : null,
          createdAt: now,
        })
        .run();
      tx.insert(cards)
        .values(questionIds.map((questionId, position) => ({ id: crypto.randomUUID(), setId: id, questionId, position, status: "open" as const, draftChoices: [] })))
        .run();
    });
    if (unfinished) this.#canvas.removed(unfinished.setId);
    for (const setId of archive) this.#canvas.removed(setId);
    for (const set of expired) this.#settle(set.id);
    const expanded = [...this.#canvas.layouts(collapse).entries()].filter(([, l]) => !l.collapsed).map(([nodeId]) => nodeId);
    if (expanded.length) this.#canvas.updateLayout(expanded.map((nodeId) => ({ nodeId, collapsed: true })));
    this.#canvas.place(id, this.#rightmostWidth(id));
    const node = this.node(id);
    this.#canvas.added(node);
    return { node, activity: { id: activity.id, started } };
  }

  /** Stores the Candidate's draft on an open Card; it survives reload. */
  saveDraft(cardId: string, draft: Partial<CardDraft>): void {
    const card = this.#openCard(cardId);
    if (this.#expired(this.#set(card.setId))) throw invalid("The Quiz time is up.", "время квиза вышло.");
    const question = this.#question(card.questionId);
    const update: Partial<CardRow> = {};
    if (draft.text !== undefined) {
      if (draft.text.length > maxAnswerLength) throw invalid(`The answer is longer than ${maxAnswerLength} characters.`, `ответ длиннее ${maxAnswerLength} символов.`);
      update.draftText = draft.text;
    }
    if (draft.choices !== undefined) update.draftChoices = checkChoices(question, draft.choices);
    this.#db.update(cards).set(update).where(eq(cards.id, cardId)).run();
  }

  /** Reveals the next Hint ladder rung of an open-answer Card; it lowers the maximum score by one. */
  hint(cardId: string): PracticeSetNode {
    const card = this.#openCard(cardId);
    const question = this.#question(card.questionId);
    if (card.hintsUsed >= hintRungs(question)) throw invalid("This Card has no more hints.", "подсказок больше нет.");
    this.#db.update(cards).set({ hintsUsed: card.hintsUsed + 1 }).where(eq(cards.id, cardId)).run();
    return this.#changed(card.setId);
  }

  /** Records the Card as Skipped: a status, not a score of 0. */
  skip(cardId: string): PracticeSetNode {
    const card = this.#card(cardId);
    // A Card whose grading failed can still be skipped instead of checked again.
    if (card.status !== "failed") this.#openCard(cardId);
    else this.#liveSet(card.setId);
    this.#db.transaction((tx) => this.#record(tx, card, { skipped: true }));
    return this.#settle(card.setId);
  }

  /**
   * Submits the whole Practice set: test Cards are checked at once, unanswered Cards become
   * Skipped, and open answers wait for the Grader. Returns the grading jobs.
   */
  submit(setId: string): { node: PracticeSetNode; jobs: GradingJob[] } {
    const set = this.#set(setId);
    if (set.status !== "active") {
      throw invalid(`Practice set "${set.title}" was already submitted.`, "подборка уже отправлена.");
    }
    const jobs: GradingJob[] = [];
    this.#db.transaction((tx) => {
      for (const card of this.#cards(setId, tx)) {
        if (card.status !== "open") continue;
        const job = this.#answer(tx, card);
        if (job) jobs.push(job);
      }
      tx.update(practiceSets).set({ status: "grading", submittedAt: this.#now() }).where(eq(practiceSets.id, setId)).run();
    });
    return { node: this.#settle(setId), jobs };
  }

  /**
   * Grades one Card now: in training mode or a Quiz, for a retry, or after a failed grading.
   * Returns the grading job for an open answer.
   */
  check(cardId: string): { node: PracticeSetNode; jobs: GradingJob[] } {
    const card = this.#card(cardId);
    const set = this.#liveSet(card.setId);
    if (card.status !== "open" && card.status !== "failed") throw invalid("This Card is already answered.", "на карточку уже есть ответ.");
    if (card.status === "open" && set.status === "active" && set.reveal === "after_submit" && !card.retry) {
      throw invalid("This Practice set shows grades only after it is submitted.", "оценки появятся после отправки подборки.");
    }
    if (card.status === "open" && this.#expired(set)) throw invalid("The Quiz time is up.", "время квиза вышло.");
    const question = this.#question(card.questionId);
    const answered = question.type === "open" ? card.draftText.trim() !== "" : card.draftChoices.length > 0;
    if (!answered) throw invalid("The Card has no answer yet.", "сначала ответьте или пропустите карточку.");
    const jobs: GradingJob[] = [];
    this.#db.transaction((tx) => {
      const job = this.#answer(tx, card);
      if (job) jobs.push(job);
    });
    return { node: this.#settle(card.setId), jobs };
  }

  /**
   * Records the Grader's verdict on a Card waiting for it; the Hint ladder caps the score. A
   * verdict for a Card no longer waiting, or in a dropped set, is discarded.
   */
  recordGrade(cardId: string, grade: Grade): void {
    const card = this.#waitingCard(cardId);
    if (!card) return;
    this.#db.transaction((tx) => this.#record(tx, card, { grade, gradedBy: "grader" }));
    this.#settle(card.setId);
  }

  /** Marks a Card whose grading failed; the Candidate can check it again or skip it. */
  gradingFailed(cardId: string, message: string): void {
    const card = this.#waitingCard(cardId);
    if (!card) return;
    this.#db.update(cards).set({ status: "failed", error: message }).where(eq(cards.id, cardId)).run();
    this.#changed(card.setId);
  }

  /** Opens a graded or Skipped Card for another answer; the retry is recorded but moves neither Leitner box nor Mastery. */
  retry(cardId: string): PracticeSetNode {
    const card = this.#card(cardId);
    if (card.status !== "graded" && card.status !== "skipped") throw invalid("Only an answered Card can be retried.", "повторить можно только карточку с ответом.");
    this.#onCanvas(card.setId);
    this.#db.update(cards).set({ status: "open", retry: true, error: null }).where(eq(cards.id, cardId)).run();
    return this.#changed(card.setId);
  }

  setReveal(setId: string, reveal: RevealMode): PracticeSetNode {
    const set = this.#onCanvas(setId);
    if (set.kind === "quiz") throw invalid("A Quiz always shows each grade right away.", "в квизе оценки всегда видны сразу.");
    this.#db.update(practiceSets).set({ reveal }).where(eq(practiceSets.id, setId)).run();
    return this.#changed(setId);
  }

  /**
   * Auto-tidy on a new day (ADR-0004): result Cards graded on an earlier day move to history.
   * Returns the ids that left the Canvas.
   */
  archiveStale(): string[] {
    const today = localDate(this.#now());
    const stale = this.#db
      .select({ id: practiceSets.id, gradedAt: practiceSets.gradedAt })
      .from(practiceSets)
      .where(and(eq(practiceSets.status, "graded"), isNull(practiceSets.archivedAt)))
      .all()
      .filter((s) => s.gradedAt && localDate(s.gradedAt) < today)
      .map((s) => s.id);
    if (!stale.length) return [];
    this.#db.update(practiceSets).set({ archivedAt: this.#now() }).where(inArray(practiceSets.id, stale)).run();
    for (const setId of stale) this.#canvas.removed(setId);
    return stale;
  }

  /**
   * Corrects the grade of the Card's latest Attempt after the Candidate disputed it and the
   * Interviewer agreed. The Hint ladder cap still applies; the Leitner schedule is replayed and
   * Mastery follows, since it is read from Attempts. Works for sets in history too.
   */
  correctGrade(cardId: string, correction: GradeCorrection): { cardId: string; questionId: string; topic: string; previous: number; score: number; maxScore: number } {
    const card = this.#card(cardId);
    this.#liveSet(card.setId);
    const attempt = card.attemptId ? this.#attempt(card.attemptId) : undefined;
    if (!attempt || attempt.status !== "graded" || attempt.score === null) {
      throw new DomainError("This Card has no graded Attempt to correct.", "Only a graded open answer can be corrected; a Skipped Card has no score.");
    }
    if (attempt.gradedBy !== "grader") {
      throw new DomainError("Test Cards are checked by the app against their options; their grade cannot be disputed.", "Explain the correct options instead of changing the grade.");
    }
    if (correction.score > attempt.maxScore) {
      throw new DomainError(
        `The Attempt used ${attempt.hintRung} hint rung(s), so its score is capped at ${attempt.maxScore}.`,
        `Pass a score from 0 to ${attempt.maxScore}.`,
      );
    }
    if (correction.score === attempt.score) {
      throw new DomainError(`The Attempt already has score ${attempt.score}.`, "Pass a different score, or keep the grade.");
    }
    const now = this.#now();
    this.#db.transaction((tx) => {
      tx.update(attempts)
        .set({
          score: correction.score,
          correctedFrom: attempt.correctedFrom ?? attempt.score,
          correctionReason: correction.reason,
          correctedAt: now,
          ...(correction.gap !== undefined && { gap: correction.gap }),
          ...(correction.strengths !== undefined && { strengths: correction.strengths }),
        })
        .where(eq(attempts.id, attempt.id))
        .run();
      if (!attempt.retry) this.#domain.progress.reschedule(tx, attempt.questionId);
    });
    if (!this.#set(card.setId).archivedAt) this.#changed(card.setId);
    this.#domain.publishTargets();
    const question = this.#question(card.questionId);
    return {
      cardId,
      questionId: question.id,
      topic: this.#topicName(question.topicId),
      previous: attempt.score,
      score: correction.score,
      maxScore: attempt.maxScore,
    };
  }

  /** Cards left grading when the app stopped can never finish; the Candidate checks them again. */
  recoverInterrupted(message: string): void {
    this.#db.update(cards).set({ status: "failed", error: message }).where(eq(cards.status, "grading")).run();
  }

  // Internals

  #waitingCard(cardId: string): CardRow | undefined {
    const card = this.#db.select().from(cards).where(eq(cards.id, cardId)).get();
    if (card?.status !== "grading") return undefined;
    return this.#set(card.setId).status === "abandoned" ? undefined : card;
  }

  #checkQuestions(input: PlaceSetInput): void {
    const ids = input.questions.flatMap((q) => (q.questionId !== undefined ? [q.questionId] : []));
    const rows = new Map(
      (ids.length ? this.#db.select().from(questions).where(inArray(questions.id, ids)).all() : []).map((q) => [q.id, q]),
    );
    input.questions.forEach((q, i) => {
      const stored = q.questionId !== undefined ? rows.get(q.questionId) : undefined;
      if (q.questionId !== undefined && !stored) return; // Domain#practiceQuestions names the unknown id.
      const type = stored?.type ?? (q.questionId === undefined ? (q.type ?? "open") : "open");
      if (input.kind === "quiz" && type === "open") {
        throw new DomainError(`Card ${i + 1} is an open Question; a Quiz holds only test Questions.`, 'Use "kind": "practice" for open Questions, or pick single_choice and multiple_choice Questions.');
      }
      if (type === "open" && !stored?.referenceAnswer && !q.referenceAnswer) {
        throw new DomainError(
          `Card ${i + 1} is an open Question without a Reference answer; the Grader needs one.`,
          'Pass "reference_answer" with the expected content of a good answer for that Card.',
        );
      }
    });
  }

  /** Turns a Card's draft into an answer: tests get their Attempt now, open answers a grading job. */
  #answer(tx: Tx, card: CardRow): GradingJob | undefined {
    const question = this.#question(card.questionId, tx);
    if (question.type !== "open") {
      if (!card.draftChoices.length) {
        this.#record(tx, card, { skipped: true });
        return undefined;
      }
      const { score } = checkTest(question.type, question.options ?? [], card.draftChoices);
      this.#record(tx, card, { grade: { score, quote: "", strengths: "", gap: "" }, gradedBy: "app" });
      return undefined;
    }
    if (!card.draftText.trim()) {
      this.#record(tx, card, { skipped: true });
      return undefined;
    }
    tx.update(cards).set({ status: "grading", error: null }).where(eq(cards.id, card.id)).run();
    return {
      cardId: card.id,
      question: question.prompt,
      referenceAnswer: question.referenceAnswer ?? "",
      rubricAnchors: question.rubricAnchors,
      answer: card.draftText,
      language: this.#language(card.setId, tx),
    };
  }

  /** Writes an Attempt for the Card and, unless it is a retry, moves the Question's Leitner box. */
  #record(tx: Tx, card: CardRow, outcome: { skipped: true } | { grade: Grade; gradedBy: "app" | "grader" }): void {
    const set = tx.select().from(practiceSets).where(eq(practiceSets.id, card.setId)).get();
    const question = this.#question(card.questionId, tx);
    const now = this.#now();
    const cap = hintCap(card.hintsUsed);
    const graded = "grade" in outcome;
    const score = graded ? Math.min(outcome.grade.score, cap) : null;
    const id = crypto.randomUUID();
    tx.insert(attempts)
      .values({
        id,
        questionId: card.questionId,
        cardId: card.id,
        activityId: set?.activityId ?? null,
        mode: set?.mode ?? "training",
        status: graded ? "graded" : "skipped",
        score,
        rawScore: graded ? outcome.grade.score : null,
        maxScore: cap,
        hintRung: card.hintsUsed,
        answer: question.type === "open" ? card.draftText : null,
        choices: question.type === "open" ? null : card.draftChoices,
        quote: graded ? outcome.grade.quote || null : null,
        strengths: graded ? outcome.grade.strengths || null : null,
        gap: graded ? outcome.grade.gap || null : null,
        gradedBy: graded ? outcome.gradedBy : null,
        retry: card.retry,
        createdAt: now,
      })
      .run();
    tx.update(cards).set({ status: graded ? "graded" : "skipped", attemptId: id, error: null }).where(eq(cards.id, card.id)).run();
    if (!card.retry) this.#domain.progress.schedule(tx, card.questionId, graded ? { score: score ?? 0 } : { skipped: true }, now);
  }

  /**
   * After an Attempt: once every Card is answered, completes the set and collapses it into a
   * result Card (the Candidate expands it to read the grades); then tells live clients.
   */
  #settle(setId: string): PracticeSetNode {
    const set = this.#set(setId);
    const rows = this.#cards(setId);
    const done = rows.every((c) => c.status === "graded" || c.status === "skipped");
    let result: SetResult | undefined;
    if (done && (set.status === "active" || set.status === "grading")) {
      const gradedAt = this.#now();
      this.#db.update(practiceSets).set({ status: "graded", gradedAt, submittedAt: set.submittedAt ?? gradedAt }).where(eq(practiceSets.id, setId)).run();
      result = this.#result(this.#set(setId));
      // A later set may share the Activity while it runs; the Activity ends with its last set.
      const running = this.#db
        .select({ id: practiceSets.id })
        .from(practiceSets)
        .where(and(eq(practiceSets.activityId, set.activityId), inArray(practiceSets.status, ["active", "grading"])))
        .get();
      if (!running) this.#domain.completeActivity(set.activityId, `Practice set "${set.title}": ${result.score}/${result.max}, ${result.skipped} skipped.`);
    }
    let node = this.#changed(setId);
    if (result) {
      this.#canvas.updateLayout([{ nodeId: setId, collapsed: true }]);
      node = { ...node, collapsed: true };
    }
    this.#domain.publishTargets();
    if (result) for (const listener of this.#gradedListeners) listener(result);
    return node;
  }

  #changed(setId: string): PracticeSetNode {
    const node = this.node(setId);
    this.#canvas.updated(node);
    return node;
  }

  #result(set: SetRow): SetResult {
    const rows = this.#cards(set.id);
    const firstAttempts = this.#firstAttempts(rows.map((c) => c.id));
    const cardResults: CardResult[] = rows.map((c) => {
      const question = this.#question(c.questionId);
      const attempt = firstAttempts.get(c.id);
      return {
        cardId: c.id,
        topic: this.#topicName(question.topicId),
        prompt: question.prompt,
        status: attempt?.status ?? "skipped",
        score: attempt?.score ?? null,
        maxScore: attempt?.maxScore ?? maxScore,
        hintsUsed: attempt?.hintRung ?? c.hintsUsed,
        gap: attempt?.gap ?? null,
      };
    });
    const graded = cardResults.filter((c) => c.status === "graded");
    return {
      setId: set.id,
      title: set.title,
      kind: set.kind,
      score: graded.reduce((sum, c) => sum + (c.score ?? 0), 0),
      max: graded.length * maxScore,
      skipped: cardResults.length - graded.length,
      cards: cardResults,
    };
  }

  /** Each Card's first Attempt, which the set's result counts; retries come later. */
  #firstAttempts(cardIds: string[]): Map<string, AttemptRow> {
    if (!cardIds.length) return new Map();
    const rows = this.#db.select().from(attempts).where(and(inArray(attempts.cardId, cardIds), eq(attempts.retry, false))).orderBy(asc(attempts.createdAt)).all();
    const first = new Map<string, AttemptRow>();
    for (const row of rows) if (row.cardId && !first.has(row.cardId)) first.set(row.cardId, row);
    return first;
  }

  #view(set: SetRow): PracticeSetView {
    const rows = this.#cards(set.id);
    const qs = new Map(
      this.#db.select().from(questions).where(inArray(questions.id, rows.map((c) => c.questionId))).all().map((q) => [q.id, q]),
    );
    const attemptIds = rows.flatMap((c) => (c.attemptId ? [c.attemptId] : []));
    const latest = new Map(
      (attemptIds.length ? this.#db.select().from(attempts).where(inArray(attempts.id, attemptIds)).all() : []).map((a) => [a.id, a]),
    );
    const names = new Map(this.#db.select({ id: topics.id, name: topics.name }).from(topics).all().map((t) => [t.id, t.name]));
    const result = set.status === "graded" ? this.#result(set) : null;
    return {
      title: set.title,
      kind: set.kind,
      reveal: set.reveal,
      // Dropped sets never reach the Canvas; see #liveSet.
      status: set.status === "abandoned" ? "graded" : set.status,
      deadline: set.deadline?.getTime() ?? null,
      cards: rows.map((c) => {
        const q = qs.get(c.questionId) as QuestionRow;
        const attempt = c.attemptId ? latest.get(c.attemptId) : undefined;
        const shown = attempt && c.status !== "open";
        return {
          id: c.id,
          questionId: q.id,
          topic: names.get(q.topicId) ?? "",
          type: q.type,
          prompt: q.prompt,
          options: q.options?.map((o) => o.text) ?? null,
          status: c.status,
          draft: shown ? { text: attempt.answer ?? "", choices: attempt.choices ?? [] } : { text: c.draftText, choices: c.draftChoices },
          hints: (q.hints ?? []).slice(0, c.hintsUsed),
          hintRungs: hintRungs(q),
          maxScore: hintCap(c.hintsUsed),
          attempt: shown ? { ...evidence(attempt), correct: q.type === "open" ? null : correctOptions(q.options ?? []) } : null,
          referenceAnswer: attempt ? q.referenceAnswer : null,
          error: c.error,
        } satisfies CardView;
      }),
      result: result && { score: result.score, max: result.max, skipped: result.skipped },
    };
  }

  #rightmostWidth(exceptId: string): number {
    const sets = this.nodes().filter((n) => n.id !== exceptId);
    const rightmost = sets.reduce<PracticeSetNode | undefined>((best, n) => (!best || n.position.x > best.position.x ? n : best), undefined);
    if (!rightmost) return narrowSetWidth;
    if (rightmost.collapsed) return resultCardWidth;
    return rightmost.data.cards.length >= wideSetCards ? wideSetWidth : narrowSetWidth;
  }

  #language(setId: string, tx: Tx | Database = this.#db): Language {
    const row = tx
      .select({ language: preparationTargets.language })
      .from(practiceSets)
      .leftJoin(preparationTargets, eq(preparationTargets.id, practiceSets.targetId))
      .where(eq(practiceSets.id, setId))
      .get();
    return languages.find((l) => l === row?.language) ?? "ru";
  }

  #set(setId: string): SetRow {
    const set = this.#db.select().from(practiceSets).where(eq(practiceSets.id, setId)).get();
    if (!set) throw unknownSet(setId);
    return set;
  }

  /** A set still on the Canvas; a dropped one reads as unknown. */
  #liveSet(setId: string): SetRow {
    const set = this.#set(setId);
    if (set.status === "abandoned") throw unknownSet(setId);
    return set;
  }

  /** A set still on the Canvas, not in history; Card changes need one. */
  #onCanvas(setId: string): SetRow {
    const set = this.#liveSet(setId);
    if (set.archivedAt) throw invalid(`Practice set "${set.title}" is in history.`, "подборка уже в истории.");
    return set;
  }

  /** A timed Quiz whose deadline has passed while it was still open. */
  #expired(set: SetRow): boolean {
    return set.status === "active" && set.deadline !== null && set.deadline.getTime() <= this.#now().getTime();
  }

  #cards(setId: string, tx: Tx | Database = this.#db): CardRow[] {
    return tx.select().from(cards).where(eq(cards.setId, setId)).orderBy(asc(cards.position)).all();
  }

  #card(cardId: string): CardRow {
    const card = this.#db.select().from(cards).where(eq(cards.id, cardId)).get();
    if (!card) {
      throw new DomainError(`No Card with id "${cardId}".`, "Use a Card id from the Canvas.", { kind: "not_found", candidateMessage: "такой карточки нет. Обновите страницу." });
    }
    return card;
  }

  #openCard(cardId: string): CardRow {
    const card = this.#card(cardId);
    if (card.status !== "open") throw invalid("This Card is already answered.", "на карточку уже есть ответ.");
    this.#liveSet(card.setId);
    return card;
  }

  #question(questionId: string, tx: Tx | Database = this.#db): QuestionRow {
    const q = tx.select().from(questions).where(eq(questions.id, questionId)).get();
    if (!q) throw new Error(`Card refers to a missing Question ${questionId}.`);
    return q;
  }

  #attempt(attemptId: string): AttemptRow | undefined {
    return this.#db.select().from(attempts).where(eq(attempts.id, attemptId)).get();
  }

  #topicName(topicId: string, tx: Tx | Database = this.#db): string {
    return tx.select({ name: topics.name }).from(topics).where(eq(topics.id, topicId)).get()?.name ?? "";
  }
}

function evidence(attempt: AttemptRow): AttemptEvidence {
  return {
    status: attempt.status,
    score: attempt.score,
    maxScore: attempt.maxScore,
    quote: attempt.quote,
    strengths: attempt.strengths,
    gap: attempt.gap,
    ...(attempt.correctedFrom !== null && { corrected: { from: attempt.correctedFrom, reason: attempt.correctionReason ?? "" } }),
  };
}

/** Hint ladder rungs an open Question offers; tests have none. */
function hintRungs(question: QuestionRow): number {
  return question.type === "open" ? Math.min(question.hints?.length ?? 0, maxHintRungs) : 0;
}

function checkChoices(question: QuestionRow, choices: number[]): number[] {
  const count = question.options?.length ?? 0;
  const unique = [...new Set(choices)].sort((a, b) => a - b);
  if (question.type === "open" || unique.some((i) => !Number.isInteger(i) || i < 0 || i >= count)) {
    throw invalid("The choice does not match the Card's options.", "такого варианта нет.");
  }
  if (question.type === "single_choice" && unique.length > 1) throw invalid("A single-choice Card takes one option.", "выберите один вариант.");
  return unique;
}

function invalid(message: string, candidateMessage: string): DomainError {
  return new DomainError(message, "Reload the Canvas and try again.", { candidateMessage });
}

function unknownSet(setId: string): DomainError {
  return new DomainError(`No Practice set with id "${setId}".`, "Use a Practice set id from the Canvas.", {
    kind: "not_found",
    candidateMessage: "такой подборки нет. Обновите страницу.",
  });
}
