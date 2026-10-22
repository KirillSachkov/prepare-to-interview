// MCP tools of continuity (ADR-0002): ending the Agent session after a review with proposed Candidate profile and
// Decision log updates, and correcting a disputed grade.
import { z } from "zod";
import { masteryPercent } from "../domain/arithmetic.ts";
import { DomainError, type Domain } from "../domain/domain.ts";
import type { Practice } from "../domain/practice.ts";
import type { Continuity } from "../interviewer/continuity.ts";
import { defineTool, shortText, type ToolContext, type ToolDefinition } from "./tool.ts";

/**
 * During a review, profile and Decision log changes are only proposed (end_session) and the Candidate confirms them
 * in the Chat; direct saves are refused so nothing is stored without that confirmation.
 */
export function refuseDuringReview(domain: Domain, context: ToolContext): void {
  if (!context.fromChat || domain.currentActivity()?.kind !== "review") return;
  throw new DomainError(
    "During a review, Candidate profile and Decision log updates are proposed, not saved directly.",
    'Pass them to end_session as "profile" and "decisions"; the app asks the Candidate to confirm and saves them.',
  );
}

export function continuityTools({ domain, practice, continuity }: { domain: Domain; practice: Practice; continuity: Continuity }): ToolDefinition[] {
  return [
    defineTool({
      name: "end_session",
      title: "End the Agent session with a summary",
      description:
        "Call once at the end of a review: record what happened in this Agent session and propose Candidate profile and Decision log updates. The app shows the proposals to the Candidate, saves them only when they confirm, and continues the Chat in a fresh Agent session from a Briefing. The Candidate sees one continuous Chat.",
      input: z.strictObject({
        summary: shortText(2000).describe("What happened and where the Candidate stands, in 2-4 sentences, for the next Agent session."),
        observations: z.array(shortText(300)).max(10).optional().describe("Facts worth remembering, such as a recurring gap."),
        profile: z
          .strictObject({
            experience: shortText(2000).optional(),
            stack: z.array(shortText(80)).max(50).optional(),
            strengths: z.array(shortText(200)).max(30).optional().describe("The full new list; it replaces the stored one."),
            weak_spots: z.array(shortText(200)).max(30).optional().describe("The full new list; it replaces the stored one."),
            preferences: shortText(2000).optional(),
          })
          .optional()
          .describe("Proposed Candidate profile changes; only the fields to change."),
        decisions: z
          .array(z.strictObject({ decision: shortText(500), reason: shortText(1000).nullish() }))
          .max(10)
          .optional()
          .describe("Proposed Decision log entries for the active Preparation target."),
      }),
      output: z.strictObject({ session_id: z.string(), proposal_id: z.string().nullable() }),
      fixHint: 'Pass {"summary": "...", "observations": ["..."], "profile": {"weak_spots": ["..."]}, "decisions": [{"decision": "...", "reason": "..."}]}; only "summary" is required.',
      run: (input, context) => {
        if (!context.fromChat) throw new DomainError("Only the Chat's Agent session can end itself.", "Call end_session from the Chat, during your reply.");
        const result = continuity.endSession({
          summary: input.summary,
          ...(input.observations && { observations: input.observations }),
          ...(input.profile && {
            profile: {
              ...(input.profile.experience !== undefined && { experience: input.profile.experience }),
              ...(input.profile.stack && { stack: input.profile.stack }),
              ...(input.profile.strengths && { strengths: input.profile.strengths }),
              ...(input.profile.weak_spots && { weakSpots: input.profile.weak_spots }),
              ...(input.profile.preferences !== undefined && { preferences: input.profile.preferences }),
            },
          }),
          ...(input.decisions && { decisions: input.decisions.map((d) => ({ decision: d.decision, reason: d.reason ?? null })) }),
        });
        return { session_id: result.sessionId, proposal_id: result.proposalId };
      },
      summarize: (o) =>
        `Recorded the session summary.${o.proposal_id ? " The Candidate sees your proposed profile and Decision log updates with buttons to save or drop them; do not save them yourself." : ""} The next turn continues in a fresh Agent session.`,
    }),

    defineTool({
      name: "correct_grade",
      title: "Correct a disputed grade",
      description:
        "Correct the grade of a Card's Attempt that counts (its first answer; retries after feedback do not count) after the Candidate disputed it and you agree, judged against the Reference answer and the Rubric: quote what the Grader missed in the reason. Only open answers graded by the Grader; the Hint ladder cap still applies. The app updates the Card, the Leitner schedule, and Mastery.",
      input: z.strictObject({
        card_id: z.string().min(1).describe("The Card from the discussed Card context."),
        score: z.number().int().min(0).max(3).describe("The corrected Rubric score."),
        reason: shortText(1000).describe("Why the grade changes, quoting the answer."),
        gap: shortText(1000).optional().describe("The updated single most important gap."),
        right: shortText(1000).optional().describe("The updated note on what was right, as the Grader's \"right\" field."),
      }),
      output: z.strictObject({
        card_id: z.string(),
        topic: z.string(),
        previous_score: z.number(),
        score: z.number(),
        max_score: z.number(),
        topic_mastery: z.number().nullable().describe("0-100 after the correction, for the active Preparation target."),
      }),
      fixHint: 'Pass {"card_id": "<from the discussed Card>", "score": 0-3, "reason": "<why, quoting the answer>"}.',
      run: (input) => {
        const result = practice.correctGrade(input.card_id, {
          score: input.score,
          reason: input.reason,
          ...(input.gap !== undefined && { gap: input.gap }),
          ...(input.right !== undefined && { strengths: input.right }),
        });
        const targetId = domain.activeTargetId();
        const topic = targetId ? domain.progress.forTarget(targetId).topics.find((t) => t.name === result.topic) : undefined;
        return {
          card_id: result.cardId,
          topic: result.topic,
          previous_score: result.previous,
          score: result.score,
          max_score: result.maxScore,
          topic_mastery: masteryPercent(topic?.mastery ?? null),
        };
      },
      summarize: (o) =>
        `Corrected the grade from ${o.previous_score} to ${o.score} of ${o.max_score}. Topic "${o.topic}" Mastery is now ${o.topic_mastery === null ? "not computed" : `${o.topic_mastery}%`}.`,
    }),
  ];
}
