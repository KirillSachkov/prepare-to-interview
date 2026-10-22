import { afterEach, describe, expect, it } from "vitest";
import { apiPaths, type CanvasSnapshot } from "@prepare-to-interview/shared";
import type { AgentEvent, SessionConfig } from "../src/agent/driver.ts";
import { FakeDriver } from "../src/agent/fake-driver.ts";
import { authHeaders, demoNotes, startTestServer } from "./helpers.ts";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function setup() {
  const { server, dirs } = await startTestServer();
  cleanups.push(dirs.cleanup, () => server.close());
  const config: SessionConfig = {
    persona: "You are Interviewer.",
    allowedBuiltins: [],
    mcpServers: [server.mcpServer],
  };
  return { server, config };
}

describe("fake agent driver", () => {
  it("replays a scripted turn whose tool call reaches the app's MCP server", async () => {
    const { server, config } = await setup();
    const driver = new FakeDriver([
      [
        { event: { type: "message_chunk", text: "Let me put that on your Canvas." } },
        { callTool: { server: "interview", tool: "demo_place_note", arguments: { title: "Transactions" } } },
        { event: { type: "usage", used: 1200, size: 200_000 } },
      ],
    ]);
    const session = await driver.startSession(config);
    const events: AgentEvent[] = [];

    const result = await session.prompt({ text: "Add a note", hiddenState: { activity: "demo" } }, (e) =>
      events.push(e),
    );

    expect(result).toEqual({ stopReason: "end_turn" });
    const snapshot = (await (
      await fetch(new URL(apiPaths.canvas, server.url), { headers: authHeaders(server) })
    ).json()) as CanvasSnapshot;
    expect(demoNotes(snapshot).map((n) => n.data.title)).toEqual(["Transactions"]);
    const nodeId = demoNotes(snapshot)[0]?.id;

    expect(events).toEqual([
      { type: "message_chunk", text: "Let me put that on your Canvas." },
      {
        type: "tool_call",
        toolCallId: "fake-call-1",
        title: "mcp__interview__demo_place_note",
        status: "pending",
        server: "interview",
        tool: "demo_place_note",
        rawInput: { title: "Transactions" },
      },
      {
        type: "tool_call_update",
        toolCallId: "fake-call-1",
        status: "completed",
        rawOutput: { node_id: nodeId, title: "Transactions" },
      },
      { type: "usage", used: 1200, size: 200_000 },
    ]);
    expect(driver.prompts).toEqual([{ text: "Add a note", hiddenState: { activity: "demo" } }]);
  });

  it("reports a rejected tool call as failed with the server's fix hint", async () => {
    const { config } = await setup();
    const driver = new FakeDriver([
      [{ callTool: { server: "interview", tool: "demo_place_note", arguments: { title: "" } } }],
    ]);
    const session = await driver.startSession(config);
    const events: AgentEvent[] = [];
    await session.prompt({ text: "Add an empty note" }, (e) => events.push(e));

    const update = events.find((e) => e.type === "tool_call_update");
    expect(update).toMatchObject({ status: "failed" });
    expect(JSON.stringify(update)).toContain("Fix: Pass");
  });

  it("fails loudly when a test prompts more turns than scripted", async () => {
    const { config } = await setup();
    const session = await new FakeDriver([[]]).startSession(config);
    await session.prompt({ text: "first" }, () => {});
    await expect(session.prompt({ text: "second" }, () => {})).rejects.toThrow(/no scripted turn left/);
  });
});
