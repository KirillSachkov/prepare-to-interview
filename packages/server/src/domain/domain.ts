import crypto from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { TargetsResponse, TargetSummary } from "@prepare-to-interview/shared";
import type { Database } from "../db/database.ts";
import {
  activities,
  candidateProfile,
  decisionLog,
  preparationTargets,
  questions,
  settings,
  targetTopics,
  topics,
  type ActivityKind,
  type ActivityStatus,
  type Mission,
  type QuestionOrigin,
  type QuestionType,
  type RubricAnchors,
  type TestOption,
  type TopicPriority,
  type Vacancy,
} from "../db/schema.ts";
import type { EventBus } from "../events.ts";
import { maxHintRungs } from "./arithmetic.ts";
import { Progress, type Tx } from "./progress.ts";

/**
 * A domain rule refused the request. The message says what is wrong and `fixHint` how to retry;
 * MCP tools return both to the agent. Refusals the Candidate can meet in the UI also carry
 * `candidateMessage`, the Russian text REST returns to the client: a lowercase clause the client
 * shows after its own lead-in, such as «Не удалось добавить вопрос: …».
 */
export class DomainError extends Error {
  readonly fixHint: string;
  readonly kind: "invalid" | "not_found";
  readonly candidateMessage: string | undefined;

  constructor(
    message: string,
    fixHint: string,
    options: { kind?: "invalid" | "not_found"; candidateMessage?: string } = {},
  ) {
    super(message);
    this.name = "DomainError";
    this.fixHint = fixHint;
    this.kind = options.kind ?? "invalid";
    this.candidateMessage = options.candidateMessage;
  }
}

export const markets = ["ru"] as const;
export const languages = ["ru", "en"] as const;
export type Market = (typeof markets)[number];
export type Language = (typeof languages)[number];

export interface ProfileUpdate {
  experience?: string | null;
  stack?: string[];
  strengths?: string[];
  weakSpots?: string[];
  preferences?: string | null;
  /** Merged by Topic: a Topic named again replaces its earlier level. */
  calibration?: { topic: string; level: number; note?: string | null }[];
}

export interface CandidateProfile {
  experience: string | null;
  stack: string[];
  strengths: string[];
  weakSpots: string[];
  preferences: string | null;
  calibration: { topic: string; level: number; note: string | null }[];
}

export interface TopicRef {
  name: string;
  priority: TopicPriority;
  /** Name of the group Topic this Topic nests under. */
  group?: string | null;
}

export interface TargetInput {
  /** Updates this Preparation target; creates a new one when absent. */
  targetId?: string;
  name?: string;
  role?: string;
  grade?: string | null;
  market?: Market;
  language?: Language;
  interviewDate?: string | null;
  mission?: Partial<Mission>;
  vacancies?: Partial<Vacancy>[];
  /** Replaces the target's Topics; shared Topics are found by name, new ones are created. */
  topics?: TopicRef[];
  /** Makes the target active; new targets become active unless this is false. */
  activate?: boolean;
}

export interface TargetDetail extends TargetSummary {
  market: string;
  language: string;
  mission: Mission;
  vacancies: Vacancy[];
  topics: { name: string; priority: TopicPriority; group: string | null }[];
}

export interface Decision {
  id: string;
  targetId: string | null;
  decision: string;
  reason: string | null;
  createdAt: Date;
}

export interface Activity {
  id: string;
  kind: ActivityKind;
  status: ActivityStatus;
  targetId: string | null;
  startedAt: Date;
  endedAt: Date | null;
  summary: string | null;
}

export interface QuestionInput {
  topic: string;
  prompt: string;
  type?: QuestionType;
  options?: TestOption[];
  referenceAnswer?: string | null;
  rubricAnchors?: RubricAnchors | null;
  /** Hint ladder rungs, mildest first. */
  hints?: string[] | null;
  origin: QuestionOrigin;
}

/** Fields a Practice set may fill on a bank Question that lacks them; stored values are kept. */
export interface QuestionFill {
  referenceAnswer?: string | null;
  rubricAnchors?: RubricAnchors | null;
  hints?: string[] | null;
}

/** A Question for a Practice set: one from the bank by id, or a new one the Interviewer composed. */
export type PracticeQuestion = ({ questionId: string } & QuestionFill) | (Omit<QuestionInput, "origin"> & { questionId?: undefined });

export interface Overview {
  profile: CandidateProfile | null;
  activeTarget: TargetDetail | null;
  targets: TargetSummary[];
  recentDecisions: Decision[];
  activity: Activity | null;
}

const profileId = "candidate";
const activeTargetKey = "active_target";
const recentDecisionLimit = 10;

/**
 * The domain core (ADR-0003): Candidate profile, Preparation targets, the shared Question bank,
 * the Decision log, and Activities. It validates every change and computes every derived number
 * (days left, later readiness and Mastery); callers never write domain tables themselves.
 */
export class Domain {
  readonly #db: Database;
  readonly #events: EventBus;
  readonly #now: () => Date;
  readonly progress: Progress;

  constructor(db: Database, events: EventBus, now: () => Date = () => new Date()) {
    this.#db = db;
    this.#events = events;
    this.#now = now;
    this.progress = new Progress(db, () => localDate(now()));
  }

  // Reads

  overview(): Overview {
    const activeId = this.activeTargetId();
    return {
      profile: this.profile(),
      activeTarget: activeId ? this.#targetDetail(activeId) : null,
      targets: this.targets().targets,
      recentDecisions: this.#db
        .select()
        .from(decisionLog)
        // Insertion order breaks ties within a millisecond.
        .orderBy(desc(decisionLog.createdAt), desc(sql`rowid`))
        .limit(recentDecisionLimit)
        .all(),
      activity: this.currentActivity(),
    };
  }

  profile(): CandidateProfile | null {
    const row = this.#db.select().from(candidateProfile).where(eq(candidateProfile.id, profileId)).get();
    if (!row) return null;
    const names = this.#topicNames(row.calibration.map((c) => c.topicId));
    return {
      experience: row.experience,
      stack: row.stack,
      strengths: row.strengths,
      weakSpots: row.weakSpots,
      preferences: row.preferences,
      calibration: row.calibration.map((c) => ({ topic: names.get(c.topicId) ?? c.topicId, level: c.level, note: c.note })),
    };
  }

  targets(): TargetsResponse {
    const rows = this.#db.select().from(preparationTargets).orderBy(asc(preparationTargets.createdAt), asc(sql`rowid`)).all();
    return { activeId: this.activeTargetId(), targets: rows.map((row) => this.#summary(row)) };
  }

  /** Topic names of the Question bank, alphabetically. */
  topicNames(): string[] {
    return this.#db
      .select({ name: topics.name })
      .from(topics)
      .all()
      .map((t) => t.name)
      .sort((a, b) => a.localeCompare(b));
  }

  currentActivity(): Activity | null {
    return this.#db.select().from(activities).where(eq(activities.status, "active")).get() ?? null;
  }

  /** Whether onboarding ever started, finished or not; a skipped onboarding does not restart by itself. */
  onboardingStarted(): boolean {
    return this.#db.select({ id: activities.id }).from(activities).where(eq(activities.kind, "onboarding")).get() !== undefined;
  }

  // Changes

  saveProfile(update: ProfileUpdate): CandidateProfile {
    this.#db.transaction((tx) => {
      const current = tx.select().from(candidateProfile).where(eq(candidateProfile.id, profileId)).get();
      let calibration = current?.calibration ?? [];
      if (update.calibration) {
        const byTopic = new Map(calibration.map((c) => [c.topicId, c]));
        for (const entry of update.calibration) {
          const topicId = this.#findOrCreateTopic(tx, entry.topic);
          byTopic.set(topicId, { topicId, level: entry.level, note: entry.note ?? null });
        }
        calibration = [...byTopic.values()];
      }
      const row = {
        id: profileId,
        experience: update.experience !== undefined ? update.experience : (current?.experience ?? null),
        stack: update.stack ?? current?.stack ?? [],
        strengths: update.strengths ?? current?.strengths ?? [],
        weakSpots: update.weakSpots ?? current?.weakSpots ?? [],
        preferences: update.preferences !== undefined ? update.preferences : (current?.preferences ?? null),
        calibration,
        updatedAt: this.#now(),
      };
      tx.insert(candidateProfile).values(row).onConflictDoUpdate({ target: candidateProfile.id, set: row }).run();
    });
    return present(this.profile());
  }

  /** Creates or updates a Preparation target; during onboarding, the Activity records the target it set up. */
  saveTarget(input: TargetInput): TargetDetail {
    const interviewDate = input.interviewDate === undefined ? undefined : this.#checkDate(input.interviewDate);
    const id = this.#db.transaction((tx) => {
      const now = this.#now();
      let id = input.targetId;
      if (id) {
        const current = tx.select().from(preparationTargets).where(eq(preparationTargets.id, id)).get();
        if (!current) throw unknownTarget(id, this.targets());
        tx.update(preparationTargets)
          .set({
            ...(input.name !== undefined && { name: input.name }),
            ...(input.role !== undefined && { role: input.role }),
            ...(input.grade !== undefined && { grade: input.grade }),
            ...(input.market !== undefined && { market: input.market }),
            ...(input.language !== undefined && { language: input.language }),
            ...(interviewDate !== undefined && { interviewDate }),
            ...(input.mission && { mission: { ...current.mission, ...input.mission } }),
            ...(input.vacancies && { vacancies: input.vacancies.map(toVacancy) }),
            updatedAt: now,
          })
          .where(eq(preparationTargets.id, id))
          .run();
      } else {
        if (!input.role) {
          throw new DomainError(
            "A new Preparation target needs a role.",
            'Pass "role" (for example "Backend developer"), or pass "target_id" to update an existing target.',
          );
        }
        id = crypto.randomUUID();
        tx.insert(preparationTargets)
          .values({
            id,
            name: input.name ?? input.role,
            role: input.role,
            grade: input.grade ?? null,
            market: input.market ?? "ru",
            language: input.language ?? "ru",
            interviewDate: interviewDate ?? null,
            mission: { why: null, success: null, constraints: null, outOfScope: null, ...input.mission },
            vacancies: (input.vacancies ?? []).map(toVacancy),
            createdAt: now,
            updatedAt: now,
          })
          .run();
        const onboarding = tx
          .select()
          .from(activities)
          .where(and(eq(activities.status, "active"), eq(activities.kind, "onboarding")))
          .get();
        if (onboarding && !onboarding.targetId) {
          tx.update(activities).set({ targetId: id }).where(eq(activities.id, onboarding.id)).run();
        }
      }
      if (input.topics) this.#replaceTopics(tx, id, input.topics);
      if (input.activate ?? !input.targetId) setActiveTarget(tx, id);
      return id;
    });
    this.publishTargets();
    return present(this.#targetDetail(id));
  }

  switchTarget(targetId: string): TargetsResponse {
    const exists = this.#db.select({ id: preparationTargets.id }).from(preparationTargets).where(eq(preparationTargets.id, targetId)).get();
    if (!exists) throw unknownTarget(targetId, this.targets());
    setActiveTarget(this.#db, targetId);
    return this.publishTargets();
  }

  /** Records a choice the Candidate and the Interviewer agreed on; it belongs to the active target by default. */
  recordDecision(input: { decision: string; reason?: string | null; targetId?: string | null }): Decision {
    const targetId = input.targetId === undefined ? this.activeTargetId() : input.targetId;
    if (targetId && !this.#db.select().from(preparationTargets).where(eq(preparationTargets.id, targetId)).get()) {
      throw unknownTarget(targetId, this.targets());
    }
    const decision: Decision = {
      id: crypto.randomUUID(),
      targetId,
      decision: input.decision,
      reason: input.reason ?? null,
      createdAt: this.#now(),
    };
    this.#db.insert(decisionLog).values(decision).run();
    return decision;
  }

  /** Adds a Question to the shared bank. The Candidate's own Questions enter as active, Research output as Proposed. */
  addQuestion(input: QuestionInput): { id: string; topic: string; status: "proposed" | "active" } {
    const type = input.type ?? "open";
    checkOptions(type, input.options);
    checkHints(input.hints);
    const status = input.origin === "research" ? "proposed" : "active";
    const result = this.#db.transaction((tx) => {
      const topicId = this.#findOrCreateTopic(tx, input.topic);
      const duplicate = this.#duplicate(tx, topicId, input.prompt);
      if (duplicate) {
        const topic = tx.select({ name: topics.name }).from(topics).where(eq(topics.id, topicId)).get()?.name ?? input.topic;
        throw new DomainError(
          `The bank already has this Question in Topic "${topic}" (question ${duplicate.id}).`,
          "Do not add it again; tell the Candidate it is already in the bank.",
          { candidateMessage: `такой вопрос уже есть в банке, тема «${topic}».` },
        );
      }
      return { id: this.#insertQuestion(tx, topicId, { ...input, type }, status), topicId };
    });
    return { id: result.id, topic: present(this.#topicNames([result.topicId]).get(result.topicId)), status };
  }

  /**
   * Resolves the Questions of a Practice set in one transaction: bank Questions by id (filling
   * missing fields), and composed ones by Topic and prompt, reusing a bank Question with the same
   * prompt. Composed Questions enter the bank as active: the Candidate asked for the practice.
   * Returns the Question ids in order.
   */
  practiceQuestions(items: PracticeQuestion[]): string[] {
    for (const item of items) {
      checkHints(item.hints);
      if (item.questionId === undefined) checkOptions(item.type ?? "open", item.options);
    }
    return this.#db.transaction((tx) =>
      items.map((item) => {
        if (item.questionId !== undefined) {
          const row = tx.select().from(questions).where(eq(questions.id, item.questionId)).get();
          if (!row || row.status === "rejected") {
            throw new DomainError(`No active Question with id "${item.questionId}".`, "Use question ids from get_progress, or compose the Question with topic, prompt, and type.", { kind: "not_found" });
          }
          this.#fill(tx, row, item);
          return row.id;
        }
        const topicId = this.#findOrCreateTopic(tx, item.topic);
        const duplicate = this.#duplicate(tx, topicId, item.prompt);
        if (duplicate) {
          this.#fill(tx, duplicate, item);
          if (duplicate.status !== "active") tx.update(questions).set({ status: "active" }).where(eq(questions.id, duplicate.id)).run();
          return duplicate.id;
        }
        return this.#insertQuestion(tx, topicId, { ...item, type: item.type ?? "open", origin: "interviewer" }, "active");
      }),
    );
  }

  /** Completes the Activity if it is still running, such as a Practice set once graded. */
  completeActivity(activityId: string, summary: string): void {
    this.#db
      .update(activities)
      .set({ status: "completed", summary, endedAt: this.#now() })
      .where(and(eq(activities.id, activityId), eq(activities.status, "active")))
      .run();
  }

  /** The Topic id for a name in the bank, if the bank has it. */
  findTopic(name: string): string | null {
    return this.#db.select({ id: topics.id }).from(topics).where(eq(topics.key, normalize(name))).get()?.id ?? null;
  }

  /**
   * Starts an Activity. At most one Activity runs at a time: an active Activity of the same kind
   * continues, and one of another kind is abandoned. With `newTarget`, an onboarding that already
   * saved its Preparation target completes, and a fresh onboarding sets up the next target.
   */
  startActivity(kind: ActivityKind, options: { targetId?: string | null; newTarget?: boolean } = {}): { activity: Activity; started: boolean } {
    const result = this.#db.transaction((tx) => {
      const current = tx.select().from(activities).where(eq(activities.status, "active")).get();
      const setUpTarget = options.newTarget === true && current?.kind === "onboarding" && current.targetId !== null;
      if (current?.kind === kind && !setUpTarget) return { activity: current, started: false };
      const now = this.#now();
      if (current) {
        tx.update(activities)
          .set(
            setUpTarget
              ? { status: "completed", endedAt: now, summary: "Set up a Preparation target; the Candidate moved on to a new one." }
              : { status: "abandoned", endedAt: now },
          )
          .where(eq(activities.id, current.id))
          .run();
      }
      const activity: Activity = {
        id: crypto.randomUUID(),
        kind,
        status: "active",
        targetId: options.targetId ?? null,
        startedAt: now,
        endedAt: null,
        summary: null,
      };
      tx.insert(activities).values(activity).run();
      return { activity, started: true };
    });
    return result;
  }

  /** Ends the active Activity with a summary. Completing onboarding requires the Preparation target it set up. */
  finishActivity(input: { status: "completed" | "skipped"; summary: string }): Activity {
    const current = this.currentActivity();
    if (!current) {
      throw new DomainError("No Activity is running.", "Call finish_activity only while an Activity is active.");
    }
    if (current.kind === "onboarding" && input.status === "completed" && !current.targetId) {
      throw new DomainError(
        "Onboarding cannot complete before a Preparation target is saved.",
        'Call save_target with at least "role" first, or finish with "status": "skipped" if the Candidate skips onboarding.',
      );
    }
    const ended: Activity = { ...current, status: input.status, summary: input.summary, endedAt: this.#now() };
    this.#db
      .update(activities)
      .set({ status: ended.status, summary: ended.summary, endedAt: ended.endedAt })
      .where(eq(activities.id, current.id))
      .run();
    return ended;
  }

  // Internals

  /** The Preparation target the Candidate works on, if any. */
  activeTargetId(): string | null {
    const row = this.#db.select().from(settings).where(eq(settings.key, activeTargetKey)).get();
    return typeof row?.value === "string" ? row.value : null;
  }

  /** Tells live clients the targets changed, such as readiness or Due after an Attempt. */
  publishTargets(): TargetsResponse {
    const targets = this.targets();
    this.#events.publish({ type: "targets.changed", targets });
    return targets;
  }

  #summary(row: typeof preparationTargets.$inferSelect): TargetSummary {
    return {
      id: row.id,
      name: row.name,
      role: row.role,
      grade: row.grade,
      interviewDate: row.interviewDate,
      daysLeft: row.interviewDate ? daysBetween(localDate(this.#now()), row.interviewDate) : null,
      ...this.#progressSummary(row.id),
    };
  }

  #progressSummary(targetId: string): Pick<TargetSummary, "readiness" | "due"> {
    const { readiness, due } = this.progress.forTarget(targetId);
    return { readiness, due };
  }

  #targetDetail(id: string): TargetDetail | null {
    const row = this.#db.select().from(preparationTargets).where(eq(preparationTargets.id, id)).get();
    if (!row) return null;
    const rows = this.#db
      .select({ topicId: topics.id, name: topics.name, parentId: topics.parentId, priority: targetTopics.priority })
      .from(targetTopics)
      .innerJoin(topics, eq(topics.id, targetTopics.topicId))
      .where(eq(targetTopics.targetId, id))
      .orderBy(asc(targetTopics.position))
      .all();
    const groups = this.#topicNames(rows.flatMap((r) => (r.parentId ? [r.parentId] : [])));
    return {
      ...this.#summary(row),
      market: row.market,
      language: row.language,
      mission: row.mission,
      vacancies: row.vacancies,
      topics: rows.map((r) => ({ name: r.name, priority: r.priority, group: r.parentId ? (groups.get(r.parentId) ?? null) : null })),
    };
  }

  #topicNames(ids: string[]): Map<string, string> {
    if (!ids.length) return new Map();
    const rows = this.#db.select({ id: topics.id, name: topics.name }).from(topics).where(inArray(topics.id, ids)).all();
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  #replaceTopics(tx: Tx, targetId: string, refs: TopicRef[]): void {
    const seen = new Set<string>();
    const rows: (typeof targetTopics.$inferInsert)[] = [];
    for (const ref of refs) {
      const topicId = this.#findOrCreateTopic(tx, ref.name, ref.group ?? undefined);
      if (seen.has(topicId)) {
        throw new DomainError(`Topic "${ref.name}" is listed twice.`, "List each Topic once with a single priority.");
      }
      seen.add(topicId);
      rows.push({ targetId, topicId, priority: ref.priority, position: rows.length });
    }
    tx.delete(targetTopics).where(eq(targetTopics.targetId, targetId)).run();
    if (rows.length) tx.insert(targetTopics).values(rows).run();
  }

  #duplicate(tx: Tx, topicId: string, prompt: string): typeof questions.$inferSelect | undefined {
    const key = normalize(prompt);
    return tx.select().from(questions).where(eq(questions.topicId, topicId)).all().find((q) => normalize(q.prompt) === key);
  }

  #insertQuestion(tx: Tx, topicId: string, input: QuestionInput & { type: QuestionType }, status: "proposed" | "active"): string {
    const id = crypto.randomUUID();
    tx.insert(questions)
      .values({
        id,
        topicId,
        type: input.type,
        prompt: input.prompt,
        options: input.type === "open" ? null : (input.options ?? null),
        referenceAnswer: input.referenceAnswer ?? null,
        verified: false,
        rubricAnchors: input.rubricAnchors ?? null,
        hints: input.hints?.length ? input.hints : null,
        status,
        origin: input.origin,
        createdAt: this.#now(),
      })
      .run();
    return id;
  }

  /** Fills a bank Question's missing Reference answer, Rubric anchors, or hints; stored values win. */
  #fill(tx: Tx, row: typeof questions.$inferSelect, fill: QuestionFill): void {
    const set = {
      ...(!row.referenceAnswer && fill.referenceAnswer && { referenceAnswer: fill.referenceAnswer }),
      ...(!row.rubricAnchors && fill.rubricAnchors && { rubricAnchors: fill.rubricAnchors }),
      ...(!row.hints?.length && fill.hints?.length && { hints: fill.hints }),
    };
    if (Object.keys(set).length) tx.update(questions).set(set).where(eq(questions.id, row.id)).run();
  }

  /** Topics are shared across Preparation targets: the same name always means the same Topic. */
  #findOrCreateTopic(tx: Tx, name: string, group?: string): string {
    const key = normalize(name);
    const parentId = group ? this.#findOrCreateTopic(tx, group) : undefined;
    const existing = tx.select().from(topics).where(eq(topics.key, key)).get();
    if (existing) {
      if (parentId && !existing.parentId && !this.#isWithin(tx, parentId, existing.id)) {
        tx.update(topics).set({ parentId }).where(eq(topics.id, existing.id)).run();
      }
      return existing.id;
    }
    const id = crypto.randomUUID();
    tx.insert(topics)
      .values({ id, name: tidy(name), key, parentId: parentId ?? null, createdAt: this.#now() })
      .run();
    return id;
  }

  /** Whether `topicId` is `ancestorId` or nests under it; keeps Topic groups free of cycles. */
  #isWithin(tx: Tx, topicId: string, ancestorId: string): boolean {
    for (let id: string | null = topicId; id; ) {
      if (id === ancestorId) return true;
      id = tx.select({ parentId: topics.parentId }).from(topics).where(eq(topics.id, id)).get()?.parentId ?? null;
    }
    return false;
  }

  #checkDate(date: string | null): string | null {
    if (date === null) return null;
    const today = localDate(this.#now());
    if (date < today) {
      throw new DomainError(
        `interview_date ${date} is before today (${today}).`,
        "Pass a future date as YYYY-MM-DD, or null when the Candidate has no date.",
      );
    }
    return date;
  }
}

/** A record the same call has just written; its absence is a bug, not a domain refusal. */
function present<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Domain record vanished right after it was written.");
  return value;
}

function setActiveTarget(db: Database | Tx, targetId: string): void {
  db.insert(settings)
    .values({ key: activeTargetKey, value: targetId })
    .onConflictDoUpdate({ target: settings.key, set: { value: targetId } })
    .run();
}

function unknownTarget(id: string, known: TargetsResponse): DomainError {
  const list = known.targets.map((t) => `${t.id} (${t.name})`).join(", ") || "none yet";
  return new DomainError(`No Preparation target with id "${id}".`, `Use one of: ${list}.`, {
    kind: "not_found",
    candidateMessage: "такой цели подготовки нет. Обновите страницу.",
  });
}

function toVacancy(v: Partial<Vacancy>): Vacancy {
  return { title: v.title ?? null, url: v.url ?? null, text: v.text ?? null };
}

function checkOptions(type: QuestionType, options: TestOption[] | undefined): void {
  if (type === "open") {
    if (options?.length) {
      throw new DomainError("An open Question has no options.", 'Drop "options", or use type "single_choice" or "multiple_choice".');
    }
    return;
  }
  const correct = options?.filter((o) => o.correct).length ?? 0;
  if (!options || options.length < 2 || correct === 0 || (type === "single_choice" && correct !== 1)) {
    throw new DomainError(
      `A ${type} Question needs at least two options and ${type === "single_choice" ? "exactly one" : "at least one"} correct.`,
      'Pass "options": [{"text": "...", "correct": true}, {"text": "...", "correct": false}, ...].',
    );
  }
}

function checkHints(hints: string[] | null | undefined): void {
  if (hints && hints.length > maxHintRungs) {
    throw new DomainError(`A Question has at most ${maxHintRungs} hint rungs.`, `Pass up to ${maxHintRungs} hints, mildest first.`);
  }
}

/** Text with surrounding space trimmed and inner runs of space collapsed. */
function tidy(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/** The comparison key for Topic names and Question prompts: tidy and case-insensitive. */
export function normalize(text: string): string {
  return tidy(text).toLocaleLowerCase();
}

/** The local calendar date of an instant as `YYYY-MM-DD`. */
export function localDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Calendar days from one `YYYY-MM-DD` date to another; `null` once the second is past. */
function daysBetween(from: string, to: string): number | null {
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
  return days >= 0 ? days : null;
}
