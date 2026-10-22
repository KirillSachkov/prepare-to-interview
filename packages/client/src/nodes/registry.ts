import { chatNodeType } from "./chat.tsx";
import { withMockInterviews } from "./mock-interview.tsx";
import { practiceSetType } from "./practice-set.tsx";
import type { NodeTypeRegistry } from "./types.ts";

/** Every Canvas node kind and how the shell renders it. Add a kind here when the contract gains one. */
export const nodeTypeRegistry: NodeTypeRegistry = {
  chat: chatNodeType,
  practice_set: withMockInterviews(practiceSetType),
};
