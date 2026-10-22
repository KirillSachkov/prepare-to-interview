// Practice sets, Cards, and Attempts of the domain core (ADR-0004). Every Card action goes
// through here: drafts, hints, Skipped, test checks, Grader results, retries. Scheduling and
// Mastery follow each Attempt in the same transaction.
import crypto from "node:crypto";
import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import type { CardDraft, CardView, PracticeSetNode, PracticeSetView } from "@prepare-to-interview/shared";
import type { Canvas } from "../canvas/canvas.ts";
import type { Database } from "../db/database.ts";
import {
  attempts,
  cards,
  practiceSets,
  preparationTargets,
  questions,
  topics,
  type PracticeSetKind,
  type RevealMode,
  type RubricAnchors,
} from "../db/schema.ts";
import { checkTest, hintCap, maxHintRungs, maxScore } from "./arithmetic.ts";
import { DomainError, type Domain, type PracticeQuestion } from "./domain.ts";
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
  questions: PracticeQuestion[];
}

/** An open answer waiting for the Grader: only what the Grader may see. */
export interface GradingJob {
  cardId: string;
  topic: string;
  question: string;
  referenceAnswer: string;
  rubricAnchors: RubricAnchors | null;
  answer: string;
  /** Language of the feedback: the Preparation target's, Russian by default. */
  language: string;
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

/** What the Interviewer receives when the Candidate brings a Card into the Chat. */
export interface CardContext {
  cardId: string;
  setTitle: string;
  topic: string;
  type: string;
  question: string;
  options: string[] | null;
  answer: string;
  choices: number[];
  status: string;
  hintsUsed: number;
  attempt: { status: string; score: number | null; maxScore: number; quote: string | null; strengths: string | null; gap: string | null } | null;
  /** Only once an Attempt exists, so the Interviewer does not give it away. */
  referenceAnswer: string | null;
}

type SetRow = typeof practiceSets.$inferSelect;
type CardRow = typeof cards.$inferSelect;
type QuestionRow = typeof questions.$inferSelect;
type AttemptRow = typeof attempts.$inferSelect;

const maxCards = 12;
const maxDraftLength = 20_000;
/** Server-side width estimates for placing the next node to the right. */
const wideSetWidth = 800;
const narrowSetWidth = 440;

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
    this.#canvas.addSource(() => this.nodes());
  }

  /** Runs after a Practice set's last Card got its Attempt. */
  onGraded(listener: (result: SetResult) => void): void {
    this.#gradedListeners.push(listener);
  }

  // Reads

  /** Practice sets on the Canvas, oldest first. */
  nodes(): PracticeSetNode[] {
    const sets = this.#db
      .select()
      .from(practiceSets)
      .where(ne(practiceSets.status, "abandoned"))
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
    if (!layout || set.status === "abandoned") throw unknownSet(setId);
    return { id: set.id, kind: "practice_set", ...layout, data: this.#view(set) };
  }

  /** The unsubmitted Practice set, if the Candidate has one. */
  unfinished(): { setId: string; title: string; answered: number; cards: number } | null {
    const set = this.#db.select().from(practiceSets).where(eq(practiceSets.status, "active")).orderBy(asc(practiceSets.createdAt)).get();
    if (!set) return null;
    const rows = this.#cards(set.id);
    const answered = rows.filter((c) => c.status !== "open" || c.draftText.trim() || c.draftChoices.length).length;
    return { setId: set.id, title: set.title, answered, cards: rows.length };
  }

  cardContext(cardId: string): CardContext {
    const card = this.#card(cardId);
    const set = this.#set(card.setId);
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
      attempt: attempt
        ? { status: attempt.status, score: attempt.score, maxScore: attempt.maxScore, quote: attempt.quote, strengths: attempt.strengths, gap: attempt.gap }
        : null,
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
    if (!input.questions.length || input.questions.length > maxCards) {
      throw new DomainError(`A Practice set holds 1 to ${maxCards} Cards.`, `Pass 1-${maxCards} questions.`);
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
    const now = this.#now();
    const id = crypto.randomUUID();
    const collapse: string[] = [];
    this.#db.transaction((tx) => {
      if (unfinished) tx.update(practiceSets).set({ status: "abandoned" }).where(eq(practiceSets.id, unfinished.setId)).run();
      collapse.push(...tx.select({ id: practiceSets.id }).from(practiceSets).where(eq(practiceSets.status, "graded")).all().map((r) => r.id));
      tx.insert(practiceSets)
        .values({
          id,
          activityId: activity.id,
          targetId: this.#domain.activeTargetId(),
          title: input.title,
          kind: input.kind,
          reveal: input.kind === "quiz" ? "each_answer" : (input.reveal ?? "after_submit"),
          status: "active",
          deadline: input.timeLimitMinutes ? new Date(now.getTime() + input.timeLimitMinutes * 60_000) : null,
          createdAt: now,
        })
        .run();
      tx.insert(cards)
        .values(questionIds.map((questionId, position) => ({ id: crypto.randomUUID(), setId: id, questionId, position, status: "open" as const, draftChoices: [] })))
        .run();
    });
    if (unfinished) this.#canvas.removed(unfinished.setId);
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
    const question = this.#question(card.questionId);
    const update: Partial<CardRow> = {};
    if (draft.text !== undefined) {
      if (draft.text.length > maxDraftLength) throw invalid(`The answer is longer than ${maxDraftLength} characters.`, `ответ длиннее ${maxDraftLength} символов.`);
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
    const card = this.#openCard(cardId);
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
    const set = this.#set(card.setId);
    if (card.status !== "open" && card.status !== "failed") throw invalid("This Card is already answered.", "на карточку уже есть ответ.");
    if (set.status === "abandoned") throw unknownSet(set.id);
    if (card.status === "open" && set.status === "active" && set.reveal === "after_submit" && !card.retry) {
      throw invalid("This Practice set shows grades only after it is submitted.", "оценки появятся после отправки подборки.");
    }
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

  /** Records the Grader's verdict on a Card waiting for it; the Hint ladder caps the score. */
  recordGrade(cardId: string, grade: Grade): PracticeSetNode {
    const card = this.#card(cardId);
    if (card.status !== "grading") return this.#changed(card.setId);
    this.#db.transaction((tx) => this.#record(tx, card, { grade, gradedBy: "grader" }));
    return this.#settle(card.setId);
  }

  /** Marks a Card whose grading failed; the Candidate can check it again. */
  gradingFailed(cardId: string, message: string): PracticeSetNode {
    const card = this.#card(cardId);
    if (card.status === "grading") this.#db.update(cards).set({ status: "failed", error: message }).where(eq(cards.id, cardId)).run();
    return this.#changed(card.setId);
  }

  /** Opens a graded or Skipped Card for another answer; the retry is recorded but moves neither Leitner box nor Mastery. */
  retry(cardId: string): PracticeSetNode {
    const card = this.#card(cardId);
    if (card.status !== "graded" && card.status !== "skipped") throw invalid("Only an answered Card can be retried.", "повторить можно только карточку с ответом.");
    if (this.#set(card.setId).status === "abandoned") throw unknownSet(card.setId);
    this.#db.update(cards).set({ status: "open", retry: true, error: null }).where(eq(cards.id, cardId)).run();
    return this.#changed(card.setId);
  }

  setReveal(setId: string, reveal: RevealMode): PracticeSetNode {
    const set = this.#set(setId);
    if (set.status === "abandoned") throw unknownSet(setId);
    if (set.kind === "quiz") throw invalid("A Quiz always shows each grade right away.", "в квизе оценки всегда видны сразу.");
    this.#db.update(practiceSets).set({ reveal }).where(eq(practiceSets.id, setId)).run();
    return this.#changed(setId);
  }

  /** Cards left grading when the app stopped can never finish; the Candidate checks them again. */
  recoverInterrupted(message: string): void {
    this.#db.update(cards).set({ status: "failed", error: message }).where(eq(cards.status, "grading")).run();
  }

  // Internals

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
      topic: this.#topicName(question.topicId, tx),
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
        mode: "training",
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

  /** After an Attempt: completes the set once every Card is answered, then tells live clients. */
  #settle(setId: string): PracticeSetNode {
    const set = this.#set(setId);
    const rows = this.#cards(setId);
    const done = rows.every((c) => c.status === "graded" || c.status === "skipped");
    let result: SetResult | undefined;
    if (done && (set.status === "active" || set.status === "grading")) {
      const gradedAt = this.#now();
      this.#db.update(practiceSets).set({ status: "graded", gradedAt, submittedAt: set.submittedAt ?? gradedAt }).where(eq(practiceSets.id, setId)).run();
      result = this.#result(this.#set(setId));
      this.#domain.completeActivity(set.activityId, `Practice set "${set.title}": ${result.score}/${result.max}, ${result.skipped} skipped.`);
    }
    const node = this.#changed(setId);
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
          attempt: shown
            ? {
                status: attempt.status,
                score: attempt.score,
                maxScore: attempt.maxScore,
                quote: attempt.quote,
                strengths: attempt.strengths,
                gap: attempt.gap,
                correct: q.type === "open" ? null : (q.options ?? []).flatMap((o, i) => (o.correct ? [i] : [])),
              }
            : null,
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
    if (rightmost.collapsed) return 280;
    return rightmost.data.cards.length >= 3 ? wideSetWidth : narrowSetWidth;
  }

  #language(setId: string, tx: Tx | Database = this.#db): string {
    const row = tx
      .select({ language: preparationTargets.language })
      .from(practiceSets)
      .leftJoin(preparationTargets, eq(preparationTargets.id, practiceSets.targetId))
      .where(eq(practiceSets.id, setId))
      .get();
    return row?.language ?? "ru";
  }

  #set(setId: string): SetRow {
    const set = this.#db.select().from(practiceSets).where(eq(practiceSets.id, setId)).get();
    if (!set) throw unknownSet(setId);
    return set;
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
    if (this.#set(card.setId).status === "abandoned") throw unknownSet(card.setId);
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
