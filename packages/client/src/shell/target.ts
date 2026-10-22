// Preparation targets for the Control panel: the chip, the switcher, and «Новая цель». The server
// computes every number (days left, readiness, Due); the client only shows them.
import { useCallback, useEffect, useState } from "react";
import {
  apiPaths,
  type AddQuestionRequest,
  type AddQuestionResponse,
  type SwitchTargetRequest,
  type TargetsResponse,
  type TargetSummary,
  type TopicsResponse,
} from "@prepare-to-interview/shared";
import { request, subscribeToEvents } from "../api.ts";

export type { TargetSummary };

export interface TargetsView {
  active?: TargetSummary;
  all: TargetSummary[];
  switchTo: (id: string) => void;
  /** A failed switch, in Russian. */
  error?: string;
}

export const fetchTargets = () => request<TargetsResponse>(apiPaths.targets);
export const switchTarget = (targetId: string) =>
  request<TargetsResponse>(apiPaths.activeTarget, { method: "PUT", body: { targetId } satisfies SwitchTargetRequest });
/** Starts onboarding for a new Preparation target; the request appears in the Chat. */
export const startNewTarget = () => request<unknown>(apiPaths.newTarget, { method: "POST" });
export const fetchTopics = () => request<TopicsResponse>(apiPaths.topics);
export const addOwnQuestion = (question: AddQuestionRequest) =>
  request<AddQuestionResponse>(apiPaths.questions, { method: "POST", body: question });

/** The Preparation targets as stored on the server, kept live over the event channel. */
export function useTargets(): TargetsView {
  const [targets, setTargets] = useState<TargetsResponse>({ activeId: null, targets: [] });
  const [error, setError] = useState<string>();

  useEffect(
    () =>
      subscribeToEvents({
        onOpen: () => {
          fetchTargets()
            .then(setTargets)
            .catch(() => undefined);
        },
        onEvent: (event) => {
          if (event.type === "targets.changed") setTargets(event.targets);
        },
        onDisconnect: () => undefined,
      }),
    [],
  );

  const switchTo = useCallback((id: string) => {
    setError(undefined);
    switchTarget(id)
      .then(setTargets)
      .catch((e: unknown) => setError(`Не удалось переключить цель: ${e instanceof Error ? e.message : String(e)}`));
  }, []);

  const active = targets.targets.find((t) => t.id === targets.activeId);
  return { ...(active && { active }), all: targets.targets, switchTo, ...(error && { error }) };
}
