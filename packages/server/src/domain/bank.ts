// The Question bank as the Candidate browses and grows it (ADR-0003): the Skill map, Topic detail
// with Attempt history, Reference answer edits, and the Proposed queue that Research output waits
// in until the Candidate approves it. Duplicates are merged here, never by the agent.
import crypto from "node:crypto";
import { and, asc, desc, eq, inArray, max, sql } from "drizzle-orm";
import type {
  AttemptRecord,
  BankQuestion,
  BankResponse,
  ProposedBatch,
  ProposedResponse,
  ReviewRequest,
  ReviewResponse,
  SkillMapResponse,
  SourceRef,
  TopicDetailResponse,
} from "@prepare-to-interview/shared";
import type { Database } from "../db/database.ts";
import {
  activities,
  attempts,
  candidateProfile,
  preparationTargets,
  questions,
  questionSchedule,
  questionSources,
  sources,
  targetTopics,
  topicProposals,
  topics,
  topicSources,
  type QuestionType,
  type RubricAnchors,
  type TestOption,
  type TopicPriority,
} from "../db/schema.ts";
import type { EventBus } from "../events.ts";
import { questionMastery, topicMastery } from "./arithmetic.ts";
import { checkHints, checkOptions, DomainError, localDate, type Domain } from "./domain.ts";
import type { Tx } from "./progress.ts";

export interface TopicProposalInput {
  name: string;
  group?: string | null;
  priority: TopicPriority;
  reason?: string | null;
  sourceIds?: string[];
}

export interface QuestionProposalInput {
  topic: string;
  prompt: string;
  type: QuestionType;
  options?: TestOption[];
  referenceAnswer?: string | null;
  rubricAnchors?: RubricAnchors | null;
  hints?: string[] | null;
  /** Research only with Sources: every proposed Question names at least one archived Source. */
  sourceIds: string[];
}

export interface ProposeInput {
  /** The Research batch; `null` when the Interviewer proposes outside Research. */
  activityId: string | null;
  targetId: string;
  topics: TopicProposalInput[];
  questions: QuestionProposalInput[];
}

/** What happened to each proposed item, so the agent knows what the Candidate will review. */
export interface ProposeResult {
  topics: { name: string; outcome: "proposed" | "merged" | "in_target" | "rejected_before"; proposalId: string | null }[];
  questions: {
    prompt: string;
    topic: string;
    /** `topic_rejected`: the Candidate rejected the Question's Topic for this target, so it is not proposed. */
    outcome: "proposed" | "merged" | "rejected_before" | "topic_rejected";
    questionId: string | null;
    /** Status of the bank Question a duplicate merged into. */
    status: "proposed" | "active" | "rejected" | null;
  }[];
}

export class Bank {
  readonly #db: Database;
  readonly #domain: Domain;
  readonly #events: EventBus;
  readonly #now: () => Date;

  constructor(options: { db: Database; domain: Domain; events: EventBus; now: () => Date }) {
    this.#db = options.db;
    this.#domain = options.domain;
    this.#events = options.events;
    this.#now = options.now;
  }

  // Proposed queue

  /**
   * Adds Research output as Proposed. A Question whose prompt matches one already in the bank
   * (case, punctuation, and ё/е aside) is merged into it: its Sources join the bank Question, and a
   * Proposed one gets its missing fields filled; an active Question keeps its content, which only
   * the Candidate changes. A Question the Candidate rejected before, or one in a Topic they rejected
   * for the target, is not proposed again. A Topic outside the target is proposed for it, also when
   * only a Question names it.
   */
  propose(input: ProposeInput): ProposeResult {
    for (const q of input.questions) {
      checkOptions(q.type, q.options);
      checkHints(q.hints);
      if (q.type === "open" && !q.referenceAnswer) {
        throw new DomainError(`The open Question "${q.prompt}" has no reference_answer.`, "Add reference_answer: what a good answer contains, backed by its Sources.");
      }
      if (!q.sourceIds.length) {
        throw new DomainError(`The Question "${q.prompt}" names no Source.`, "Archive the page with archive_source first and pass its source_id in source_ids.");
      }
    }
    const result = this.#db.transaction((tx) => {
      this.#checkSources(tx, [...input.topics.flatMap((t) => t.sourceIds ?? []), ...input.questions.flatMap((q) => q.sourceIds)]);
      const out: ProposeResult = { topics: [], questions: [] };
      for (const t of input.topics) {
        const topicId = this.#domain.ensureTopic(tx, t.name, t.group);
        linkTopicSources(tx, topicId, t.sourceIds ?? []);
        const { outcome, proposalId } = this.#proposeTopic(tx, input, topicId, t.priority, t.reason ?? null);
        out.topics.push({ name: topicName(tx, topicId), outcome, proposalId });
      }
      const keys = bankKeys(tx);
      for (const q of input.questions) {
        const topicId = this.#domain.ensureTopic(tx, q.topic);
        const key = dedupeKey(q.prompt);
        const existing = keys.get(key);
        if (existing) {
          if (existing.status !== "rejected") linkQuestionSources(tx, existing.id, q.sourceIds);
          if (existing.status === "proposed") fill(tx, existing.id, q);
          out.questions.push({
            prompt: existing.prompt,
            topic: topicName(tx, existing.topicId),
            outcome: existing.status === "rejected" ? "rejected_before" : "merged",
            questionId: existing.id,
            status: existing.status,
          });
          continue;
        }
        // A Question in a Topic the target lacks brings the Topic along as Proposed.
        if (this.#proposeTopic(tx, input, topicId, "medium", null).outcome === "rejected_before") {
          out.questions.push({ prompt: q.prompt, topic: topicName(tx, topicId), outcome: "topic_rejected", questionId: null, status: null });
          continue;
        }
        const id = crypto.randomUUID();
        tx.insert(questions)
          .values({
            id,
            topicId,
            type: q.type,
            prompt: q.prompt.trim(),
            options: q.type === "open" ? null : (q.options ?? null),
            referenceAnswer: q.referenceAnswer ?? null,
            verified: false,
            rubricAnchors: q.rubricAnchors ?? null,
            hints: q.hints?.length ? q.hints : null,
            status: "proposed",
            origin: "research",
            activityId: input.activityId,
            createdAt: this.#now(),
          })
          .run();
        linkQuestionSources(tx, id, q.sourceIds);
        keys.set(key, { id, prompt: q.prompt, topicId, status: "proposed" });
        out.questions.push({ prompt: q.prompt, topic: topicName(tx, topicId), outcome: "proposed", questionId: id, status: "proposed" });
      }
      return out;
    });
    this.publish();
    return result;
  }

  /** Proposed items waiting for review, grouped by Research batch, newest batch first. */
  queue(): ProposedResponse {
    const topicRows = this.#db
      .select({
        id: topicProposals.id,
        topicId: topicProposals.topicId,
        name: topics.name,
        parentId: topics.parentId,
        priority: topicProposals.priority,
        reason: topicProposals.reason,
        activityId: topicProposals.activityId,
        targetId: topicProposals.targetId,
      })
      .from(topicProposals)
      .innerJoin(topics, eq(topics.id, topicProposals.topicId))
      .where(eq(topicProposals.status, "proposed"))
      .orderBy(asc(topicProposals.createdAt), asc(sql`${topicProposals}.rowid`))
      .all();
    const questionRows = this.#db
      .select()
      .from(questions)
      .where(eq(questions.status, "proposed"))
      .orderBy(asc(questions.createdAt), asc(sql`${questions}.rowid`))
      .all();
    const names = this.#topicNames();
    const topicSourceMap = this.#sourcesOf(topicSources, topicRows.map((t) => t.topicId));
    const questionSourceMap = this.#sourcesOf(questionSources, questionRows.map((q) => q.id));
    const batchIds = [...new Set([...topicRows.map((t) => t.activityId), ...questionRows.map((q) => q.activityId)])];
    const activityRows = new Map(
      this.#db
        .select()
        .from(activities)
        .where(inArray(activities.id, batchIds.filter((id): id is string => id !== null)))
        .all()
        .map((a) => [a.id, a]),
    );
    const targetNames = new Map(this.#db.select({ id: preparationTargets.id, name: preparationTargets.name }).from(preparationTargets).all().map((t) => [t.id, t.name]));
    const batches: ProposedBatch[] = batchIds.map((id) => {
      const activity = id ? activityRows.get(id) : undefined;
      const batchTopics = topicRows.filter((t) => t.activityId === id);
      const targetId = activity?.targetId ?? batchTopics[0]?.targetId ?? null;
      return {
        id,
        targetName: targetId ? (targetNames.get(targetId) ?? null) : null,
        startedAt: activity ? activity.startedAt.getTime() : null,
        running: activity?.status === "active",
        summary: activity?.summary ?? null,
        topics: batchTopics.map((t) => ({
          id: t.id,
          name: t.name,
          group: t.parentId ? (names.get(t.parentId) ?? null) : null,
          priority: t.priority,
          reason: t.reason,
          sources: topicSourceMap.get(t.topicId) ?? [],
        })),
        questions: questionRows
          .filter((q) => q.activityId === id)
          .map((q) => ({
            id: q.id,
            topic: names.get(q.topicId) ?? "",
            type: q.type,
            prompt: q.prompt,
            referenceAnswer: q.referenceAnswer,
            options: q.options,
            sources: questionSourceMap.get(q.id) ?? [],
          })),
      };
    });
    batches.sort((a, b) => (b.startedAt ?? Number.MAX_SAFE_INTEGER) - (a.startedAt ?? Number.MAX_SAFE_INTEGER));
    return { count: topicRows.length + questionRows.length, batches };
  }

  /** How many Proposed items wait for review. */
  proposedCount(): number {
    const t = this.#db.select({ n: sql<number>`count(*)` }).from(topicProposals).where(eq(topicProposals.status, "proposed")).get()?.n ?? 0;
    const q = this.#db.select({ n: sql<number>`count(*)` }).from(questions).where(eq(questions.status, "proposed")).get()?.n ?? 0;
    return t + q;
  }

  /**
   * Approves or rejects Proposed items: picked ones, a whole Research batch, or everything.
   * Approving a Question approves its Topic's proposal for the same target (its batch's, or the
   * active one outside Research), so it shows in that target's Skill map; rejecting a Topic rejects the Questions of the same batch in it. Items no longer Proposed are
   * left as they are.
   */
  review(request: ReviewRequest): ReviewResponse {
    const counts = this.#db.transaction((tx) => {
      const proposedTopics = tx.select().from(topicProposals).where(eq(topicProposals.status, "proposed")).all();
      const proposedQuestions = tx.select().from(questions).where(eq(questions.status, "proposed")).all();
      const picked = pick(request, proposedTopics, proposedQuestions);
      const topicIds = new Set(picked.topics.map((t) => t.id));
      const questionIds = new Set(picked.questions.map((q) => q.id));
      if (request.action === "approve") {
        for (const q of proposedQuestions) {
          if (!questionIds.has(q.id)) continue;
          const target = this.#targetOf(tx, q.activityId);
          for (const t of proposedTopics) if (t.topicId === q.topicId && t.targetId === target) topicIds.add(t.id);
        }
        for (const t of proposedTopics) if (topicIds.has(t.id)) this.#approveTopic(tx, t);
        if (questionIds.size) tx.update(questions).set({ status: "active" }).where(inArray(questions.id, [...questionIds])).run();
      } else {
        for (const t of proposedTopics) {
          if (!topicIds.has(t.id)) continue;
          for (const q of proposedQuestions) if (q.topicId === t.topicId && q.activityId === t.activityId) questionIds.add(q.id);
        }
        if (topicIds.size) tx.update(topicProposals).set({ status: "rejected" }).where(inArray(topicProposals.id, [...topicIds])).run();
        if (questionIds.size) tx.update(questions).set({ status: "rejected" }).where(inArray(questions.id, [...questionIds])).run();
      }
      return topicIds.size + questionIds.size;
    });
    const proposed = this.publish();
    if (request.action === "approve" && counts) this.#domain.publishTargets();
    return { approved: request.action === "approve" ? counts : 0, rejected: request.action === "reject" ? counts : 0, proposed };
  }

  /**
   * The Proposed items a review request picks now, before approving a Question pulls in its
   * Topic's proposal: what the Candidate confirms when the Interviewer asks to review.
   */
  selection(request: ReviewRequest): { topics: { id: string; name: string }[]; questions: { id: string; prompt: string }[] } {
    return this.#db.transaction((tx) => {
      const proposedTopics = tx.select().from(topicProposals).where(eq(topicProposals.status, "proposed")).all();
      const proposedQuestions = tx.select().from(questions).where(eq(questions.status, "proposed")).all();
      const picked = pick(request, proposedTopics, proposedQuestions);
      // Approving a Question also approves its Topic's proposal, so the Candidate sees that Topic too.
      const pickedTopics = new Set(picked.topics);
      if (request.action === "approve") {
        for (const q of picked.questions) {
          const target = this.#targetOf(tx, q.activityId);
          for (const t of proposedTopics) if (t.topicId === q.topicId && t.targetId === target) pickedTopics.add(t);
        }
      }
      const names = new Map(tx.select({ id: topics.id, name: topics.name }).from(topics).all().map((t) => [t.id, t.name]));
      return {
        topics: [...pickedTopics].map((t) => ({ id: t.id, name: names.get(t.topicId) ?? "" })),
        questions: picked.questions.map((q) => ({ id: q.id, prompt: q.prompt })),
      };
    });
  }

  // Skill map and the bank

  skillMap(): SkillMapResponse {
    const targetId = this.#domain.activeTargetId();
    const target = targetId ? this.#db.select({ name: preparationTargets.name }).from(preparationTargets).where(eq(preparationTargets.id, targetId)).get() : undefined;
    const progress = targetId ? this.#domain.progress.forTarget(targetId) : { readiness: null, due: 0, topics: [] };
    return {
      targetId,
      targetName: target?.name ?? null,
      readiness: progress.readiness,
      due: progress.due,
      topics: progress.topics.map((t) => ({ topicId: t.topicId, name: t.name, group: t.group, priority: t.priority, mastery: t.mastery, questions: t.questions, due: t.due })),
      proposed: this.proposedCount(),
    };
  }

  /** A Topic with its active and Proposed Questions (subtopics included), their Sources and Attempt history. */
  topicDetail(topicId: string): TopicDetailResponse {
    const topic = this.#db.select().from(topics).where(eq(topics.id, topicId)).get();
    if (!topic) throw new DomainError(`No Topic with id "${topicId}".`, "Use a topic id from the Skill map.", { kind: "not_found", candidateMessage: "такой темы нет. Обновите страницу." });
    const ids = [...this.#subtree(topicId)];
    const rows = this.#db
      .select()
      .from(questions)
      .where(and(inArray(questions.topicId, ids), inArray(questions.status, ["active", "proposed"])))
      .orderBy(asc(questions.createdAt), asc(sql`${questions}.rowid`))
      .all()
      .sort((a, b) => Number(a.status === "proposed") - Number(b.status === "proposed"));
    const detailed = this.#questionsDetail(rows);
    const masteries = detailed.flatMap((q) => (q.status === "active" && q.mastery !== null ? [q.mastery] : []));
    const calibration = this.#db.select({ calibration: candidateProfile.calibration }).from(candidateProfile).get()?.calibration ?? [];
    const names = this.#topicNames();
    return {
      topic: {
        id: topic.id,
        name: topic.name,
        group: topic.parentId ? (names.get(topic.parentId) ?? null) : null,
        mastery: topicMastery(masteries, calibration.find((c) => c.topicId === topicId)?.level),
        due: detailed.filter((q) => q.status === "active" && q.due).length,
        sources: this.#sourcesOf(topicSources, [topicId]).get(topicId) ?? [],
      },
      questions: detailed,
    };
  }

  /** Every Topic with active Questions, alphabetically, for browsing the shared bank. */
  bank(): BankResponse {
    const rows = this.#db.select().from(questions).where(eq(questions.status, "active")).orderBy(asc(questions.createdAt), asc(sql`${questions}.rowid`)).all();
    const detailed = new Map(this.#questionsDetail(rows, { history: false }).map((q) => [q.id, q]));
    const allTopics = this.#db.select().from(topics).all();
    const names = new Map(allTopics.map((t) => [t.id, t.name]));
    const result = allTopics
      .map((t) => {
        const qs = rows.filter((q) => q.topicId === t.id).map((q) => detailed.get(q.id) as BankQuestion);
        const masteries = qs.flatMap((q) => (q.mastery === null ? [] : [q.mastery]));
        return {
          topicId: t.id,
          name: t.name,
          group: t.parentId ? (names.get(t.parentId) ?? null) : null,
          mastery: topicMastery(masteries, undefined),
          questions: qs.map((q) => ({ id: q.id, type: q.type, prompt: q.prompt, verified: q.verified, due: q.due })),
        };
      })
      .filter((t) => t.questions.length)
      .sort((a, b) => a.name.localeCompare(b.name));
    return { topics: result };
  }

  /** The Candidate edits a Reference answer or marks it verified; editing keeps the flag unless it is passed. */
  updateReference(questionId: string, update: { referenceAnswer?: string | null; verified?: boolean }): BankQuestion {
    const row = this.#db.select().from(questions).where(eq(questions.id, questionId)).get();
    if (!row || row.status === "rejected") {
      throw new DomainError(`No Question with id "${questionId}".`, "Use a question id from the Skill map.", { kind: "not_found", candidateMessage: "такого вопроса нет. Обновите страницу." });
    }
    const referenceAnswer = update.referenceAnswer === undefined ? row.referenceAnswer : update.referenceAnswer?.trim() || null;
    const verified = update.verified ?? row.verified;
    if (verified && !referenceAnswer) {
      throw new DomainError("A Question without a Reference answer cannot be verified.", "Write the Reference answer first.", {
        candidateMessage: "сначала напишите эталонный ответ.",
      });
    }
    if (row.type === "open" && row.status === "active" && !referenceAnswer) {
      throw new DomainError("An open Question needs a Reference answer for grading.", "Keep a Reference answer.", {
        candidateMessage: "у открытого вопроса должен быть эталонный ответ — по нему проверяется ответ.",
      });
    }
    this.#db.update(questions).set({ referenceAnswer, verified }).where(eq(questions.id, questionId)).run();
    this.publish();
    return this.#questionsDetail([{ ...row, referenceAnswer, verified }])[0] as BankQuestion;
  }

  /** Tells live clients the bank changed; returns the Proposed count. */
  publish(): number {
    const proposed = this.proposedCount();
    this.#events.publish({ type: "bank.changed", proposed });
    return proposed;
  }

  // Internals

  #proposeTopic(tx: Tx, input: ProposeInput, topicId: string, priority: TopicPriority, reason: string | null): { outcome: ProposeResult["topics"][number]["outcome"]; proposalId: string | null } {
    const inTarget = tx.select().from(targetTopics).where(and(eq(targetTopics.targetId, input.targetId), eq(targetTopics.topicId, topicId))).get();
    if (inTarget) return { outcome: "in_target", proposalId: null };
    const earlier = tx
      .select()
      .from(topicProposals)
      .where(and(eq(topicProposals.targetId, input.targetId), eq(topicProposals.topicId, topicId)))
      .orderBy(desc(topicProposals.createdAt))
      .all();
    const open = earlier.find((p) => p.status === "proposed");
    if (open) {
      if (reason && !open.reason) tx.update(topicProposals).set({ reason }).where(eq(topicProposals.id, open.id)).run();
      return { outcome: "merged", proposalId: open.id };
    }
    if (earlier.some((p) => p.status === "rejected")) return { outcome: "rejected_before", proposalId: null };
    const id = crypto.randomUUID();
    tx.insert(topicProposals)
      .values({ id, targetId: input.targetId, topicId, priority, reason, status: "proposed", activityId: input.activityId, createdAt: this.#now() })
      .run();
    return { outcome: "proposed", proposalId: id };
  }

  /** The target a Research batch worked for; outside Research, the active target. */
  #targetOf(tx: Tx, activityId: string | null): string | null {
    if (!activityId) return this.#domain.activeTargetId();
    return tx.select({ targetId: activities.targetId }).from(activities).where(eq(activities.id, activityId)).get()?.targetId ?? null;
  }

  #approveTopic(tx: Tx, proposal: typeof topicProposals.$inferSelect): void {
    tx.update(topicProposals).set({ status: "approved" }).where(eq(topicProposals.id, proposal.id)).run();
    const exists = tx.select().from(targetTopics).where(and(eq(targetTopics.targetId, proposal.targetId), eq(targetTopics.topicId, proposal.topicId))).get();
    if (exists) {
      // The Topic joined the target meanwhile, such as through practice; the approved priority wins.
      tx.update(targetTopics).set({ priority: proposal.priority }).where(and(eq(targetTopics.targetId, proposal.targetId), eq(targetTopics.topicId, proposal.topicId))).run();
      return;
    }
    const last = tx.select({ last: max(targetTopics.position) }).from(targetTopics).where(eq(targetTopics.targetId, proposal.targetId)).get()?.last ?? -1;
    tx.insert(targetTopics).values({ targetId: proposal.targetId, topicId: proposal.topicId, priority: proposal.priority, position: last + 1 }).run();
  }

  #checkSources(tx: Tx, ids: string[]): void {
    const unique = [...new Set(ids)];
    if (!unique.length) return;
    const found = new Set(tx.select({ id: sources.id }).from(sources).where(inArray(sources.id, unique)).all().map((s) => s.id));
    const missing = unique.filter((id) => !found.has(id));
    if (missing.length) {
      throw new DomainError(`Unknown source_ids: ${missing.join(", ")}.`, "Pass source_id values that archive_source returned.", { kind: "not_found" });
    }
  }

  #questionsDetail(rows: (typeof questions.$inferSelect)[], options: { history?: boolean } = {}): BankQuestion[] {
    const ids = rows.map((r) => r.id);
    if (!ids.length) return [];
    const today = localDate(this.#now());
    const schedules = new Map(this.#db.select().from(questionSchedule).where(inArray(questionSchedule.questionId, ids)).all().map((s) => [s.questionId, s]));
    const attemptRows = this.#db
      .select()
      .from(attempts)
      .where(inArray(attempts.questionId, ids))
      .orderBy(desc(attempts.createdAt), desc(sql`${attempts}.rowid`))
      .all();
    const sourceMap = options.history === false ? new Map<string, SourceRef[]>() : this.#sourcesOf(questionSources, ids);
    const names = this.#topicNames();
    return rows.map((q) => {
      const own = attemptRows.filter((a) => a.questionId === q.id);
      const counted = own.filter((a) => a.status === "graded" && !a.retry && a.score !== null).map((a) => a.score as number);
      const s = schedules.get(q.id);
      return {
        id: q.id,
        topic: names.get(q.topicId) ?? "",
        type: q.type,
        prompt: q.prompt,
        options: q.options,
        referenceAnswer: q.referenceAnswer,
        verified: q.verified,
        status: q.status,
        origin: q.origin,
        box: s?.box ?? null,
        dueOn: s?.dueOn ?? null,
        due: s !== undefined && s.dueOn <= today && q.status === "active",
        mastery: questionMastery(counted),
        sources: sourceMap.get(q.id) ?? [],
        attempts: options.history === false ? [] : own.map(toAttemptRecord),
      };
    });
  }

  /** Archived Sources by owner: Questions or Topics. */
  #sourcesOf(table: typeof questionSources | typeof topicSources, ids: string[]): Map<string, SourceRef[]> {
    const result = new Map<string, SourceRef[]>();
    if (!ids.length) return result;
    const owner = table === questionSources ? questionSources.questionId : topicSources.topicId;
    const rows = this.#db
      .select({ owner, source: sources })
      .from(table)
      .innerJoin(sources, eq(sources.id, table.sourceId))
      .where(inArray(owner, ids))
      .orderBy(asc(sources.fetchedAt))
      .all();
    for (const r of rows) result.set(r.owner, [...(result.get(r.owner) ?? []), toSourceRef(r.source)]);
    return result;
  }

  #subtree(rootId: string): Set<string> {
    const all = this.#db.select({ id: topics.id, parentId: topics.parentId }).from(topics).all();
    const ids = new Set<string>([rootId]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const t of all) {
        if (t.parentId && ids.has(t.parentId) && !ids.has(t.id)) {
          ids.add(t.id);
          grew = true;
        }
      }
    }
    return ids;
  }

  #topicNames(): Map<string, string> {
    return new Map(this.#db.select({ id: topics.id, name: topics.name }).from(topics).all().map((t) => [t.id, t.name]));
  }
}

/**
 * The key duplicates share: case, punctuation, spacing, and ё/е aside. "Что такое индекс?" and
 * "что такое  индекс" are the same Question.
 */
export function dedupeKey(prompt: string): string {
  return prompt
    .toLocaleLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function bankKeys(tx: Tx): Map<string, { id: string; prompt: string; topicId: string; status: "proposed" | "active" | "rejected" }> {
  const rows = tx.select({ id: questions.id, prompt: questions.prompt, topicId: questions.topicId, status: questions.status }).from(questions).orderBy(asc(questions.createdAt)).all();
  const keys = new Map<string, (typeof rows)[number]>();
  // An active Question wins over a Proposed or rejected one with the same key.
  for (const r of rows) {
    const key = dedupeKey(r.prompt);
    const seen = keys.get(key);
    if (!seen || (seen.status !== "active" && r.status === "active")) keys.set(key, r);
  }
  return keys;
}

function linkQuestionSources(tx: Tx, questionId: string, sourceIds: string[]): void {
  for (const sourceId of new Set(sourceIds)) tx.insert(questionSources).values({ questionId, sourceId }).onConflictDoNothing().run();
}

function linkTopicSources(tx: Tx, topicId: string, sourceIds: string[]): void {
  for (const sourceId of new Set(sourceIds)) tx.insert(topicSources).values({ topicId, sourceId }).onConflictDoNothing().run();
}

/** Fills a merged Question's missing Reference answer, Rubric anchors, or hints; stored values win. */
function fill(tx: Tx, questionId: string, q: QuestionProposalInput): void {
  const row = tx.select().from(questions).where(eq(questions.id, questionId)).get();
  if (!row) return;
  const set = {
    ...(!row.referenceAnswer && q.referenceAnswer && { referenceAnswer: q.referenceAnswer }),
    ...(!row.rubricAnchors && q.rubricAnchors && { rubricAnchors: q.rubricAnchors }),
    ...(!row.hints?.length && q.hints?.length && { hints: q.hints }),
  };
  if (Object.keys(set).length) tx.update(questions).set(set).where(eq(questions.id, questionId)).run();
}

function topicName(tx: Tx, topicId: string): string {
  return tx.select({ name: topics.name }).from(topics).where(eq(topics.id, topicId)).get()?.name ?? "";
}

export function toSourceRef(s: typeof sources.$inferSelect): SourceRef {
  return { id: s.id, kind: s.kind, url: s.url, title: s.title, fetchedAt: s.fetchedAt.getTime() };
}

function toAttemptRecord(a: typeof attempts.$inferSelect): AttemptRecord {
  return {
    id: a.id,
    createdAt: a.createdAt.getTime(),
    mode: a.mode,
    status: a.status,
    score: a.score,
    maxScore: a.maxScore,
    hintRung: a.hintRung,
    answer: a.answer,
    quote: a.quote,
    strengths: a.strengths,
    gap: a.gap,
    retry: a.retry,
  };
}

/** The Proposed Topics and Questions a review request names: picked ones, a whole Research batch, or everything. */
function pick<T extends { id: string; activityId: string | null }, Q extends { id: string; activityId: string | null }>(
  request: ReviewRequest,
  proposedTopics: T[],
  proposedQuestions: Q[],
): { topics: T[]; questions: Q[] } {
  const inBatch = (activityId: string | null) => request.all === true || (request.batchId !== undefined && activityId === request.batchId);
  return {
    topics: proposedTopics.filter((t) => inBatch(t.activityId) || request.topics?.includes(t.id)),
    questions: proposedQuestions.filter((q) => inBatch(q.activityId) || request.questions?.includes(q.id)),
  };
}
