import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  AgentDriver,
  AgentEvent,
  AgentSession,
  McpServerConfig,
  SessionConfig,
  TurnInput,
  TurnResult,
} from "./driver.ts";

/** One step of a scripted turn: emit an event as is, or call a tool on a session MCP server for real. */
export type FakeStep =
  | { event: AgentEvent }
  | { callTool: { server: string; tool: string; arguments: Record<string, unknown> } };

export type FakeTurn = FakeStep[];

/**
 * Test double for a coding agent: each prompt replays the next scripted turn. Tool calls go to the
 * app's MCP server over HTTP, as a real agent's would, and stream as tool_call and tool_call_update.
 */
export class FakeDriver implements AgentDriver {
  readonly agent = "fake";
  /** Every turn input received, in order, across sessions. */
  readonly prompts: TurnInput[] = [];
  readonly #turns: FakeTurn[];
  #sessions = 0;
  #toolCalls = 0;

  constructor(turns: FakeTurn[]) {
    this.#turns = [...turns];
  }

  startSession(config: SessionConfig): Promise<AgentSession> {
    const id = `fake-session-${++this.#sessions}`;
    return Promise.resolve({
      id,
      prompt: (input, onEvent) => this.#replay(config, input, onEvent),
      cancel: () => Promise.resolve(),
      close: () => Promise.resolve(),
    });
  }

  async #replay(config: SessionConfig, input: TurnInput, onEvent: (event: AgentEvent) => void): Promise<TurnResult> {
    this.prompts.push(input);
    const turn = this.#turns.shift();
    if (!turn) throw new Error(`FakeDriver: no scripted turn left for prompt "${input.text}"`);
    for (const step of turn) {
      if ("event" in step) onEvent(step.event);
      else await this.#callTool(config.mcpServers, step.callTool, onEvent);
    }
    return { stopReason: "end_turn" };
  }

  async #callTool(
    servers: McpServerConfig[],
    call: Extract<FakeStep, { callTool: unknown }>["callTool"],
    onEvent: (event: AgentEvent) => void,
  ): Promise<void> {
    const server = servers.find((s) => s.name === call.server);
    if (!server) throw new Error(`FakeDriver: session has no MCP server named "${call.server}"`);
    const toolCallId = `fake-call-${++this.#toolCalls}`;
    onEvent({
      type: "tool_call",
      toolCallId,
      title: `mcp__${call.server}__${call.tool}`,
      status: "pending",
      server: call.server,
      tool: call.tool,
      rawInput: call.arguments,
    });
    const client = new Client({ name: "fake-agent", version: "0.0.0" });
    const headers = Object.fromEntries(server.headers.map((h) => [h.name, h.value]));
    await client.connect(new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers } }));
    try {
      const result = await client.callTool({ name: call.tool, arguments: call.arguments });
      onEvent({
        type: "tool_call_update",
        toolCallId,
        status: result.isError ? "failed" : "completed",
        rawOutput: result.isError ? result.content : result.structuredContent,
      });
    } finally {
      await client.close();
    }
  }
}
