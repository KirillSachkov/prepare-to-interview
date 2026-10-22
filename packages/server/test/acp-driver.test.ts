import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as acp from "@agentclientprotocol/sdk/unstable";
import { afterEach, describe, expect, it } from "vitest";
import { AcpDriver } from "../src/agent/acp-driver.ts";
import type { AgentEvent, SessionConfig } from "../src/agent/driver.ts";
import { AgentError } from "../src/agent/errors.ts";
import { createProfile, type ProfileContext } from "../src/agent/profiles.ts";
import type { AgentId } from "@prepare-to-interview/shared";
import { fakeAcpAgent, selectOption, type FakeAcpAgentOptions } from "./fake-acp-agent.ts";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const persona = "You are Interviewer.";
const mcpServer = {
  type: "http" as const,
  name: "interview",
  url: "http://127.0.0.1:1/mcp",
  headers: [{ name: "Authorization", value: "Bearer t" }],
};
const config: SessionConfig = { persona, allowedBuiltins: ["web_fetch", "web_search"], mcpServers: [mcpServer] };

function setup(agent: AgentId, options: FakeAcpAgentOptions = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pti-acp-"));
  const ctx: ProfileContext = {
    workDir: path.join(root, "work"),
    stateDir: path.join(root, "state"),
    env: { PATH: "/usr/bin", HOME: "/home/candidate", ANTHROPIC_API_KEY: "sk-x", OPENAI_API_KEY: "sk-y", CLAUDECODE: "1" },
    opencodeCommand: "/opt/bin/opencode",
  };
  const fake = fakeAcpAgent(options);
  const driver = new AcpDriver(createProfile(agent, ctx), fake.launcher);
  cleanups.push(() => driver.dispose(), () => fs.rmSync(root, { recursive: true, force: true }));
  const requests = (method: string) => fake.requests.filter((r) => r.method === method).map((r) => r.params);
  return { ...fake, driver, ctx, requests };
}

function collect() {
  const events: AgentEvent[] = [];
  return { events, onEvent: (e: AgentEvent) => events.push(e) };
}

describe("ACP driver: per-agent translation", () => {
  it("Claude: overrides the system prompt, allows only web tools plus app MCP, drops user settings and connectors", async () => {
    const { driver, launches, requests } = setup("claude");
    await driver.startSession({ ...config, model: "haiku" });

    const [launch] = launches;
    expect(launch?.command).toBe(process.execPath);
    expect(launch?.args[0]).toMatch(/claude-agent-acp.*dist[/\\]index\.js$/);
    expect(launch?.env.ENABLE_CLAUDEAI_MCP_SERVERS).toBe("false");
    expect(launch?.env).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(launch?.env).not.toHaveProperty("OPENAI_API_KEY");
    expect(launch?.env).not.toHaveProperty("CLAUDECODE");
    expect(launch?.env.HOME).toBe("/home/candidate");

    expect(requests("session/new")[0]).toMatchObject({
      mcpServers: [mcpServer],
      systemPrompt: { mode: "override", content: [{ type: "text", text: persona }] },
      _meta: {
        claudeCode: {
          options: {
            tools: ["WebFetch", "WebSearch"],
            settingSources: [],
            strictMcpConfig: true,
            env: { ENABLE_CLAUDEAI_MCP_SERVERS: "false" },
          },
        },
      },
    });
    expect(requests("session/set_config_option").map((p) => [p.configId, p.value])).toEqual([
      ["mode", "default"],
      ["model", "haiku"],
    ]);
  });

  it("Codex: replaces the base prompt per process, appends per session, read-only with no shell", async () => {
    const { driver, launches, requests } = setup("codex");
    await driver.startSession(config);
    await driver.startSession(config);
    await driver.startSession({ ...config, persona: "You are Grader." });

    expect(launches).toHaveLength(2);
    const codexConfig = JSON.parse(launches[0]!.env.CODEX_CONFIG!) as Record<string, unknown> & {
      features: Record<string, boolean>;
      model_instructions_file: string;
    };
    expect(codexConfig).toMatchObject({
      developer_instructions: persona,
      sandbox_mode: "read-only",
      web_search: "live",
      features: { shell_tool: false, unified_exec: false, apps: false, plugins: false },
    });
    expect(fs.readFileSync(codexConfig.model_instructions_file, "utf8")).toBe(persona + "\n");
    expect(launches[1]!.env.CODEX_CONFIG).toContain("You are Grader.");
    expect(launches[0]!.env).not.toHaveProperty("OPENAI_API_KEY");
    expect(requests("session/new")[0]).toMatchObject({
      _meta: { jetbrains: { air: { customInstructions: persona } } },
    });
    expect(requests("session/new")[0]).not.toHaveProperty("systemPrompt");
  });

  it("OpenCode: primary custom agent with deny-by-default permissions; model through config options", async () => {
    const { driver, launches, requests } = setup("opencode", {
      configOptions: [selectOption("mode", ["build", "interviewer"]), selectOption("model", ["x/y", "deepseek/flash"])],
    });
    await driver.startSession({ ...config, allowedBuiltins: ["web_fetch"], model: "deepseek/flash" });

    expect(launches[0]).toMatchObject({ command: "/opt/bin/opencode", args: ["acp", "--cwd", expect.any(String)] });
    const content = JSON.parse(launches[0]!.env.OPENCODE_CONFIG_CONTENT!) as Record<string, unknown>;
    expect(content).toMatchObject({
      default_agent: "interviewer",
      agent: {
        interviewer: {
          mode: "primary",
          prompt: persona,
          permission: { "*": "deny", webfetch: "allow", "interview_*": "allow" },
          tools: { bash: false, edit: false, read: false },
        },
      },
    });
    expect(JSON.stringify(content)).not.toContain("websearch");
    expect(requests("session/set_config_option").map((p) => [p.configId, p.value])).toEqual([
      ["mode", "interviewer"],
      ["model", "deepseek/flash"],
    ]);
  });

  it("re-applies model and mode after loading a session and drops the replayed history", async () => {
    const { driver, requests } = setup("claude", {
      replay: [
        { sessionUpdate: "user_message_chunk", content: { type: "text", text: "app://session-state" } },
        { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "earlier reply" } },
      ],
      onPrompt: async (ctx) => {
        await ctx.update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "fresh" } });
        return "end_turn";
      },
    });
    const session = await driver.loadSession("stored-1", { ...config, model: "sonnet" });
    const { events, onEvent } = collect();
    await session.prompt({ text: "hi" }, onEvent);

    expect(session.id).toBe("stored-1");
    expect(requests("session/load")[0]).toMatchObject({
      sessionId: "stored-1",
      systemPrompt: { mode: "override" },
      mcpServers: [mcpServer],
    });
    expect(requests("session/set_config_option").map((p) => [p.configId, p.value])).toEqual([
      ["mode", "default"],
      ["model", "sonnet"],
    ]);
    expect(events).toEqual([{ type: "message_chunk", text: "fresh" }]);
  });
});

describe("ACP driver: turns and event normalization", () => {
  it("sends the hidden state first as an app://session-state resource", async () => {
    const { driver, requests } = setup("claude");
    const session = await driver.startSession(config);
    await session.prompt({ text: "My answer", hiddenState: { question: 4 } }, () => undefined);

    expect(requests("session/prompt")[0]?.prompt).toEqual([
      {
        type: "resource",
        resource: { uri: "app://session-state", mimeType: "application/json", text: '<session_state>{"question":4}</session_state>' },
      },
      { type: "text", text: "My answer" },
    ]);
  });

  it.each([
    ["claude", "mcp__interview__record_attempt"],
    ["codex", "mcp.interview.record_attempt"],
    ["opencode", "interview_record_attempt"],
  ] as const)("%s: matches the app tool call %s by server and tool", async (agent, title) => {
    const { driver } = setup(agent, {
      onPrompt: async (ctx) => {
        await ctx.update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Rec" } });
        await ctx.update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "ording." } });
        await ctx.update({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "hmm" } });
        await ctx.update({ sessionUpdate: "tool_call", toolCallId: "t1", title, kind: "other", rawInput: {} });
        await ctx.update({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed", rawInput: { score: 2 }, rawOutput: { ok: true } });
        await ctx.update({ sessionUpdate: "tool_call", toolCallId: "t2", title: "WebFetch", kind: "fetch" });
        await ctx.update({ sessionUpdate: "usage_update", used: 1200, size: 200_000 });
        await ctx.update({ sessionUpdate: "available_commands_update", availableCommands: [] });
        await ctx.update({ sessionUpdate: "session_info_update", title: "Practice" });
        return "end_turn";
      },
    });
    const session = await driver.startSession(config);
    const { events, onEvent } = collect();
    const result = await session.prompt({ text: "go" }, onEvent);

    expect(result).toEqual({ stopReason: "end_turn" });
    expect(events).toEqual([
      { type: "message_chunk", text: "Rec" },
      { type: "message_chunk", text: "ording." },
      { type: "thought_chunk", text: "hmm" },
      { type: "tool_call", toolCallId: "t1", title, status: "pending", server: "interview", tool: "record_attempt", rawInput: {} },
      {
        type: "tool_call_update",
        toolCallId: "t1",
        status: "completed",
        rawInput: { score: 2 },
        rawOutput: { ok: true },
      },
      { type: "tool_call", toolCallId: "t2", title: "WebFetch", status: "pending" },
      { type: "usage", used: 1200, size: 200_000 },
      { type: "session_info", title: "Practice" },
    ]);
  });

  it("approves permission for the app's MCP tools and web fetch, rejects anything else", async () => {
    const answers: string[] = [];
    const { driver } = setup("claude", {
      onPrompt: async (ctx) => {
        for (const toolCall of [
          { toolCallId: "a", title: "mcp__interview__record_attempt", kind: "other" },
          { toolCallId: "b", title: "WebFetch", kind: "fetch" },
          { toolCallId: "c", title: "Bash", kind: "execute" },
          { toolCallId: "d", title: "mcp__other__delete_all", kind: "other" },
          { toolCallId: "e", title: "Read secret-plan.txt", kind: "read" },
        ] as const) {
          const response = await ctx.requestPermission(toolCall);
          answers.push(response.outcome.outcome === "selected" ? response.outcome.optionId : "cancelled");
        }
        return "end_turn";
      },
    });
    const session = await driver.startSession(config);
    await session.prompt({ text: "go" }, () => undefined);

    expect(answers).toEqual(["allow", "allow", "reject", "reject", "reject"]);
  });

  it("cancels a running turn", async () => {
    const { driver, requests } = setup("codex", {
      onPrompt: async (ctx) => {
        await ctx.update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Long answer" } });
        await ctx.cancelled;
        return "cancelled";
      },
    });
    const session = await driver.startSession(config);
    const { events, onEvent } = collect();
    const turn = session.prompt({ text: "go" }, onEvent);
    await expect.poll(() => events.length).toBe(1);
    await session.cancel();

    await expect(turn).resolves.toEqual({ stopReason: "cancelled" });
    expect(requests("session/cancel")).toEqual([{ sessionId: session.id }]);
  });
});

describe("ACP driver: errors in plain categories", () => {
  it("reports a logged-out agent", async () => {
    const { driver } = setup("claude", { newSessionError: acp.RequestError.authRequired() });
    await expect(driver.startSession(config)).rejects.toMatchObject({ name: "AgentError", kind: "not_logged_in" });
  });

  it("reports exhausted limits", async () => {
    const { driver } = setup("claude", {
      onPrompt: () => Promise.reject(acp.RequestError.internalError({ errorKind: "rate_limit" }, "You've hit your limit")),
    });
    const session = await driver.startSession(config);
    await expect(session.prompt({ text: "go" }, () => undefined)).rejects.toMatchObject({ kind: "limit_reached" });
  });

  it("reports a missing agent command", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pti-acp-"));
    cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
    const driver = new AcpDriver(
      createProfile("opencode", {
        workDir: root,
        stateDir: root,
        env: { PATH: root },
        opencodeCommand: path.join(root, "missing-opencode"),
      }),
    );
    cleanups.push(() => driver.dispose());
    const error = await driver.startSession(config).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AgentError);
    expect(error).toMatchObject({ kind: "not_installed" });
  });

  it("fails the turn and the next session start respawns after the agent process stops", async () => {
    const { driver, launches, kills } = setup("claude");
    const session = await driver.startSession(config);
    expect(kills).toEqual([]);
    await driver.dispose();
    await expect(session.prompt({ text: "go" }, () => undefined)).rejects.toMatchObject({ kind: "failed" });
    await driver.startSession(config);
    expect(launches).toHaveLength(2);
  });
});
