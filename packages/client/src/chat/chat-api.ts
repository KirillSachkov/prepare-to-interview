import {
  apiPaths,
  type AgentSettings,
  type AgentSettingsUpdate,
  type AgentsResponse,
  type ChatSnapshot,
} from "@prepare-to-interview/shared";

// The browser authenticates with the HttpOnly cookie set when the tokenized URL was opened.

async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? "GET",
    credentials: "same-origin",
    ...(init.body !== undefined && { headers: { "Content-Type": "application/json" }, body: JSON.stringify(init.body) }),
  });
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) {
    const message = (body as { error?: string } | undefined)?.error;
    throw new Error(message ?? `Request failed: ${res.status}`);
  }
  return body as T;
}

export const fetchChat = () => request<ChatSnapshot>(apiPaths.chat);
export const sendChatMessage = (text: string) => request<unknown>(apiPaths.chatMessages, { method: "POST", body: { text } });
export const stopReply = () => request<undefined>(apiPaths.chatStop, { method: "POST" });
export const fetchAgents = () => request<AgentsResponse>(apiPaths.agents);
export const updateAgentSettings = (update: AgentSettingsUpdate) =>
  request<AgentSettings>(apiPaths.agentSettings, { method: "PUT", body: update });
