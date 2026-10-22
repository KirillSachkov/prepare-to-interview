// Continuity without session management (ADR-0002): when the Chat's Agent session ends, what the
// next one starts from, the review at Activity boundaries, and memory updates the Candidate
// confirms. The Chat asks this policy before every turn; Activities trigger it by completing.
import crypto from "node:crypto";
import { and, asc, desc, eq, gte, isNull, ne } from "drizzle-orm";
import type { MemoryProposalView } from "@prepare-to-interview/shared";
import type { AgentSessionRow, Chat, SessionPolicy } from "../chat/chat.ts";
import type { Database } from "../db/database.ts";
import {
  activities,
  agentSessions,
  chatMessages,
  memoryProposals,
  type ActivityKind,
  type ProposedDecision,
  type ProposedProfile,
} from "../db/schema.ts";
import { DomainError, localDate, type Activity, type Domain } from "../domain/domain.ts";
import type { Settings } from "../settings/settings.ts";
import { assembleBriefing } from "./briefing.ts";

/** Activities whose completion ends the Agent session after a review (ADR-0002). */
export const boundaryActivities: readonly ActivityKind[] = ["onboarding", "research", "practice_set", "mock_interview"];

/** Share of the agent's context window after which the session rotates as a safeguard. */
export const rotationUsageRatio = 0.75;

/** Reasons the app ends a Chat Agent session, as stored in `agent_sessions.ended_reason`. */
export const rotationReasons = {
  /** The Interviewer called end_session after the review. */
  reviewed: "session_ended",
  newDay: "new_day",
  usage: "usage_threshold",
  boundary: (kind: ActivityKind) => `activity:${kind}`,
} as const;

export interface EndSessionInput {
  summary: string;
  observations?: string[];
  profile?: ProposedProfile;
  decisions?: ProposedDecision[];
}

export interface ContinuityOptions {
  db: Database;
  domain: Domain;
  settings: Settings;
  /** Read lazily: the Chat is built with this policy. */
  chat: () => Chat;
  now: () => Date;
}

export class Continuity implements SessionPolicy {
  readonly #db: Database;
  readonly #domain: Domain;
  readonly #settings: Settings;
  readonly #chat: () => Chat;
  readonly #now: () => Date;

  constructor(options: ContinuityOptions) {
    this.#db = options.db;
    this.#domain = options.domain;
    this.#settings = options.settings;
    this.#chat = options.chat;
    this.#now = options.now;
    this.#domain.onActivityCompleted((activity) => this.#boundary(activity));
  }

  // Session policy

  /**
   * An Activity boundary rotates the session once the review is over; a new day and the usage
   * threshold rotate it even mid-review, since the Briefing and the skill carry the Activity on.
   */
  rotationReason(session: AgentSessionRow): string | null {
    if (session.rotateReason === rotationReasons.reviewed) return session.rotateReason;
    if (localDate(session.startedAt) < localDate(this.#now())) return rotationReasons.newDay;
    if (session.usedTokens !== null && session.contextSize && session.usedTokens / session.contextSize >= rotationUsageRatio) {
      return rotationReasons.usage;
    }
    if (session.rotateReason && this.#domain.currentActivity()?.kind !== "review") return session.rotateReason;
    return null;
  }

  /** Keeps a summary of every ended session: the Interviewer's, or one composed from its Activities. */
  ended(sessionId: string, reason: string): void {
    const row = this.#db.select().from(agentSessions).where(eq(agentSessions.id, sessionId)).get();
    if (!row || row.summary) return;
    const ran = this.#db
      .select()
      .from(activities)
      .where(gte(activities.startedAt, row.startedAt))
      .orderBy(asc(activities.startedAt))
      .all()
      .map((a) => `${a.kind} (${a.status})${a.summary ? `: ${a.summary}` : ""}`);
    const summary = `The app ended the session (${reason}) without an Interviewer summary. ${ran.length ? `Activities: ${ran.join("; ")}.` : "No Activity ran."}`;
    this.#db.update(agentSessions).set({ summary }).where(eq(agentSessions.id, sessionId)).run();
  }

  // Briefing

  /** The Briefing for a Chat Agent session that has not received one yet. */
  briefing(sessionId: string): string | null {
    const row = this.#db.select({ briefedAt: agentSessions.briefedAt }).from(agentSessions).where(eq(agentSessions.id, sessionId)).get();
    if (!row || row.briefedAt) return null;
    // The very first session has nothing to continue from.
    const earlier = this.#db
      .select({ id: agentSessions.id })
      .from(agentSessions)
      .where(and(eq(agentSessions.role, "chat"), ne(agentSessions.id, sessionId)))
      .get();
    if (!earlier) return null;
    return assembleBriefing(this.#db, this.#domain, sessionId);
  }

  briefed(sessionId: string): void {
    this.#db.update(agentSessions).set({ briefedAt: this.#now() }).where(and(eq(agentSessions.id, sessionId), isNull(agentSessions.briefedAt))).run();
  }

  // End of session and memory

  /**
   * The Interviewer's end-session call: stores the summary, completes the review, and rotates the
   * session before the next turn. Proposed profile and Decision log updates wait in the Chat for
   * the Candidate's confirmation; nothing is saved here.
   */
  endSession(input: EndSessionInput): { sessionId: string; proposalId: string | null } {
    const session = this.#liveSession();
    if (!session) throw new DomainError("No Chat Agent session is running.", "Call end_session only from the Chat.");
    const summary = [input.summary, ...(input.observations?.length ? [`Observations: ${input.observations.join("; ")}`] : [])].join("\n");
    this.#db.update(agentSessions).set({ summary, rotateReason: rotationReasons.reviewed }).where(eq(agentSessions.id, session.id)).run();
    const current = this.#domain.currentActivity();
    if (current?.kind === "review") this.#domain.completeActivity(current.id, input.summary);
    const profile = input.profile && Object.keys(input.profile).length ? input.profile : null;
    const decisions = input.decisions ?? [];
    if (!profile && !decisions.length) return { sessionId: session.id, proposalId: null };
    const proposalId = crypto.randomUUID();
    this.#db
      .insert(memoryProposals)
      .values({ id: proposalId, agentSessionId: session.id, targetId: this.#domain.activeTargetId(), profile, decisions, status: "pending", createdAt: this.#now() })
      .run();
    this.#chat().post("Предлагаю запомнить по итогам:", { proposalId });
    return { sessionId: session.id, proposalId };
  }

  proposal(proposalId: string): MemoryProposalView | undefined {
    const row = this.#db.select().from(memoryProposals).where(eq(memoryProposals.id, proposalId)).get();
    return row && { id: row.id, status: row.status, items: describeProposal(row.profile, row.decisions) };
  }

  /** The Candidate confirmed: the profile and Decision log updates are saved. */
  acceptProposal(proposalId: string): MemoryProposalView {
    const row = this.#pendingProposal(proposalId);
    const p = row.profile;
    if (p) {
      this.#domain.saveProfile({
        ...(p.experience !== undefined && { experience: p.experience }),
        ...(p.stack && { stack: p.stack }),
        ...(p.strengths && { strengths: p.strengths }),
        ...(p.weakSpots && { weakSpots: p.weakSpots }),
        ...(p.preferences !== undefined && { preferences: p.preferences }),
      });
    }
    for (const d of row.decisions) this.#domain.recordDecision({ decision: d.decision, reason: d.reason, targetId: row.targetId });
    return this.#settle(proposalId, "accepted");
  }

  declineProposal(proposalId: string): MemoryProposalView {
    this.#pendingProposal(proposalId);
    return this.#settle(proposalId, "declined");
  }

  // Internals

  /**
   * An Activity boundary: the session will rotate, and when nothing else runs the app starts the
   * review Activity and asks the Interviewer for the review in a turn of its own.
   */
  #boundary(activity: Activity): void {
    if (!boundaryActivities.includes(activity.kind)) return;
    this.#db
      .update(agentSessions)
      .set({ rotateReason: rotationReasons.boundary(activity.kind) })
      .where(and(eq(agentSessions.role, "chat"), isNull(agentSessions.endedAt), isNull(agentSessions.rotateReason)))
      .run();
    if (!this.#settings.agentSettings().agent || this.#domain.currentActivity()) return;
    this.#domain.startActivity("review", { targetId: activity.targetId });
    // After the caller finished its change, such as posting the grading summary.
    queueMicrotask(() => this.#chat().prompt(reviewRequest(activity)));
  }

  #liveSession(): AgentSessionRow | undefined {
    return this.#db
      .select()
      .from(agentSessions)
      .where(and(eq(agentSessions.role, "chat"), isNull(agentSessions.endedAt)))
      .orderBy(desc(agentSessions.startedAt))
      .get();
  }

  #pendingProposal(proposalId: string) {
    const row = this.#db.select().from(memoryProposals).where(eq(memoryProposals.id, proposalId)).get();
    if (!row) {
      throw new DomainError(`No memory proposal "${proposalId}".`, "Use a proposal from the Chat.", {
        kind: "not_found",
        candidateMessage: "такого предложения нет. Обновите страницу.",
      });
    }
    if (row.status !== "pending") {
      throw new DomainError("The proposal was already answered.", "Nothing to do.", { candidateMessage: "на это предложение уже есть ответ." });
    }
    return row;
  }

  #settle(proposalId: string, status: "accepted" | "declined"): MemoryProposalView {
    this.#db.update(memoryProposals).set({ status, settledAt: this.#now() }).where(eq(memoryProposals.id, proposalId)).run();
    const message = this.#db.select({ id: chatMessages.id }).from(chatMessages).where(eq(chatMessages.proposalId, proposalId)).get();
    if (message) this.#chat().refresh(message.id);
    const view = this.proposal(proposalId);
    if (!view) throw new Error("Memory proposal vanished right after it was answered.");
    return view;
  }
}

/** What the agent receives in the app-started review turn; the Candidate never sees it. */
function reviewRequest(activity: Activity): string {
  const data = {
    ended_activity: activity.kind,
    summary: activity.summary,
    note: "The Activity just ended and the app started the review Activity. Give the review now, following the review skill. The Candidate did not write this message; do not answer it as theirs.",
  };
  return `<app_context name="activity_ended">\n${JSON.stringify(data, null, 2)}\n</app_context>`;
}

/** One Russian line per proposed change, as the Candidate confirms them. */
function describeProposal(profile: ProposedProfile | null, decisions: ProposedDecision[]): string[] {
  const items: string[] = [];
  if (profile?.experience) items.push(`Опыт: ${profile.experience}`);
  if (profile?.stack) items.push(`Стек: ${profile.stack.join(", ") || "—"}`);
  if (profile?.strengths) items.push(`Сильные стороны: ${profile.strengths.join("; ") || "—"}`);
  if (profile?.weakSpots) items.push(`Слабые места: ${profile.weakSpots.join("; ") || "—"}`);
  if (profile?.preferences) items.push(`Предпочтения: ${profile.preferences}`);
  for (const d of decisions) items.push(`Решение: ${d.decision}${d.reason ? ` (${d.reason})` : ""}`);
  return items;
}
