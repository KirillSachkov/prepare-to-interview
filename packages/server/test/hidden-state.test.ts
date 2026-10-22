import { describe, expect, it } from "vitest";
import { stripHiddenState } from "@prepare-to-interview/shared";

// Echo formats observed when each agent replays a turn on session/load (prototype/acp-spike FINDINGS.md).
describe("hidden state echoes", () => {
  it.each([
    ["Claude", 'app://session-state\n<context ref="app://session-state">\n<session_state>{"q":4}</session_state>\n</context>My answer'],
    ["Codex", 'app://session-state\n<context ref="app://session-state"><session_state>{"q":4}</session_state></context>\nMy answer'],
    ["OpenCode", '[app://session-state]\n<session_state>{"q":4}</session_state>\nMy answer'],
    ["text fallback", '<session_state>{"q":4}</session_state>My answer'],
  ])("strips the %s format", (_agent, text) => {
    expect(stripHiddenState(text)).toBe("My answer");
  });

  it("leaves ordinary text, including its spacing, untouched", () => {
    expect(stripHiddenState("  indented code\n")).toBe("  indented code\n");
  });
});
