// REST calls of the Mock interview. The server owns its flow and timer; the client sends the
// Candidate's answers and the request to end it.
import { apiPaths, mockPaths, type MockRequest, type PracticeSetNode } from "@prepare-to-interview/shared";
import { request } from "../api.ts";
import { flushDrafts } from "./drafts.ts";

/** Starts a Mock interview; the request appears in the Chat and the Interviewer places the first Card. */
export const requestMock = (body: MockRequest) => request<unknown>(apiPaths.mockRequest, { method: "POST", body });

/** Saves the Card's draft, then gives it as the answer; the Interviewer reacts in the Chat. */
export async function answerMockCard(cardId: string): Promise<PracticeSetNode> {
  await flushDrafts([cardId]);
  return request<PracticeSetNode>(mockPaths.answer(cardId), { method: "POST" });
}

/** Saves pending drafts and ends the Mock interview; the Grader then grades every answer. */
export async function finishMock(set: PracticeSetNode): Promise<PracticeSetNode> {
  await flushDrafts(set.data.cards.map((c) => c.id));
  return request<PracticeSetNode>(mockPaths.finish(set.id), { method: "POST" });
}
