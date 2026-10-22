// REST calls of the practice loop: Card actions, submit, and practice requests. The server owns
// every grade and number; the client only sends the Candidate's actions.
import {
  apiPaths,
  cardPaths,
  practiceSetPaths,
  type PracticeRequest,
  type PracticeSetNode,
  type ProgressResponse,
  type RevealMode,
  type RevealRequest,
} from "@prepare-to-interview/shared";
import { request } from "../api.ts";
import { flushDrafts } from "./drafts.ts";

export type CardAction = "hint" | "skip" | "check" | "retry";

/** Runs a Card action; the updated Practice set also arrives over the event channel. */
export async function cardAction(cardId: string, action: CardAction): Promise<PracticeSetNode> {
  if (action === "check") await flushDrafts([cardId]);
  return request<PracticeSetNode>(cardPaths[action](cardId), { method: "POST" });
}

/** Brings the Card into the Chat with its question, answer, and grade. */
export async function discussCard(cardId: string): Promise<void> {
  await flushDrafts([cardId]);
  await request<unknown>(cardPaths.discuss(cardId), { method: "POST" });
}

/** Saves the set's pending drafts, then submits the whole Practice set. */
export async function submitPracticeSet(set: PracticeSetNode): Promise<PracticeSetNode> {
  await flushDrafts(set.data.cards.map((c) => c.id));
  return request<PracticeSetNode>(practiceSetPaths.submit(set.id), { method: "POST" });
}

export const setReveal = (setId: string, reveal: RevealMode) =>
  request<PracticeSetNode>(practiceSetPaths.reveal(setId), { method: "PUT", body: { reveal } satisfies RevealRequest });

/** Asks the Interviewer for a Practice set or a Quiz; the request appears in the Chat. */
export const requestPractice = (body: PracticeRequest) => request<unknown>(apiPaths.practiceRequest, { method: "POST", body });

export const fetchProgress = () => request<ProgressResponse>(apiPaths.progress);
