// History of graded Practice sets that left the Canvas (ADR-0004 auto-tidy), and the Candidate's
// answer to the memory updates the Interviewer proposed in a review.
import { apiPaths, proposalPaths, type HistoryResponse, type MemoryProposalView } from "@prepare-to-interview/shared";
import { request } from "../api.ts";

export const fetchHistory = () => request<HistoryResponse>(apiPaths.history);

export const answerProposal = (proposalId: string, accept: boolean) =>
  request<MemoryProposalView>(accept ? proposalPaths.accept(proposalId) : proposalPaths.decline(proposalId), { method: "POST" });
