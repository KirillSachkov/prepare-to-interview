import * as acp from "@agentclientprotocol/sdk/unstable";
import type { AgentProcess, LaunchSpec, Launcher } from "../src/agent/acp-driver.ts";
import type { AgentError } from "../src/agent/errors.ts";

export interface RecordedRequest {
  process: number;
  method: string;
  params: Record<string, unknown>;
}

export interface PromptContext {
  sessionId: string;
  prompt: acp.ContentBlock[];
  update: (update: acp.SessionUpdate) => Promise<void>;
  requestPermission: (toolCall: acp.ToolCallUpdate) => Promise<acp.RequestPermissionResponse>;
  /** Resolves when the client sends `session/cancel` for this session. */
  cancelled: Promise<void>;
}

export interface FakeAcpAgentOptions {
  configOptions?: acp.SessionConfigOption[];
  /** Thrown from `session/new`, for example `acp.RequestError.authRequired()`. */
  newSessionError?: Error;
  /** An adapter stalled while creating a discovery session. */
  newSessionWait?: Promise<void>;
  /** Updates replayed during `session/load`, as agents replay history. */
  replay?: acp.SessionUpdate[];
  onPrompt?: (ctx: PromptContext) => Promise<acp.StopReason | undefined>;
}

const permissionOptions: acp.PermissionOption[] = [
  { optionId: "allow", name: "Allow", kind: "allow_once" },
  { optionId: "always", name: "Always allow", kind: "allow_always" },
  { optionId: "reject", name: "Reject", kind: "reject_once" },
];

export function selectOption(id: string, values: string[], category = id): acp.SessionConfigOption {
  return {
    type: "select",
    id,
    name: id,
    category,
    currentValue: values[0] ?? "",
    options: values.map((value) => ({ value, name: value })),
  };
}

/**
 * An in-process ACP agent standing in for an adapter: records launches and requests, replays
 * history on load, and runs a test-supplied prompt script. Each launch is a separate "process".
 */
export function fakeAcpAgent(options: FakeAcpAgentOptions = {}) {
  const launches: LaunchSpec[] = [];
  const requests: RecordedRequest[] = [];
  const kills: number[] = [];
  const configOptions = options.configOptions ?? [selectOption("mode", ["auto", "default"]), selectOption("model", ["a", "b"])];

  const launcher: Launcher = (spec) => {
    launches.push(spec);
    const processId = launches.length;
    let sessions = 0;
    const cancels = new Map<string, () => void>();
    const record = (method: string, params: unknown) =>
      requests.push({ process: processId, method, params: params as Record<string, unknown> });

    const agent = acp
      .agent({ name: "fake-acp-agent" })
      .onRequest("initialize", ({ params }) => {
        record("initialize", params);
        return {
          protocolVersion: acp.PROTOCOL_VERSION,
          agentCapabilities: { loadSession: true, promptCapabilities: { embeddedContext: true } },
          authMethods: [],
        };
      })
      .onRequest("session/new", async ({ params }) => {
        record("session/new", params);
        await options.newSessionWait;
        if (options.newSessionError) throw options.newSessionError;
        return { sessionId: `session-${processId}-${++sessions}`, configOptions };
      })
      .onRequest("session/load", async ({ params, client }) => {
        record("session/load", params);
        for (const update of options.replay ?? []) {
          await client.notify("session/update", { sessionId: params.sessionId, update });
        }
        return { configOptions };
      })
      .onRequest("session/set_config_option", ({ params }) => {
        record("session/set_config_option", params);
        return { configOptions };
      })
      .onRequest("session/set_mode", ({ params }) => {
        record("session/set_mode", params);
        return {};
      })
      .onRequest("session/prompt", async ({ params, client }) => {
        record("session/prompt", params);
        const cancelled = new Promise<void>((resolve) => cancels.set(params.sessionId, resolve));
        const stopReason = await options.onPrompt?.({
          sessionId: params.sessionId,
          prompt: params.prompt,
          update: (update) => client.notify("session/update", { sessionId: params.sessionId, update }),
          requestPermission: (toolCall) =>
            client.request("session/request_permission", { sessionId: params.sessionId, toolCall, options: permissionOptions }),
          cancelled,
        });
        return { stopReason: stopReason ?? "end_turn" };
      })
      .onNotification("session/cancel", ({ params }) => {
        record("session/cancel", params);
        cancels.get(params.sessionId)?.();
      });

    let resolveExit: (reason: AgentError | undefined) => void = () => undefined;
    const process: AgentProcess = {
      connect: (client) => {
        const connection = client.connect(agent);
        void connection.closed.then(() => resolveExit(undefined));
        return connection;
      },
      exited: new Promise((resolve) => (resolveExit = resolve)),
      kill: () => {
        kills.push(processId);
        resolveExit(undefined);
      },
    };
    return process;
  };

  return { launcher, launches, requests, kills };
}
