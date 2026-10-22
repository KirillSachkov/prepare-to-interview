// Card drafts: the Candidate's edits live in a module-level store, so they outlive a Card that
// React Flow unmounts (culling, zoom-out), and are saved to the server shortly after each change
// and when the page hides, so they survive a reload.
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { cardPaths, type CardDraft } from "@prepare-to-interview/shared";

/** Typing pauses this long before the draft is saved. */
const saveDelayMs = 400;

interface LocalDraft {
  draft: CardDraft;
  /** Changes not yet saved. */
  pending?: Partial<CardDraft>;
  timer?: ReturnType<typeof setTimeout>;
  saving?: Promise<void>;
  failed?: boolean;
}

const local = new Map<string, LocalDraft>();
const listeners = new Set<() => void>();
let version = 0;

function changed(): void {
  version++;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function save(cardId: string, keepalive = false): Promise<void> {
  const entry = local.get(cardId);
  if (!entry) return;
  clearTimeout(entry.timer);
  entry.timer = undefined;
  await entry.saving;
  const body = entry.pending;
  if (!body) return;
  entry.pending = undefined;
  entry.saving = fetch(cardPaths.draft(cardId), {
    method: "PUT",
    credentials: "same-origin",
    keepalive,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
    .then((res) => {
      entry.failed = !res.ok;
      // A Card answered meanwhile refuses drafts; its server state wins.
      if (res.status === 400 || res.status === 404) local.delete(cardId);
    })
    .catch(() => {
      entry.failed = true;
      entry.pending = { ...body, ...entry.pending };
    })
    .finally(() => {
      entry.saving = undefined;
      changed();
    });
  await entry.saving;
}

/** Saves the given Cards' pending drafts now, such as before submitting a Practice set. */
export async function flushDrafts(cardIds: string[]): Promise<void> {
  await Promise.all(cardIds.map((id) => save(id)));
}

window.addEventListener("pagehide", () => {
  for (const id of local.keys()) void save(id, true);
});

/** The Card's current draft outside React, such as for a context menu: local edits win while it is open. */
export function draftOf(cardId: string, server: CardDraft, editable: boolean): CardDraft {
  return (editable && local.get(cardId)?.draft) || server;
}

/** Re-renders the caller whenever any local draft changes. */
export function useDraftChanges(): void {
  useSyncExternalStore(subscribe, () => version);
}

/**
 * The Card's draft: the Candidate's local edits while the Card is open, otherwise what the server
 * holds. `failed` tells the Card the last save did not go through.
 */
export function useCardDraft(
  cardId: string,
  server: CardDraft,
  editable: boolean,
): { draft: CardDraft; update: (change: Partial<CardDraft>) => void; failed: boolean } {
  useSyncExternalStore(subscribe, () => version);
  const entry = editable ? local.get(cardId) : undefined;

  useEffect(() => {
    // Once the Card is answered, the submitted answer comes from the server.
    if (!editable && local.has(cardId) && !local.get(cardId)?.pending) local.delete(cardId);
  }, [cardId, editable]);

  const update = useCallback(
    (change: Partial<CardDraft>) => {
      const current = local.get(cardId) ?? { draft: server };
      current.draft = { ...current.draft, ...change };
      current.pending = { ...current.pending, ...change };
      clearTimeout(current.timer);
      current.timer = setTimeout(() => void save(cardId), change.choices ? 0 : saveDelayMs);
      local.set(cardId, current);
      changed();
    },
    [cardId, server],
  );

  return { draft: entry?.draft ?? server, update, failed: entry?.failed ?? false };
}
