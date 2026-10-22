import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { skillUri } from "@prepare-to-interview/shared";
import type { AllowedBuiltin, McpServerConfig, SessionConfig, TurnInput } from "../agent/driver.ts";
import type { ActivityKind } from "../db/schema.ts";
import type { Domain } from "../domain/domain.ts";

export const defaultContentDir = fileURLToPath(new URL("../../../../interviewer", import.meta.url));

/** Hidden state the agent receives first in every turn; the Candidate never sees it. */
export interface HiddenState {
  app: "prepare-to-interview";
  /** Current local date and time, so the Interviewer can reason about days and deadlines. */
  now: string;
  /** Language the Interviewer replies in: the active Preparation target's, Russian by default. */
  language: string;
  /** The running Activity; its skill arrives as a separate hidden block once per Agent session. */
  activity: { id: string; kind: ActivityKind } | null;
  active_target: { id: string; name: string; days_left: number | null } | null;
  has_profile: boolean;
}

export interface InterviewerOptions {
  /** Directory with `persona.md`, `skills/<activity>/SKILL.md`, and `references/`. */
  contentDir?: string;
  domain: Domain;
  /** The app's MCP servers; read lazily because the URL is known only after the server listens. */
  mcpServers: () => McpServerConfig[];
  now?: () => Date;
}

/** Activities that have a skill file in the product directory. */
const skilledActivities: readonly ActivityKind[] = ["onboarding"];

/**
 * Seam between the Chat and Interviewer orchestration: decides what each Agent session gets
 * (persona, tools, MCP servers), starts Activities the server owns, and composes each turn's
 * hidden state and the Activity's skill. Briefings and session rotation extend this class.
 */
export class Interviewer {
  readonly #persona: string;
  readonly #skills: ReadonlyMap<ActivityKind, string>;
  readonly #domain: Domain;
  readonly #mcpServers: () => McpServerConfig[];
  readonly #now: () => Date;
  /** `<agent session>:<activity>` pairs whose skill the agent already has. */
  readonly #delivered = new Set<string>();
  #lastSession: string | undefined;
  readonly allowedBuiltins: AllowedBuiltin[] = ["web_fetch", "web_search"];

  constructor(options: InterviewerOptions) {
    const dir = options.contentDir ?? defaultContentDir;
    this.#persona = fs.readFileSync(`${dir}/persona.md`, "utf8");
    this.#skills = new Map(skilledActivities.map((kind) => [kind, loadSkill(dir, kind)]));
    this.#domain = options.domain;
    this.#mcpServers = options.mcpServers;
    this.#now = options.now ?? (() => new Date());
  }

  /**
   * What the agent receives for one Candidate message in the given Agent session: the hidden
   * state and, the first time the session meets the running Activity, its skill. A Candidate
   * without any Preparation target starts in onboarding unless they skipped it before.
   */
  turnInput(text: string, agentSessionId: string): TurnInput {
    this.#lastSession = agentSessionId;
    if (!this.#domain.targets().targets.length && !this.#domain.onboardingStarted() && !this.#domain.currentActivity()) {
      this.#domain.startActivity("onboarding");
    }
    const hiddenState = this.hiddenState();
    const activity = hiddenState.activity;
    const skill = activity && this.#skills.get(activity.kind);
    const key = activity && `${agentSessionId}:${activity.id}`;
    if (!skill || !key || this.#delivered.has(key)) return { text, hiddenState };
    this.#delivered.add(key);
    return { text, hiddenState, context: [{ uri: skillUri(activity.kind), text: skill }] };
  }

  /**
   * The skill text for an Activity started by a tool call during a turn; the tool returns it to
   * the agent, so the next turn of the same Agent session does not send it again.
   */
  skillForStartedActivity(activity: { id: string; kind: ActivityKind }): string | undefined {
    const skill = this.#skills.get(activity.kind);
    if (skill && this.#lastSession) this.#delivered.add(`${this.#lastSession}:${activity.id}`);
    return skill;
  }

  sessionConfig(model: string | undefined): SessionConfig {
    return {
      persona: this.#persona,
      allowedBuiltins: this.allowedBuiltins,
      mcpServers: this.#mcpServers(),
      ...(model && { model }),
    };
  }

  hiddenState(): HiddenState {
    const { activeTarget, profile, activity } = this.#domain.overview();
    return {
      app: "prepare-to-interview",
      now: localIso(this.#now()),
      language: activeTarget?.language ?? "ru",
      activity: activity && { id: activity.id, kind: activity.kind },
      active_target: activeTarget && { id: activeTarget.id, name: activeTarget.name, days_left: activeTarget.daysLeft },
      has_profile: profile !== null,
    };
  }
}

/** A skill as the agent reads it: the skill file wrapped so the Chat can strip its echoes. */
function loadSkill(dir: string, kind: ActivityKind): string {
  const body = fs.readFileSync(`${dir}/skills/${kind}/SKILL.md`, "utf8");
  return `<activity_skill name="${kind}">\n${body.trim()}\n</activity_skill>`;
}

function localIso(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  const local = new Date(date.getTime() + offset * 60_000).toISOString().slice(0, 19);
  return `${local}${sign}${pad(offset / 60)}:${pad(offset % 60)}`;
}
