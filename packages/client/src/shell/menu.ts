// Entries of the context menus and dropdowns; commands and node types both produce them.
import type { Command } from "./commands.ts";
import { comingSoonLabel } from "./ui.tsx";

export interface MenuItem {
  label: string;
  hint?: string;
  /** Absent: the entry shows disabled. */
  run?: () => void;
  disabled?: boolean;
}

export type MenuEntry = MenuItem | "separator";

/** A menu entry for a command; a command without `run` reads as "coming soon". */
export function commandEntry(command: Command, label = command.label): MenuItem {
  return command.run
    ? { label, hint: command.hotkey?.label, run: command.run }
    : { label, hint: comingSoonLabel, disabled: true };
}
