import {
  apiPaths,
  type AgentSettings,
  type AgentSettingsUpdate,
  type AgentsResponse,
  type ChatSnapshot,
} from "@prepare-to-interview/shared";
import { request } from "../api.ts";

export const fetchChat = () => request<ChatSnapshot>(apiPaths.chat);
export const sendChatMessage = (text: string) => request<unknown>(apiPaths.chatMessages, { method: "POST", body: { text } });
export const stopReply = () => request<undefined>(apiPaths.chatStop, { method: "POST" });
export const fetchAgents = () => request<AgentsResponse>(apiPaths.agents);
export const updateAgentSettings = (update: AgentSettingsUpdate) =>
  request<AgentSettings>(apiPaths.agentSettings, { method: "PUT", body: update });
