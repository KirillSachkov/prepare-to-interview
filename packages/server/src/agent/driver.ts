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
  /** Re-applied after every session start and load; the agent's default when absent. */
  model?: string;
  /** Re-applied after every session start and load; the driver's safe default when absent. */
  mode?: string;
}

export interface TurnInput {
  text: string;
  /** Hidden state block sent first in the turn (ACP resource `app://session-state`); never shown in the Chat. */
  hiddenState?: unknown;
  /** Further hidden blocks after the state, such as the running Activity's skill; never shown in the Chat. */
  context?: { uri: string; text: string }[];
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
      /** Server and tool resolved from the agent-specific name (`mcp__x__y`, `mcp.x.y`, `x_y`). */
      server?: string;
      tool?: string;
      rawInput?: unknown;
    }
  | {
      type: "tool_call_update";
      toolCallId: string;
      /** Absent when the update does not change the status. */
      status?: ToolCallStatus;
      title?: string;
      server?: string;
      tool?: string;
      /** Some agents send the arguments only here, not in the first `tool_call`. */
      rawInput?: unknown;
      rawOutput?: unknown;
    }
  | { type: "usage"; used: number; size: number }
  | { type: "session_info"; title?: string };

export type StopReason = "end_turn" | "cancelled" | "max_tokens" | "max_turn_requests" | "refusal";

export interface TurnResult {
  stopReason: StopReason;
}

export interface AgentSession {
  /** The agent's own session id, kept to load the session later. */
  readonly id: string;
  /** Runs one turn, streaming events to `onEvent` until the turn stops. */
  prompt(input: TurnInput, onEvent: (event: AgentEvent) => void): Promise<TurnResult>;
  /** Asks the agent to stop the running turn; `prompt` then resolves with `cancelled`. */
  cancel(): Promise<void>;
  close(): Promise<void>;
}

export interface AgentDriver {
  /** Agent identifier, such as `claude`, `codex`, `opencode`, or `fake`. */
  readonly agent: string;
  startSession(config: SessionConfig): Promise<AgentSession>;
  /** Resumes an earlier session by id, for example after an app restart; replayed history is dropped. */
  loadSession(id: string, config: SessionConfig): Promise<AgentSession>;
  /** Stops every agent process the driver started. */
  dispose(): Promise<void>;
}
