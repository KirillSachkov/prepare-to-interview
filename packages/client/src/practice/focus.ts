// Bringing a Card into view from elsewhere in the UI, such as a Card chip in the Chat.

/** Window event whose `detail` is the Card id; the Canvas shell fits its Practice set into view. */
export const focusCardEvent = "pti:focus-card";

export function focusCard(cardId: string): void {
  window.dispatchEvent(new CustomEvent(focusCardEvent, { detail: cardId }));
}
