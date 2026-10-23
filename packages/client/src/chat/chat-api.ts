import {
  apiPaths,
  agentPaths,
  type AgentId,
  type AgentModelsResponse,
  type AgentSettings,
  type AgentSettingsUpdate,
  type AgentsResponse,
  type ChatSnapshot,
  proposalPaths,
  type ReviewProposalView,
} from "@prepare-to-interview/shared";
import { request } from "../api.ts";

export const fetchChat = () => request<ChatSnapshot>(apiPaths.chat);
export const sendChatMessage = (text: string) => request<unknown>(apiPaths.chatMessages, { method: "POST", body: { text } });
export const stopReply = () => request<undefined>(apiPaths.chatStop, { method: "POST" });
export const fetchAgents = () => request<AgentsResponse>(apiPaths.agents);
export const fetchAgentModels = (agent: AgentId) => request<AgentModelsResponse>(agentPaths.models(agent));
export const updateAgentSettings = (update: AgentSettingsUpdate) =>
  request<AgentSettings>(apiPaths.agentSettings, { method: "PUT", body: update });

/** The Candidate's answer to the profile and Decision log updates the Interviewer proposed in a review. */
export const answerProposal = (proposalId: string, accept: boolean) =>
  request<ReviewProposalView>(accept ? proposalPaths.accept(proposalId) : proposalPaths.decline(proposalId), { method: "POST" });
