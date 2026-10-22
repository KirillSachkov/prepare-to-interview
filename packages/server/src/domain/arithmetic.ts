// Practice arithmetic of the domain core: Hint ladder caps, test checking, Leitner scheduling,
// Mastery, and readiness. Pure functions; prompts never compute these numbers.
import type { QuestionType, TestOption, TopicPriority } from "../db/schema.ts";
import { masteryBands } from "@prepare-to-interview/shared";

export const maxScore = 3;
/** Rungs of the Hint ladder a Card offers at most. */
export const maxHintRungs = 2;

/** The highest score an Attempt can get after `hintsUsed` rungs of the Hint ladder. */
export function hintCap(hintsUsed: number): number {
  return Math.max(0, maxScore - hintsUsed);
}

export interface TestCheck {
  /** 0–3: 3 for exactly the correct options, 1 for some correct and no wrong ones, else 0. */
  score: number;
  correct: number[];
}

/** Indexes of a test's correct options. */
export function correctOptions(options: TestOption[]): number[] {
  return options.flatMap((o, i) => (o.correct ? [i] : []));
}

/** Checks a test answer against the options; the app does it, never the Grader. */
export function checkTest(type: QuestionType, options: TestOption[], chosen: number[]): TestCheck {
  const correct = correctOptions(options);
  const picked = new Set(chosen);
  const wrong = [...picked].some((i) => !options[i]?.correct);
  const hits = correct.filter((i) => picked.has(i)).length;
  let score = 0;
  if (!wrong && hits === correct.length && hits > 0) score = maxScore;
  else if (type === "multiple_choice" && !wrong && hits > 0) score = 1;
  return { score, correct };
}

/** Days until a Question in a Leitner box is Due again; box 1 is the most frequent. */
export const leitnerIntervals = [1, 3, 7, 14, 30] as const;
export const topBox = leitnerIntervals.length;

/** What an Attempt means for scheduling: a capped score, or Skipped. */
export type Outcome = { score: number } | { skipped: true };

/**
 * The next Leitner box: 3 moves the Question up one box, 2 keeps it, 0–1 and Skipped send it back
 * to box 1. A Question never practised counts as box 1.
 */
export function nextBox(current: number | undefined, outcome: Outcome): number {
  const box = current ?? 1;
  if ("skipped" in outcome || outcome.score <= 1) return 1;
  if (outcome.score >= maxScore) return Math.min(box + 1, topBox);
  return box;
}

/** The local date `YYYY-MM-DD` the Question in `box` is Due from, counted from `today`. */
export function dueOn(today: string, box: number): string {
  const days = leitnerIntervals[Math.min(Math.max(box, 1), topBox) - 1] ?? 1;
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Recent graded Attempts that count, newest first, weighted 3, 2, 1. */
const recencyWeights = [3, 2, 1] as const;

/**
 * A Question's Mastery 0–1 from its recent graded Attempt scores, newest first; `null` when it has
 * none. Skipped Attempts and retries after feedback are excluded by the caller.
 */
export function questionMastery(scoresNewestFirst: number[]): number | null {
  const recent = scoresNewestFirst.slice(0, recencyWeights.length);
  if (!recent.length) return null;
  let sum = 0;
  let weight = 0;
  recent.forEach((score, i) => {
    const w = recencyWeights[i] ?? 1;
    sum += w * (score / maxScore);
    weight += w;
  });
  return sum / weight;
}

/**
 * A Topic's Mastery 0–1: the mean Mastery of its practised Questions; without any, the calibration
 * level (0–3) from onboarding; `null` for a never-touched Topic.
 */
export function topicMastery(questionMasteries: number[], calibrationLevel: number | undefined): number | null {
  if (questionMasteries.length) return questionMasteries.reduce((a, b) => a + b, 0) / questionMasteries.length;
  if (calibrationLevel !== undefined) return calibrationLevel / maxScore;
  return null;
}

const priorityWeights: Record<TopicPriority, number> = { high: 3, medium: 2, low: 1 };

/**
 * Overall readiness 0–100 for a Preparation target: Topic Mastery weighted by priority, with
 * never-touched Topics counting as 0; `null` while no Topic has any Mastery.
 */
export function readiness(topics: { priority: TopicPriority; mastery: number | null }[]): number | null {
  if (!topics.some((t) => t.mastery !== null)) return null;
  let sum = 0;
  let weight = 0;
  for (const t of topics) {
    const w = priorityWeights[t.priority];
    sum += w * (t.mastery ?? 0);
    weight += w;
  }
  return Math.round((100 * sum) / weight);
}

/** Mastery 0–1 as a whole percentage, as tools and the Briefing report it. */
export function masteryPercent(mastery: number | null): number | null {
  return mastery === null ? null : Math.round(mastery * 100);
}

/** A Topic whose Mastery is below this is weak and needs repetition: anything short of the high band. */
export const weakMastery = masteryBands.high;

/** The local calendar date of an instant as `YYYY-MM-DD`. */
export function localDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
