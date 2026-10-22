import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { AllowedBuiltin, McpServerConfig, SessionConfig } from "../agent/driver.ts";

export const defaultContentDir = fileURLToPath(new URL("../../../../interviewer", import.meta.url));

/** Hidden state the agent receives first in every turn; the Candidate never sees it. */
export interface HiddenState {
  app: "prepare-to-interview";
  /** Current local date and time, so the Interviewer can reason about days and deadlines. */
  now: string;
  /** Language the Interviewer replies in. */
  language: string;
}

export interface InterviewerOptions {
  /** Directory with `persona.md` and, later, skills and references. */
  contentDir?: string;
  /** The app's MCP servers; read lazily because the URL is known only after the server listens. */
  mcpServers: () => McpServerConfig[];
  now?: () => Date;
}

/**
 * Seam between the Chat and Interviewer orchestration: decides what each Agent session gets
 * (persona, tools, MCP servers) and what hidden state goes with each turn. Activities, skills,
 * Briefings, and session rotation extend this class.
 */
export class Interviewer {
  readonly #persona: string;
  readonly #mcpServers: () => McpServerConfig[];
  readonly #now: () => Date;
  readonly allowedBuiltins: AllowedBuiltin[] = ["web_fetch", "web_search"];

  constructor(options: InterviewerOptions) {
    this.#persona = fs.readFileSync(`${options.contentDir ?? defaultContentDir}/persona.md`, "utf8");
    this.#mcpServers = options.mcpServers;
    this.#now = options.now ?? (() => new Date());
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
    return { app: "prepare-to-interview", now: localIso(this.#now()), language: "ru" };
  }
}

function localIso(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  const local = new Date(date.getTime() + offset * 60_000).toISOString().slice(0, 19);
  return `${local}${sign}${pad(offset / 60)}:${pad(offset % 60)}`;
}
