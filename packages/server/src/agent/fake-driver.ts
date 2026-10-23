import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { AgentModelsResponse } from "@prepare-to-interview/shared";
import type {
  AgentDriver,
  AgentEvent,
  AgentSession,
  McpServerConfig,
  SessionConfig,
  TurnInput,
  TurnResult,
} from "./driver.ts";

/**
 * One step of a scripted turn: emit an event as is, call a tool on a session MCP server for real,
 * wait until the turn is cancelled or until a promise settles, or fail the turn with an error.
 */
export type FakeStep =
  | { event: AgentEvent }
  | { callTool: { server: string; tool: string; arguments: Record<string, unknown> } }
  | { waitForCancel: true }
  | { waitFor: Promise<unknown> }
  | { fail: Error };

export type FakeTurn = FakeStep[];

/**
 * Answers prompts no scripted turn is meant for, such as hidden Grader sessions; returning
 * `undefined` leaves the prompt to the scripted turns.
 */
export type FakeResponder = (config: SessionConfig, input: TurnInput) => FakeTurn | undefined;

/**
 * Test double for a coding agent: each prompt replays the next scripted turn. Tool calls go to the
 * app's MCP server over HTTP, as a real agent's would, and stream as tool_call and tool_call_update.
 */
export class FakeDriver implements AgentDriver {
  readonly agent = "fake";
  /** Every turn input the scripted turns answered, in order, across sessions; responder turns are left out. */
  readonly prompts: TurnInput[] = [];
  /** Session starts and loads, in order. */
  readonly sessions: { action: "start" | "load"; id: string; config: SessionConfig }[] = [];
  readonly #turns: FakeTurn[];
  readonly #respond: FakeResponder | undefined;
  /** Errors to throw from the next `startSession` or `loadSession` calls. */
  readonly sessionFailures: Error[] = [];
  models: AgentModelsResponse = { models: [], defaultModel: null };
  #sessionCount = 0;
  #toolCalls = 0;
  disposed = false;

  constructor(turns: FakeTurn[], options: { respond?: FakeResponder } = {}) {
    this.#turns = [...turns];
    this.#respond = options.respond;
  }

  /** Adds turns for later prompts, for example after a restart with a new driver. */
  script(...turns: FakeTurn[]): void {
    this.#turns.push(...turns);
  }

  listModels(): Promise<AgentModelsResponse> {
    return Promise.resolve(this.models);
  }

  startSession(config: SessionConfig): Promise<AgentSession> {
    return this.#open("start", `fake-session-${++this.#sessionCount}`, config);
  }

  loadSession(id: string, config: SessionConfig): Promise<AgentSession> {
    return this.#open("load", id, config);
  }

  dispose(): Promise<void> {
    this.disposed = true;
    return Promise.resolve();
  }

  #open(action: "start" | "load", id: string, config: SessionConfig): Promise<AgentSession> {
    const failure = this.sessionFailures.shift();
    if (failure) return Promise.reject(failure);
    this.sessions.push({ action, id, config });
    let cancel: (() => void) | undefined;
    let cancelled = false;
    return Promise.resolve({
      id,
      prompt: (input, onEvent) =>
        this.#replay(config, input, onEvent, () => {
          if (cancelled) return Promise.resolve();
          return new Promise<void>((resolve) => (cancel = resolve));
        }).finally(() => {
          cancelled = false;
        }),
      cancel: () => {
        cancelled = true;
        cancel?.();
        return Promise.resolve();
      },
      close: () => Promise.resolve(),
    });
  }

  async #replay(
    config: SessionConfig,
    input: TurnInput,
    onEvent: (event: AgentEvent) => void,
    untilCancelled: () => Promise<void>,
  ): Promise<TurnResult> {
    const responded = this.#respond?.(config, input);
    if (!responded) this.prompts.push(input);
    const turn = responded ?? this.#turns.shift();
    if (!turn) throw new Error(`FakeDriver: no scripted turn left for prompt "${input.text}"`);
    for (const step of turn) {
      if ("event" in step) onEvent(step.event);
      else if ("callTool" in step) await this.#callTool(config.mcpServers, step.callTool, onEvent);
      else if ("fail" in step) throw step.fail;
      else if ("waitFor" in step) await step.waitFor;
      else {
        await untilCancelled();
        return { stopReason: "cancelled" };
      }
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
