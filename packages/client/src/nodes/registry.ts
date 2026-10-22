import { chatNodeType } from "./chat.tsx";
import { demoNoteType } from "./demo-note.tsx";
import type { NodeTypeRegistry } from "./types.ts";

/** Every Canvas node kind and how the shell renders it. Add a kind here when the contract gains one. */
export const nodeTypeRegistry: NodeTypeRegistry = {
  chat: chatNodeType,
  demo_note: demoNoteType,
};
