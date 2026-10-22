// Progress of the domain core: Leitner schedules, Due Questions, Mastery per Topic, and readiness
// per Preparation target, read from Attempts. All numbers come from `arithmetic.ts`.
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { TopicProgress } from "@prepare-to-interview/shared";
import type { Database } from "../db/database.ts";
import {
  attempts,
  candidateProfile,
  questions,
  questionSchedule,
  targetTopics,
  topics,
  type QuestionType,
} from "../db/schema.ts";
import { dueOn, localDate, nextBox, questionMastery, readiness, topicMastery, type Outcome } from "./arithmetic.ts";

export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface TargetProgress {
  readiness: number | null;
  due: number;
  topics: TopicProgress[];
}

/** A Question the Interviewer may put into a Practice set. */
export interface QueuedQuestion {
  questionId: string;
  topic: string;
  type: QuestionType;
  prompt: string;
  /** Leitner box 1–5; `null` for a Question never practised. */
  box: number | null;
  /** Local date `YYYY-MM-DD` it is Due from; `null` when never practised. */
  dueOn: string | null;
  mastery: number | null;
}

export interface PracticeQueue {
  due: QueuedQuestion[];
  /** Active Questions never practised. */
  neverPractised: QueuedQuestion[];
}

export class Progress {
  readonly #db: Database;
  readonly #today: () => string;

  constructor(db: Database, today: () => string) {
    this.#db = db;
    this.#today = today;
  }

  /** Moves the Question's Leitner box after an Attempt that counts and sets its next Due date. */
  schedule(tx: Tx, questionId: string, outcome: Outcome, at: Date): void {
    const current = tx.select().from(questionSchedule).where(eq(questionSchedule.questionId, questionId)).get();
    const box = nextBox(current?.box, outcome);
    const row = { questionId, box, dueOn: dueOn(this.#today(), box), updatedAt: at };
    tx.insert(questionSchedule).values(row).onConflictDoUpdate({ target: questionSchedule.questionId, set: row }).run();
  }

  /**
   * Rebuilds the Question's Leitner box from its Attempts that count, oldest first, such as after
   * a corrected grade; the Due date counts from the latest of them.
   */
  reschedule(tx: Tx, questionId: string, at: Date): void {
    const rows = tx
      .select({ status: attempts.status, score: attempts.score, createdAt: attempts.createdAt })
      .from(attempts)
      .where(and(eq(attempts.questionId, questionId), eq(attempts.retry, false)))
      .orderBy(asc(attempts.createdAt), asc(sql`rowid`))
      .all();
    const last = rows.at(-1);
    if (!last) return;
    let box: number | undefined;
    for (const r of rows) box = nextBox(box, r.status === "skipped" ? { skipped: true } : { score: r.score ?? 0 });
    const row = { questionId, box: box ?? 1, dueOn: dueOn(localDate(last.createdAt), box ?? 1), updatedAt: at };
    tx.insert(questionSchedule).values(row).onConflictDoUpdate({ target: questionSchedule.questionId, set: row }).run();
  }

  /** Mastery, Due, and readiness of a Preparation target's Topics. */
  forTarget(targetId: string): TargetProgress {
    const view = this.#view(targetId);
    const topicRows: TopicProgress[] = view.targetTopics.map((t) => {
      const ids = view.subtree(t.topicId);
      const qs = view.questions.filter((q) => ids.has(q.topicId));
      const masteries = qs.flatMap((q) => {
        const m = view.mastery.get(q.id);
        return m === undefined || m === null ? [] : [m];
      });
      return {
        topicId: t.topicId,
        name: t.name,
        group: t.parentId ? (view.names.get(t.parentId) ?? null) : null,
        priority: t.priority,
        mastery: topicMastery(masteries, view.calibration.get(t.topicId)),
        questions: qs.length,
        due: qs.filter((q) => view.isDue(q.id)).length,
      };
    });
    const dueIds = new Set(
      view.questions.filter((q) => view.inTarget(q.topicId) && view.isDue(q.id)).map((q) => q.id),
    );
    return { readiness: readiness(topicRows), due: dueIds.size, topics: topicRows };
  }

  /** Due and never-practised Questions of a target, optionally within one Topic's subtree. */
  queue(targetId: string, options: { topicId?: string; limit: number }): PracticeQueue {
    const view = this.#view(targetId);
    const within = options.topicId ? view.subtree(options.topicId) : undefined;
    const pool = view.questions.filter((q) => (within ? within.has(q.topicId) : view.inTarget(q.topicId)));
    const queued = (q: (typeof pool)[number]): QueuedQuestion => {
      const s = view.schedules.get(q.id);
      return {
        questionId: q.id,
        topic: view.names.get(q.topicId) ?? "",
        type: q.type,
        prompt: q.prompt,
        box: s?.box ?? null,
        dueOn: s?.dueOn ?? null,
        mastery: view.mastery.get(q.id) ?? null,
      };
    };
    const due = pool
      .filter((q) => view.isDue(q.id))
      .map(queued)
      .sort((a, b) => (a.dueOn ?? "").localeCompare(b.dueOn ?? "") || (a.box ?? 0) - (b.box ?? 0));
    const neverPractised = pool.filter((q) => !view.schedules.has(q.id)).map(queued);
    return { due: due.slice(0, options.limit), neverPractised: neverPractised.slice(0, options.limit) };
  }

  /** Everything progress needs about one target, read once. */
  #view(targetId: string) {
    const today = this.#today();
    const allTopics = this.#db.select().from(topics).all();
    const names = new Map(allTopics.map((t) => [t.id, t.name]));
    const children = new Map<string, string[]>();
    for (const t of allTopics) if (t.parentId) children.set(t.parentId, [...(children.get(t.parentId) ?? []), t.id]);
    const subtree = (rootId: string): Set<string> => {
      const ids = new Set<string>();
      const stack = [rootId];
      while (stack.length) {
        const id = stack.pop() as string;
        if (ids.has(id)) continue;
        ids.add(id);
        stack.push(...(children.get(id) ?? []));
      }
      return ids;
    };
    const targetTopicRows = this.#db
      .select({ topicId: topics.id, name: topics.name, parentId: topics.parentId, priority: targetTopics.priority })
      .from(targetTopics)
      .innerJoin(topics, eq(topics.id, targetTopics.topicId))
      .where(eq(targetTopics.targetId, targetId))
      .orderBy(asc(targetTopics.position))
      .all();
    const covered = new Set(targetTopicRows.flatMap((t) => [...subtree(t.topicId)]));
    const questionRows = this.#db
      .select({ id: questions.id, topicId: questions.topicId, type: questions.type, prompt: questions.prompt })
      .from(questions)
      .where(eq(questions.status, "active"))
      .orderBy(asc(questions.createdAt))
      .all();
    const ids = questionRows.map((q) => q.id);
    const schedules = new Map(
      (ids.length ? this.#db.select().from(questionSchedule).where(inArray(questionSchedule.questionId, ids)).all() : []).map(
        (s) => [s.questionId, s],
      ),
    );
    const scores = new Map<string, number[]>();
    if (ids.length) {
      const rows = this.#db
        .select({ questionId: attempts.questionId, score: attempts.score })
        .from(attempts)
        .where(and(inArray(attempts.questionId, ids), eq(attempts.status, "graded"), eq(attempts.retry, false), isNotNull(attempts.score)))
        .orderBy(desc(attempts.createdAt), desc(sql`rowid`))
        .all();
      for (const r of rows) scores.set(r.questionId, [...(scores.get(r.questionId) ?? []), r.score as number]);
    }
    const mastery = new Map(ids.map((id) => [id, questionMastery(scores.get(id) ?? [])]));
    const profile = this.#db.select({ calibration: candidateProfile.calibration }).from(candidateProfile).get();
    const calibration = new Map((profile?.calibration ?? []).map((c) => [c.topicId, c.level]));
    return {
      names,
      subtree,
      targetTopics: targetTopicRows,
      questions: questionRows,
      schedules,
      mastery,
      calibration,
      inTarget: (topicId: string) => covered.has(topicId),
      isDue: (questionId: string) => {
        const s = schedules.get(questionId);
        return s !== undefined && s.dueOn <= today;
      },
    };
  }
}
