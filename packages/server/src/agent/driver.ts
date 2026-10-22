// One interface over every supported coding agent (ADR-0001). Real drivers translate it to ACP
// per agent; the fake driver replays scripted events for tests.

/** An MCP server an Agent session connects to; mirrors ACP's HTTP MCP server entry. */
export interface McpServerConfig {
  type: "http";
  name: string;
  url: string;
  headers: { name: string; value: string }[];
}

/** Built-in agent tools the Interviewer may keep besides the app's MCP tools. */
export type AllowedBuiltin = "web_fetch" | "web_search";

export interface SessionConfig {
  /** Interviewer persona replacing (or, where the agent forces it, appended to) the system prompt. */
  persona: string;
  allowedBuiltins: AllowedBuiltin[];
  mcpServers: McpServerConfig[];
  model?: string;
  mode?: string;
}

export interface TurnInput {
  text: string;
  /** Hidden state block sent first in the turn (ACP resource `app://session-state`); never shown in the Chat. */
  hiddenState?: unknown;
}

export type ToolCallStatus = "pending" | "in_progress" | "completed" | "failed";

/** Normalized stream events; real drivers map ACP `session/update` notifications onto these. */
export type AgentEvent =
  | { type: "message_chunk"; text: string }
  | { type: "thought_chunk"; text: string }
  | {
      type: "tool_call";
      toolCallId: string;
      title: string;
      status: ToolCallStatus;
      /** Server and tool resolved from the agent-specific title (`mcp__x__y`, `mcp.x.y`, `x_y`). */
      server?: string;
      tool?: string;
      rawInput?: unknown;
    }
  | { type: "tool_call_update"; toolCallId: string; status: ToolCallStatus; rawOutput?: unknown }
  | { type: "usage"; used: number; size: number }
  | { type: "session_info"; title?: string };

export type StopReason = "end_turn" | "cancelled" | "max_tokens" | "refusal";

export interface TurnResult {
  stopReason: StopReason;
}

export interface AgentSession {
  /** The agent's own session id, kept to load the session later. */
  readonly id: string;
  /** Runs one turn, streaming events to `onEvent` until the turn stops. */
  prompt(input: TurnInput, onEvent: (event: AgentEvent) => void): Promise<TurnResult>;
  cancel(): Promise<void>;
  close(): Promise<void>;
}

export interface AgentDriver {
  /** Agent identifier, such as `claude`, `codex`, `opencode`, or `fake`. */
  readonly agent: string;
  startSession(config: SessionConfig): Promise<AgentSession>;
}
