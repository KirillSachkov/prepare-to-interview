import type { ServerEvent } from "@prepare-to-interview/shared";

export type EventListener = (event: ServerEvent) => void;

/** In-process fan-out of domain changes to live clients. */
export class EventBus {
  readonly #listeners = new Set<EventListener>();

  subscribe(listener: EventListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  publish(event: ServerEvent): void {
    for (const listener of this.#listeners) listener(event);
  }
}
