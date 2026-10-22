import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk/unstable";
import { sessionStateUri, type AgentId } from "@prepare-to-interview/shared";
import type { AgentDriver, AgentEvent, AgentSession, SessionConfig, TurnInput, TurnResult } from "./driver.ts";
import { AgentError, toAgentError } from "./errors.ts";
import { matchMcpTool } from "./tool-names.ts";

/** How to start an agent process. */
export interface LaunchSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
}

/** A running agent process the driver talks ACP to. */
export interface AgentProcess {
  connect(client: acp.ClientApp): acp.ClientConnection;
  /** Resolves when the process ends: with the reason when it ended on its own, `undefined` after `kill`. */
  exited: Promise<AgentError | undefined>;
  kill(): void;
}

export type Launcher = (spec: LaunchSpec) => AgentProcess;

export interface SessionParams {
  systemPrompt?: acp.SystemPrompt;
  _meta?: Record<string, unknown>;
}

/** Per-agent translation of the driver interface (validated in the ACP spike). */
export interface AcpProfile {
  agent: AgentId;
  /** Process launch for a session config; sessions with an equal spec share one process. */
  launch(config: SessionConfig): LaunchSpec;
  /** Extra `session/new` and `session/load` params carrying the persona and tool restrictions. */
  sessionParams(config: SessionConfig): SessionParams;
  /** Mode applied when the config sets none; skipped when the agent does not offer it. */
  defaultMode?: string;
}

export const clientInfo = { name: "prepare-to-interview", version: "0.0.0" };

/** Drives one coding agent over ACP; sessions with the same launch spec share a process. */
export class AcpDriver implements AgentDriver {
  readonly agent: AgentId;
  readonly #profile: AcpProfile;
  readonly #launcher: Launcher;
  readonly #connections = new Map<string, Promise<AgentConnection>>();

  constructor(profile: AcpProfile, launcher: Launcher = spawnLauncher) {
    this.agent = profile.agent;
    this.#profile = profile;
    this.#launcher = launcher;
  }

  async startSession(config: SessionConfig): Promise<AgentSession> {
    const connection = await this.#connection(config);
    return connection.newSession(config);
  }

  async loadSession(id: string, config: SessionConfig): Promise<AgentSession> {
    const connection = await this.#connection(config);
    return connection.loadSession(id, config);
  }

  async dispose(): Promise<void> {
    const connections = [...this.#connections.values()];
    this.#connections.clear();
    for (const pending of connections) {
      await pending.then((c) => c.close()).catch(() => undefined);
    }
  }

  #connection(config: SessionConfig): Promise<AgentConnection> {
    const spec = this.#profile.launch(config);
    const key = JSON.stringify(spec);
    let pending = this.#connections.get(key);
    if (!pending) {
      pending = AgentConnection.open(this.#profile, spec, this.#launcher, () => {
        if (this.#connections.get(key) === pending) this.#connections.delete(key);
      });
      pending.catch(() => {
        if (this.#connections.get(key) === pending) this.#connections.delete(key);
      });
      this.#connections.set(key, pending);
    }
    return pending;
  }
}

interface SessionState {
  configOptions?: acp.SessionConfigOption[] | null;
  modes?: acp.SessionModeState | null;
}

/** One agent process with its ACP connection; routes updates and permission requests per session. */
class AgentConnection {
  readonly #profile: AcpProfile;
  readonly #spec: LaunchSpec;
  readonly #process: AgentProcess;
  readonly #sessions = new Map<string, AcpSession>();
  #connection!: acp.ClientConnection;
  #init!: acp.InitializeResponse;
  #closed = false;

  private constructor(profile: AcpProfile, spec: LaunchSpec, process: AgentProcess) {
    this.#profile = profile;
    this.#spec = spec;
    this.#process = process;
  }

  static async open(profile: AcpProfile, spec: LaunchSpec, launcher: Launcher, onEnd: () => void): Promise<AgentConnection> {
    const process = launcher(spec);
    const self = new AgentConnection(profile, spec, process);
    const client = acp
      .client({ name: clientInfo.name })
      .onNotification("session/update", ({ params }) => self.#sessions.get(params.sessionId)?.handleUpdate(params.update))
      .onRequest("session/request_permission", ({ params }) => {
        const session = self.#sessions.get(params.sessionId);
        return answerPermission(params, session ? session.permits(params.toolCall) : false);
      })
      .onRequest("*", ({ method }) => {
        throw acp.RequestError.methodNotFound(method);
      })
      .onNotification("*", () => undefined);
    self.#connection = process.connect(client);
    void process.exited.then((reason) => {
      self.#closed = true;
      const error = reason ?? new AgentError("failed", `${profile.agent} process stopped`);
      self.#connection.close(error);
      for (const session of self.#sessions.values()) session.markDead(error);
      onEnd();
    });
    try {
      self.#init = await self.#connection.agent.request("initialize", {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo,
      });
    } catch (error) {
      process.kill();
      throw toAgentError(error);
    }
    return self;
  }

  async newSession(config: SessionConfig): Promise<AgentSession> {
    this.#ensureOpen();
    try {
      const params: acp.NewSessionRequest = {
        cwd: this.#spec.cwd,
        mcpServers: config.mcpServers,
        ...this.#profile.sessionParams(config),
      };
      const response = await this.#connection.agent.request("session/new", params);
      const session = this.#register(response.sessionId, config);
      await this.#applySettings(response.sessionId, response, config);
      return session;
    } catch (error) {
      throw toAgentError(error);
    }
  }

  async loadSession(id: string, config: SessionConfig): Promise<AgentSession> {
    this.#ensureOpen();
    if (!this.#init.agentCapabilities?.loadSession) {
      throw new AgentError("failed", `${this.#profile.agent} cannot resume earlier sessions`);
    }
    // Registered before loading so the replayed history arrives at a session with no listener and is dropped.
    const session = this.#register(id, config);
    try {
      const response = await this.#connection.agent.request("session/load", {
        sessionId: id,
        cwd: this.#spec.cwd,
        mcpServers: config.mcpServers,
        ...this.#profile.sessionParams(config),
      });
      await this.#applySettings(id, response ?? {}, config);
      return session;
    } catch (error) {
      this.#sessions.delete(id);
      throw toAgentError(error);
    }
  }

  get embeddedContext(): boolean {
    return this.#init.agentCapabilities?.promptCapabilities?.embeddedContext === true;
  }

  prompt(sessionId: string, blocks: acp.ContentBlock[]): Promise<acp.PromptResponse> {
    this.#ensureOpen();
    return this.#connection.agent.request("session/prompt", { sessionId, prompt: blocks });
  }

  cancel(sessionId: string): Promise<void> {
    if (this.#closed) return Promise.resolve();
    return this.#connection.agent.notify("session/cancel", { sessionId });
  }

  forget(sessionId: string): void {
    this.#sessions.delete(sessionId);
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#process.kill();
    await this.#process.exited;
  }

  #register(id: string, config: SessionConfig): AcpSession {
    const session = new AcpSession(this, id, config);
    this.#sessions.set(id, session);
    return session;
  }

  /** Model and mode are re-applied after every `session/new` and `session/load`: agents reset them. */
  async #applySettings(sessionId: string, state: SessionState, config: SessionConfig): Promise<void> {
    const mode = config.mode ?? this.#profile.defaultMode;
    if (mode) await this.#setOption(sessionId, state, "mode", mode, config.mode !== undefined);
    if (config.model) await this.#setOption(sessionId, state, "model", config.model, true);
  }

  async #setOption(sessionId: string, state: SessionState, kind: "mode" | "model", value: string, required: boolean) {
    const option = state.configOptions?.find((o) => o.id === kind || o.category === kind);
    if (option) {
      await this.#connection.agent.request("session/set_config_option", { sessionId, configId: option.id, value });
      return;
    }
    if (kind === "mode" && state.modes?.availableModes.some((m) => m.id === value)) {
      await this.#connection.agent.request("session/set_mode", { sessionId, modeId: value });
      return;
    }
    if (required) throw new AgentError("failed", `${this.#profile.agent} does not offer a ${kind} setting for "${value}"`);
  }

  #ensureOpen(): void {
    if (this.#closed) throw new AgentError("failed", `${this.#profile.agent} process stopped`);
  }
}

class AcpSession implements AgentSession {
  readonly id: string;
  readonly #connection: AgentConnection;
  readonly #config: SessionConfig;
  readonly #servers: string[];
  #onEvent: ((event: AgentEvent) => void) | undefined;
  #dead: AgentError | undefined;

  constructor(connection: AgentConnection, id: string, config: SessionConfig) {
    this.id = id;
    this.#connection = connection;
    this.#config = config;
    this.#servers = config.mcpServers.map((s) => s.name);
  }

  async prompt(input: TurnInput, onEvent: (event: AgentEvent) => void): Promise<TurnResult> {
    if (this.#dead) throw this.#dead;
    if (this.#onEvent) throw new AgentError("failed", "A turn is already running in this session");
    this.#onEvent = onEvent;
    try {
      const response = await this.#connection.prompt(this.id, promptBlocks(input, this.#connection.embeddedContext));
      return { stopReason: response.stopReason };
    } catch (error) {
      throw toAgentError(error);
    } finally {
      this.#onEvent = undefined;
    }
  }

  cancel(): Promise<void> {
    return this.#connection.cancel(this.id);
  }

  close(): Promise<void> {
    this.#connection.forget(this.id);
    return Promise.resolve();
  }

  handleUpdate(update: acp.SessionUpdate): void {
    if (!this.#onEvent) return;
    const event = normalizeUpdate(update, this.#servers);
    if (event) this.#onEvent(event);
  }

  permits(toolCall: acp.ToolCallUpdate): boolean {
    return permitsToolCall(toolCall, this.#config);
  }

  markDead(error: AgentError): void {
    this.#dead = error;
  }
}

/** The hidden state goes first, as an embedded resource where the agent supports it. */
export function promptBlocks(input: TurnInput, embeddedContext: boolean): acp.ContentBlock[] {
  const blocks: acp.ContentBlock[] = [];
  if (input.hiddenState !== undefined) {
    const text = `<session_state>${JSON.stringify(input.hiddenState)}</session_state>`;
    blocks.push(
      embeddedContext
        ? { type: "resource", resource: { uri: sessionStateUri, mimeType: "application/json", text } }
        : { type: "text", text },
    );
  }
  blocks.push({ type: "text", text: input.text });
  return blocks;
}

function toolNames(call: acp.ToolCallUpdate | acp.ToolCall): (string | null | undefined)[] {
  const claude = call._meta?.claudeCode as { toolName?: unknown } | undefined;
  return [call.name, typeof claude?.toolName === "string" ? claude.toolName : undefined, call.title];
}

/** Maps an ACP `session/update` onto a driver event; updates the Chat does not use map to `undefined`. */
export function normalizeUpdate(update: acp.SessionUpdate, servers: readonly string[]): AgentEvent | undefined {
  switch (update.sessionUpdate) {
    case "agent_message_chunk":
      return update.content.type === "text" ? { type: "message_chunk", text: update.content.text } : undefined;
    case "agent_thought_chunk":
      return update.content.type === "text" ? { type: "thought_chunk", text: update.content.text } : undefined;
    case "tool_call": {
      const ref = matchMcpTool(toolNames(update), servers);
      return {
        type: "tool_call",
        toolCallId: update.toolCallId,
        title: update.title,
        status: update.status ?? "pending",
        ...ref,
        ...(update.rawInput !== undefined && { rawInput: update.rawInput }),
      };
    }
    case "tool_call_update": {
      const ref = matchMcpTool(toolNames(update), servers);
      return {
        type: "tool_call_update",
        toolCallId: update.toolCallId,
        ...(update.status && { status: update.status }),
        ...(update.title && { title: update.title }),
        ...ref,
        ...(update.rawInput !== undefined && { rawInput: update.rawInput }),
        ...(update.rawOutput !== undefined && { rawOutput: update.rawOutput }),
      };
    }
    case "usage_update":
      return { type: "usage", used: update.used, size: update.size };
    case "session_info_update":
      return { type: "session_info", ...(update.title && { title: update.title }) };
    default:
      return undefined;
  }
}

/**
 * Only the app's MCP tools and the allowed web built-ins are approved. Agents that bypass
 * permission requests (Codex Guardian, Claude allowlists) are held back by MCP validation instead.
 */
export function permitsToolCall(toolCall: acp.ToolCallUpdate, config: SessionConfig): boolean {
  if (matchMcpTool(toolNames(toolCall), config.mcpServers.map((s) => s.name))) return true;
  const web = config.allowedBuiltins;
  if (toolCall.kind === "fetch") return web.length > 0;
  if (toolCall.kind === "search") return web.includes("web_search") && /web/i.test(toolCall.title ?? "");
  return false;
}

function answerPermission(request: acp.RequestPermissionRequest, allow: boolean): acp.RequestPermissionResponse {
  const prefix = allow ? "allow" : "reject";
  const option =
    request.options.find((o) => o.kind === `${prefix}_once`) ?? request.options.find((o) => o.kind.startsWith(prefix));
  return option ? { outcome: { outcome: "selected", optionId: option.optionId } } : { outcome: { outcome: "cancelled" } };
}

/** Starts the agent as a child process speaking newline-delimited JSON-RPC on stdio. */
export const spawnLauncher: Launcher = (spec) => {
  const child = spawn(spec.command, spec.args, { cwd: spec.cwd, env: spec.env, stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  let killed = false;
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-4000);
  });
  child.stdin.on("error", () => undefined);
  const exited = new Promise<AgentError | undefined>((resolve) => {
    child.once("error", (error) => resolve(toAgentError(error)));
    child.once("exit", (code, signal) => {
      if (killed) resolve(undefined);
      else resolve(toAgentError(new Error(`agent process exited (${signal ?? `code ${code}`}): ${stderr.trim().slice(-600)}`)));
    });
  });
  return {
    connect: (client) =>
      client.connect(
        acp.ndJsonStream(
          Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
          Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
        ),
      ),
    exited,
    kill: () => {
      killed = true;
      if (child.exitCode === null && child.signalCode === null) child.kill();
    },
  };
};
