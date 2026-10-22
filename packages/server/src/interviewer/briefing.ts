// The Briefing (GLOSSARY): what a fresh Agent session of the Chat starts from, assembled by the
// server so continuity never depends on what the agent retains. Bounded in size by construction.
import { and, desc, eq, isNotNull, ne } from "drizzle-orm";
import type { Database } from "../db/database.ts";
import { activities, agentSessions, chatMessages } from "../db/schema.ts";
import { masteryPercent, weakMastery } from "../domain/arithmetic.ts";
import type { Domain } from "../domain/domain.ts";
import { appContext } from "../agent/inert-json.ts";

/** Upper bound of the Briefing text the agent receives, in characters. */
export const maxBriefingChars = 6000;

const limits = {
  duePrompts: 5,
  weakTopics: 5,
  decisions: 5,
  summaries: 3,
  activities: 5,
  chat: 6,
  shortText: 160,
  summaryText: 600,
  chatText: 300,
} as const;

export interface BriefingData {
  note: string;
  active_target: {
    name: string;
    role: string;
    grade: string | null;
    days_left: number | null;
    readiness: number | null;
    mission: { why: string | null; success: string | null };
  } | null;
  due_questions: { count: number; first: string[] };
  weak_topics: { name: string; priority: string; mastery: number }[];
  profile: { experience: string | null; strengths: string[]; weak_spots: string[]; preferences: string | null } | null;
  recent_decisions: string[];
  /** Summaries of earlier Agent sessions, newest first. */
  recent_summaries: { ended: string; summary: string }[];
  /** Recently ended Activities, newest first. */
  recent_activities: { kind: string; status: string; summary: string | null }[];
  /** The last Chat messages, oldest first, so the conversation continues where it stopped. */
  recent_chat: { role: string; text: string }[];
}

/** Reads what the next Agent session needs to know and returns it as one bounded hidden block. */
export function assembleBriefing(db: Database, domain: Domain, excludeSessionId: string): string {
  const { activeTarget, profile, recentDecisions } = domain.overview();
  const progress = activeTarget ? domain.progress.forTarget(activeTarget.id) : null;
  const queue = activeTarget ? domain.progress.queue(activeTarget.id, { limit: limits.duePrompts }) : null;
  const summaries = db
    .select({ endedAt: agentSessions.endedAt, summary: agentSessions.summary })
    .from(agentSessions)
    .where(and(eq(agentSessions.role, "chat"), isNotNull(agentSessions.summary), ne(agentSessions.id, excludeSessionId)))
    .orderBy(desc(agentSessions.startedAt))
    .limit(limits.summaries)
    .all();
  const ended = db
    .select()
    .from(activities)
    .where(ne(activities.status, "active"))
    .orderBy(desc(activities.endedAt))
    .limit(limits.activities)
    .all();
  const chat = db
    .select({ role: chatMessages.role, text: chatMessages.text })
    .from(chatMessages)
    .where(ne(chatMessages.role, "notice"))
    .orderBy(desc(chatMessages.seq))
    .limit(limits.chat)
    .all()
    .reverse();

  const data: BriefingData = {
    note: "A new Agent session starts here, but the Candidate sees one continuous Chat: continue the conversation from this Briefing without greeting them anew. The numbers come from the app; read details with the tools.",
    active_target: activeTarget && {
      name: activeTarget.name,
      role: activeTarget.role,
      grade: activeTarget.grade,
      days_left: activeTarget.daysLeft,
      readiness: activeTarget.readiness,
      mission: { why: clip(activeTarget.mission.why, limits.shortText), success: clip(activeTarget.mission.success, limits.shortText) },
    },
    due_questions: { count: progress?.due ?? 0, first: (queue?.due ?? []).map((q) => `${q.topic}: ${clip(q.prompt, limits.shortText)}`) },
    weak_topics: (progress?.topics ?? [])
      .flatMap((t) => (t.mastery !== null && t.mastery < weakMastery ? [{ name: t.name, priority: t.priority, mastery: masteryPercent(t.mastery) ?? 0 }] : []))
      .sort((a, b) => a.mastery - b.mastery)
      .slice(0, limits.weakTopics),
    profile: profile && {
      experience: clip(profile.experience, limits.shortText),
      strengths: profile.strengths.slice(0, 5).map((s) => clip(s, limits.shortText) ?? ""),
      weak_spots: profile.weakSpots.slice(0, 5).map((s) => clip(s, limits.shortText) ?? ""),
      preferences: clip(profile.preferences, limits.shortText),
    },
    recent_decisions: recentDecisions.slice(0, limits.decisions).map((d) => clip(d.decision, limits.shortText) ?? ""),
    recent_summaries: summaries.map((s) => ({ ended: s.endedAt?.toISOString() ?? "", summary: clip(s.summary, limits.summaryText) ?? "" })),
    recent_activities: ended.map((a) => ({ kind: a.kind, status: a.status, summary: clip(a.summary, limits.shortText) })),
    recent_chat: chat.map((m) => ({ role: m.role, text: clip(m.text, limits.chatText) ?? "" })),
  };
  return render(fit(data));
}

/** Drops the least important entries until the Briefing fits its bound. */
function fit(data: BriefingData): BriefingData {
  const trimmable: (keyof Pick<BriefingData, "recent_chat" | "recent_activities" | "recent_decisions" | "recent_summaries" | "weak_topics">)[] = [
    "recent_chat",
    "recent_activities",
    "recent_decisions",
    "weak_topics",
    "recent_summaries",
  ];
  const copy: BriefingData = structuredClone(data);
  for (const key of trimmable) {
    while (render(copy).length > maxBriefingChars && copy[key].length) {
      // The oldest Chat messages go first; other lists are newest first, so their tail goes.
      if (key === "recent_chat") copy.recent_chat.shift();
      else copy[key].pop();
    }
  }
  return copy;
}

function render(data: BriefingData): string {
  return appContext("briefing", data, undefined);
}

function clip(text: string | null, max: number): string | null {
  if (text === null) return null;
  const tidy = text.replace(/\s+/g, " ").trim();
  return tidy.length > max ? `${tidy.slice(0, max - 1)}…` : tidy;
}
