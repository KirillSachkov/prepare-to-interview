import { agentLabels, type AgentId } from "@prepare-to-interview/shared";

/**
 * Why an agent could not serve a turn, in terms the Candidate can act on:
 * - `not_installed`: the agent's command is missing;
 * - `not_logged_in`: the agent needs its own login (the app never asks for API keys);
 * - `limit_reached`: the subscription or provider limits are used up;
 * - `failed`: anything else, such as a crash or a protocol error.
 */
export type AgentErrorKind = "not_installed" | "not_logged_in" | "limit_reached" | "failed";

export class AgentError extends Error {
  readonly kind: AgentErrorKind;

  constructor(kind: AgentErrorKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AgentError";
    this.kind = kind;
  }
}

/** JSON-RPC code ACP uses for "Authentication required". */
const authRequiredCode = -32000;

const limitKinds = new Set(["rate_limit", "billing_error", "account_on_hold", "quota_exhausted", "usage_limit"]);
const authKinds = new Set(["authentication_failed", "oauth_org_not_allowed", "auth_required"]);

/** Maps whatever an agent or its adapter threw onto an AgentError. */
export function toAgentError(error: unknown): AgentError {
  if (error instanceof AgentError) return error;
  const { code, message, data } = errorParts(error);
  const errorKind = typeof data?.errorKind === "string" ? data.errorKind : undefined;
  const text = `${message} ${errorKind ?? ""}`;
  if (code === "ENOENT") return new AgentError("not_installed", message, { cause: error });
  if (code === authRequiredCode || (errorKind && authKinds.has(errorKind))) {
    return new AgentError("not_logged_in", message, { cause: error });
  }
  if ((errorKind && limitKinds.has(errorKind)) || /usage limit|rate.?limit|quota|limit reached|too many requests|\b429\b/i.test(text)) {
    return new AgentError("limit_reached", message, { cause: error });
  }
  if (/not logged in|log ?in required|authentication required|unauthori[sz]ed|\b401\b|sign in/i.test(text)) {
    return new AgentError("not_logged_in", message, { cause: error });
  }
  return new AgentError("failed", message, { cause: error });
}

const loginHints: Record<AgentId, string> = {
  claude: "run `claude` in a terminal and log in with `/login`",
  codex: "run `codex login` in a terminal",
  opencode: "run `opencode auth login` in a terminal and configure a provider",
};

const installHints: Record<AgentId, string> = {
  claude: "install Claude Code (https://claude.com/claude-code)",
  codex: "install Codex (`npm install -g @openai/codex`)",
  opencode: "install OpenCode (https://opencode.ai)",
};

/** Plain-language text the Chat shows for an agent error. */
export function describeAgentError(agent: AgentId, error: AgentError): string {
  const label = agentLabels[agent];
  switch (error.kind) {
    case "not_installed":
      return `${label} is not installed. To use it, ${installHints[agent]}, or pick another agent in settings.`;
    case "not_logged_in":
      return `${label} is not logged in. To log in, ${loginHints[agent]}, then send your message again.`;
    case "limit_reached":
      return `${label} has reached its usage limit. Wait until the limit resets, or switch to another agent in settings.`;
    case "failed":
      return `${label} stopped with an error: ${error.message || "no details"}. Send your message again, or switch the agent in settings.`;
  }
}

export function installHint(agent: AgentId): string {
  return `Not found. To use it, ${installHints[agent]}.`;
}

function errorParts(error: unknown): { code: unknown; message: string; data: Record<string, unknown> | undefined } {
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const data = record.data && typeof record.data === "object" ? (record.data as Record<string, unknown>) : undefined;
    return { code: record.code, message: typeof record.message === "string" ? record.message : "unknown error", data };
  }
  return { code: undefined, message: String(error), data: undefined };
}
