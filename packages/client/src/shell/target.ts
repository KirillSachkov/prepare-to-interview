// What the top-left chip and menu show about Preparation targets. Placeholder until the targets
// ticket supplies real data; the chip and menu render whatever this hook returns.

export interface TargetSummary {
  id: string;
  name: string;
  grade?: string;
  /** Overall readiness, 0–100. */
  readiness: number;
  daysLeft?: number;
  interviewDate?: string;
  /** Questions Due for repetition. */
  due: number;
}

export interface TargetsView {
  active?: TargetSummary;
  all: TargetSummary[];
  /** Absent until switching is implemented. */
  switchTo?: (id: string) => void;
}

export function useTargets(): TargetsView {
  return { all: [] };
}
