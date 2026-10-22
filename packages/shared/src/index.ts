// Contract between the app server and the browser client: REST paths, Canvas and Chat shapes, and
// live events pushed over the WebSocket channel.

export const apiPaths = {
  canvas: "/api/canvas",
  /** PUT a {@link LayoutUpdateRequest}: where nodes sit and whether they are collapsed. */
  canvasLayout: "/api/canvas/layout",
  events: "/api/events",
  chat: "/api/chat",
  chatMessages: "/api/chat/messages",
  chatStop: "/api/chat/stop",
  agents: "/api/agents",
  agentSettings: "/api/settings/agent",
  mcp: "/mcp",
} as const;

/** Query parameter that carries the access token in the URL printed at start. */
export const tokenQueryParam = "token";

export interface CanvasPosition {
  x: number;
  y: number;
}

/** How a node sits on the Canvas; kept in the layout store, apart from domain data. */
export interface NodeLayout {
  position: CanvasPosition;
  collapsed: boolean;
}

interface CanvasNodeBase extends NodeLayout {
  id: string;
}

/** Placeholder node kind proving the stack end to end; real Cards arrive with the domain tickets. */
export interface DemoNoteNode extends CanvasNodeBase {
  kind: "demo_note";
  data: {
    title: string;
    body: string;
  };
}

/** The single Chat node; the Canvas always has it, whether or not the Candidate shows it. */
export const chatNodeId = "chat";

export interface ChatNode extends CanvasNodeBase {
  id: typeof chatNodeId;
  kind: "chat";
  data: Record<string, never>;
}

export type CanvasNode = DemoNoteNode | ChatNode;
export type CanvasNodeKind = CanvasNode["kind"];

export interface CanvasSnapshot {
  nodes: CanvasNode[];
}

/** One node's layout change; omitted fields keep their stored value. */
export interface LayoutUpdate {
  nodeId: string;
  position?: CanvasPosition;
  collapsed?: boolean;
}

export interface LayoutUpdateRequest {
  updates: LayoutUpdate[];
}

export interface NodeLayoutEntry extends NodeLayout {
  nodeId: string;
}

// Agents and settings

export const agentIds = ["claude", "codex", "opencode"] as const;
export type AgentId = (typeof agentIds)[number];

export const agentLabels: Record<AgentId, string> = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
};

/** Whether a supported coding agent is installed on the Candidate's machine. */
export interface AgentAvailability {
  id: AgentId;
  label: string;
  installed: boolean;
  /** Where the agent's command was found, or how to install it when missing. */
  detail: string;
}

export interface AgentSettings {
  /** The agent the Interviewer runs on; `null` until the Candidate picks one. */
  agent: AgentId | null;
  /** Optional model per agent; the agent's own default when absent. */
  models: Partial<Record<AgentId, string>>;
}

export interface AgentsResponse {
  agents: AgentAvailability[];
  settings: AgentSettings;
}

export interface AgentSettingsUpdate {
  agent: AgentId;
  /** Empty or `null` returns to the agent's default model. */
  model?: string | null;
}

// Chat

/** `notice` carries app messages such as a plain-language agent error. */
export type ChatRole = "candidate" | "interviewer" | "notice";
export type ChatMessageStatus = "streaming" | "complete" | "cancelled" | "failed";

export interface ChatToolCall {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  /** App MCP server and tool when the call targets the app; absent for built-in tools. */
  server?: string;
  tool?: string;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  status: ChatMessageStatus;
  /** Milliseconds since the epoch. */
  createdAt: number;
  toolCalls: ChatToolCall[];
}

export interface ChatSnapshot {
  messages: ChatMessage[];
  /** True while the Interviewer is replying; the Candidate can stop it. */
  busy: boolean;
}

export interface ChatSendRequest {
  text: string;
}

export type ServerEvent =
  | { type: "canvas.node_added"; node: CanvasNode }
  | { type: "canvas.layout_changed"; layouts: NodeLayoutEntry[] }
  /** A message was added or changed (status, final text, tool calls). */
  | { type: "chat.message"; message: ChatMessage }
  /** Streamed text appended to a message. */
  | { type: "chat.delta"; messageId: string; text: string }
  | { type: "chat.busy"; busy: boolean }
  | { type: "agent.settings"; settings: AgentSettings };

// Hidden state

/** URI of the hidden state block sent first in every turn (ADR-0002). */
export const sessionStateUri = "app://session-state";

const hiddenStatePatterns = [
  /<context ref="app:\/\/[^"]*">[\s\S]*?<\/context>/g,
  /<session_state>[\s\S]*?<\/session_state>/g,
  /\[app:\/\/[^\]\s]*\]/g,
  /app:\/\/session-state/g,
];

/**
 * Removes echoes of the hidden state block from Chat text. Agents replay it on `session/load` in
 * their own formats: `<context ref="app://…">…</context>`, `[app://…]`, or bare
 * `<session_state>…</session_state>`.
 */
export function stripHiddenState(text: string): string {
  if (!text.includes("app://") && !text.includes("<session_state>")) return text;
  let result = text;
  for (const pattern of hiddenStatePatterns) result = result.replace(pattern, "");
  return result === text ? text : result.trimStart();
}
