// Keyboard shortcut descriptions shared by the dispatcher, the toolbar hints, and the shortcuts dialog.

export const isMac = navigator.platform.toLowerCase().includes("mac");
/** How the platform's command modifier reads in hints: ⌘ on macOS, Ctrl elsewhere. */
export const modLabel = isMac ? "⌘" : "Ctrl";

export interface Hotkey {
  /** How the shortcut reads in hints and the shortcuts dialog. */
  label: string;
  /** Physical key (`KeyboardEvent.code`); layout-independent, so letters work in any input language. */
  code?: string;
  /**
   * Produced characters (`KeyboardEvent.key`) for symbols whose physical key varies, such as `?` or `+`.
   * With both `code` and `key`, either matches: `?` also works on layouts where Shift+/ types another character.
   */
  key?: readonly string[];
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
}

/** A bare letter key such as V; it never fires with modifiers held. */
export function letter(char: string): Hotkey {
  return { label: char, code: `Key${char}` };
}

export function matchesHotkey(event: KeyboardEvent, hotkey: Hotkey): boolean {
  const mod = event.metaKey || event.ctrlKey;
  if (Boolean(hotkey.mod) !== mod || Boolean(hotkey.alt) !== event.altKey) return false;
  // Shift is part of a physical-key shortcut; for a character such as `?` it only produces the character.
  const byCode = hotkey.code !== undefined && Boolean(hotkey.shift) === event.shiftKey && event.code === hotkey.code;
  return byCode || (hotkey.key?.includes(event.key) ?? false);
}

/** Typing into a field never triggers shortcuts. */
export function isTyping(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  return element.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName);
}
