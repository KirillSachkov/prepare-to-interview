// REST calls and live data of the Skill map, the Question bank, and the Proposed queue. The server
// computes every number; the client only shows them and sends the Candidate's decisions.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  bankPaths,
  type BankQuestion,
  type BankResponse,
  type ProposedResponse,
  type ReferenceUpdate,
  type ReviewRequest,
  type ReviewResponse,
  type ServerEvent,
  type SkillMapResponse,
  type TopicDetailResponse,
} from "@prepare-to-interview/shared";
import { request, subscribeToEvents } from "../api.ts";

export const fetchSkillMap = () => request<SkillMapResponse>(bankPaths.skillMap);
export const fetchTopic = (topicId: string) => request<TopicDetailResponse>(bankPaths.topic(topicId));
export const fetchBank = () => request<BankResponse>(bankPaths.bank);
export const fetchProposed = () => request<ProposedResponse>(bankPaths.proposed);
export const review = (body: ReviewRequest) => request<ReviewResponse>(bankPaths.review, { method: "POST", body });
export const updateReference = (questionId: string, body: ReferenceUpdate) =>
  request<BankQuestion>(bankPaths.reference(questionId), { method: "PUT", body });
/** Asks the Interviewer in the Chat to run Research; the request appears in the Chat. */
export const requestResearch = () => request<unknown>(bankPaths.researchRequest, { method: "POST" });

/** Events after which Skill map data may have changed. */
const refreshOn = new Set<ServerEvent["type"]>(["bank.changed", "targets.changed"]);

/**
 * Loads data and reloads it whenever the bank, the targets, or progress change on the server, and
 * when `key` changes. `reload` refetches on demand; `error` is the Russian text of a failed load.
 */
export function useLive<T>(load: () => Promise<T>, key = ""): { data?: T; error?: string; reload: () => void } {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  const reload = useCallback(() => {
    loadRef
      .current()
      .then((value) => {
        setData(value);
        setError(undefined);
      })
      .catch((e: unknown) => setError(`Не удалось загрузить: ${e instanceof Error ? e.message : String(e)}`));
  }, []);
  // Every (re)connect loads afresh, including the first.
  useEffect(() => {
    return subscribeToEvents({
      onOpen: reload,
      onEvent: (event) => {
        if (refreshOn.has(event.type)) reload();
      },
      onDisconnect: () => undefined,
    });
  }, [reload, key]);
  return { ...(data !== undefined && { data }), ...(error && { error }), reload };
}

/** Proposed items waiting for review, for the toolbar badge; kept live over the event channel. */
export function useProposedCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const refresh = () => {
      fetchProposed()
        .then((r) => setCount(r.count))
        .catch(() => undefined);
    };
    return subscribeToEvents({
      onOpen: refresh,
      onEvent: (event) => {
        if (event.type === "bank.changed") setCount(event.proposed);
      },
      onDisconnect: () => undefined,
    });
  }, []);
  return count;
}
