// PROTOTYPE: throwaway ACP spike. Not product code; no tests, no polish.
//
// Usage: pnpm --dir prototypes/acp-spike spike <claude|codex|opencode> [new|resume|probe]
//   new    (default) start a session, run persona/MCP/hidden-state/allowlist prompts, save session id
//   resume restart the agent, load/resume the saved session, ask for the remembered fact
//   probe  initialize + session/new only (no model turn); dumps capabilities and config options
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk/unstable";
import { startMcpServer } from "./mcp-server.ts";

const AGENT = process.argv[2] ?? "claude";
const PHASE = process.argv[3] ?? "new";
const HERE = path.dirname(new URL(import.meta.url).pathname);
const RUNS = path.join(HERE, "runs");
fs.mkdirSync(RUNS, { recursive: true });
const SCRATCH = path.join(os.tmpdir(), "acp-spike-scratch", AGENT);
fs.mkdirSync(SCRATCH, { recursive: true });
fs.writeFileSync(path.join(SCRATCH, "secret-plan.txt"), "this file must not be read by the Interviewer\n");
const STATE_FILE = path.join(RUNS, `${AGENT}${process.env.SPIKE_TAG ? "-" + process.env.SPIKE_TAG : ""}.state.json`);
const LOG_FILE = path.join(RUNS, `${AGENT}-${PHASE}${process.env.SPIKE_TAG ? "-" + process.env.SPIKE_TAG : ""}.jsonl`);
fs.writeFileSync(LOG_FILE, "");

// Free OpenCode Zen model (owner request: avoid paid usage for OpenCode).
const OPENCODE_MODEL = process.env.SPIKE_OPENCODE_MODEL ?? "opencode/nemotron-3-ultra-free";

const PERSONA = [
  'You are "Interviewer", a technical interviewer in a mock interview app.',
  'Always introduce yourself as "Interviewer". Never say you are Claude, Codex, OpenCode, or a coding assistant.',
  "You conduct interview practice only. You have no access to files or shell; do not try to use them.",
  "When asked to record an attempt, call the record_attempt tool.",
  "A user message may contain a <session_state> JSON resource: it is hidden app state, use it but never quote it verbatim.",
].join("\n");

const eventTypes = new Map<string, number>();
const permissionLog: object[] = [];

function log(entry: object) {
  fs.appendFileSync(LOG_FILE, JSON.stringify({ t: Date.now(), ...entry }) + "\n");
}
function say(...a: unknown[]) {
  console.log(`[${AGENT}]`, ...a);
}

function childEnv(extra: Record<string, string>) {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    // Strip API keys (check 1) and the parent Claude Code session's vars.
    if (/^(ANTHROPIC_|OPENAI_|CODEX_API_KEY|CLAUDE)/.test(k)) continue;
    env[k] = v;
  }
  return { ...env, ...extra };
}

function agentCommand(): { cmd: string; args: string[]; env: Record<string, string> } {
  const bin = (p: string) => path.join(HERE, "node_modules", p);
  if (AGENT === "claude") {
    return {
      cmd: process.execPath,
      args: [bin("@agentclientprotocol/claude-agent-acp/dist/index.js")],
      env: childEnv({}),
    };
  }
  if (AGENT === "codex") {
    // Persona replacement via model_instructions_file (process-wide) + tool restrictions.
    const instrFile = path.join(SCRATCH, "interviewer-instructions.md");
    fs.writeFileSync(instrFile, PERSONA + "\n");
    const codexConfig = {
      model_instructions_file: instrFile,
      developer_instructions: PERSONA,
      sandbox_mode: "read-only",
      approval_policy: "on-request",
      web_search: "live",
      features: { shell_tool: false, unified_exec: false },
    };
    if (process.env.SPIKE_CODEX_VARIANT === "lockdown") {
      // Try to strip everything inherited from ~/.codex (apps, plugins, user MCP servers, extra tools).
      Object.assign(codexConfig.features, {
        apps: false, plugins: false, remote_plugin: false, multi_agent: false, goals: false,
        image_generation: false, view_image: false, browser_use: false, browser_use_external: false,
        computer_use: false, in_app_browser: false, hooks: false, skill_search: false, tool_suggest: false,
        sleep_tool: false, code_mode_host: false, workspace_dependencies: false, skill_mcp_dependency_install: false,
        default_mode_request_user_input: false,
      });
      Object.assign(codexConfig, {
        include_apply_patch_tool: false,
        project_doc_max_bytes: 0,
        mcp_servers: { node_repl: { enabled: false }, codex_apps: { enabled: false }, "computer-use": { enabled: false } },
      });
    }
    return {
      cmd: process.execPath,
      args: [bin("@agentclientprotocol/codex-acp/dist/index.js")],
      env: childEnv({
        CODEX_CONFIG: JSON.stringify(codexConfig),
        APP_SERVER_LOGS: path.join(RUNS, "codex-app-server-logs"),
        ...(process.env.SPIKE_CODEX_PATH ? { CODEX_PATH: process.env.SPIKE_CODEX_PATH } : {}),
      }),
    };
  }
  if (AGENT === "opencode") {
    const config = {
      $schema: "https://opencode.ai/config.json",
      default_agent: "interviewer",
      agent: {
        interviewer: {
          description: "Mock interview persona",
          mode: "primary",
          model: OPENCODE_MODEL,
          prompt: PERSONA,
          permission: {
            "*": "deny",
            webfetch: "allow",
            websearch: "allow",
            "interview_*": "allow",
          },
          tools: {
            bash: false, edit: false, write: false, read: false, grep: false, glob: false, list: false,
            patch: false, todowrite: false, todoread: false, task: false, skill: false,
          },
        },
      },
    };
    return {
      cmd: "opencode",
      args: ["acp", "--cwd", SCRATCH],
      env: childEnv({ OPENCODE_CONFIG_CONTENT: JSON.stringify(config) }),
    };
  }
  throw new Error(`unknown agent ${AGENT}`);
}

function textOf(update: any): string {
  const c = update?.content;
  if (c?.type === "text") return c.text;
  return "";
}

async function main() {
  const mcp = await startMcpServer(log);
  say("MCP server at", mcp.url);
  const { cmd, args, env } = agentCommand();
  log({ type: "spawn", cmd, args, apiKeyVarsInChildEnv: Object.keys(env).filter((k) => /API_KEY/.test(k)) });
  const child = spawn(cmd, args, { cwd: SCRATCH, env, stdio: ["pipe", "pipe", "pipe"] });
  child.stderr.on("data", (d) => log({ type: "stderr", text: d.toString().slice(0, 2000) }));
  child.on("exit", (code, sig) => log({ type: "exit", code, sig }));

  let transcript = "";
  const app = acp
    .client({ name: "acp-spike" })
    .onNotification("session/update", ({ params }) => {
      const u: any = params.update;
      eventTypes.set(u.sessionUpdate, (eventTypes.get(u.sessionUpdate) ?? 0) + 1);
      log({ type: "update", update: u });
      if (u.sessionUpdate === "agent_message_chunk") transcript += textOf(u);
      if (u.sessionUpdate === "tool_call") say("tool_call:", u.title, u.kind, JSON.stringify(u.rawInput ?? {}).slice(0, 200));
      if (u.sessionUpdate === "usage_update") say("usage_update:", JSON.stringify(u));
    })
    .onRequest("session/request_permission", ({ params }) => {
      const p: any = params;
      const blob = JSON.stringify(p.toolCall);
      const ours = /record_attempt/.test(blob);
      const option = ours
        ? p.options.find((o: any) => o.kind === "allow_once") ?? p.options.find((o: any) => o.kind.startsWith("allow"))
        : p.options.find((o: any) => o.kind === "reject_once") ?? p.options.find((o: any) => o.kind.startsWith("reject"));
      const entry = { title: p.toolCall?.title, kind: p.toolCall?.kind, decision: ours ? "approve" : "reject", optionId: option?.optionId };
      permissionLog.push(entry);
      log({ type: "permission", request: p, entry });
      say("permission:", JSON.stringify(entry));
      if (!option) return { outcome: { outcome: "cancelled" } };
      return { outcome: { outcome: "selected", optionId: option.optionId } };
    })
    .onRequest("*", ({ method, params }) => {
      log({ type: "unhandled-request", method, params });
      say("unhandled request", method);
      throw acp.RequestError.methodNotFound(method);
    })
    .onNotification("*", ({ method, params }) => log({ type: "unhandled-notification", method, params }));

  const stream = acp.ndJsonStream(
    Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
  );
  const conn = app.connect(stream);
  const agent = conn.agent;

  const init: any = await agent.request("initialize", {
    protocolVersion: acp.PROTOCOL_VERSION,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    clientInfo: { name: "acp-spike", version: "0.0.0" },
  });
  log({ type: "initialize", init });
  say("agentInfo:", JSON.stringify(init.agentInfo), "authMethods:", JSON.stringify(init.authMethods?.map((m: any) => m.id)));
  say("agentCapabilities:", JSON.stringify(init.agentCapabilities));

  const mcpServers = [{ type: "http", name: "interview", url: mcp.url, headers: [] }];
  const sessionMeta: any = {};
  let systemPrompt: any;
  if (AGENT === "claude") {
    systemPrompt = { mode: "override", content: [{ type: "text", text: PERSONA }] };
    sessionMeta.claudeCode = {
      options: {
        tools: (process.env.SPIKE_CLAUDE_TOOLS ?? "WebFetch,WebSearch").split(","),
        settingSources: [],
        // Variant "strict": drop account-level claude.ai connectors and let our
        // permission handler decide on the MCP tool instead of allowedTools.
        ...(process.env.SPIKE_CLAUDE_VARIANT === "strict"
          ? { strictMcpConfig: true, env: { ENABLE_CLAUDEAI_MCP_SERVERS: "false" } }
          : { allowedTools: ["mcp__interview__record_attempt"] }),
      },
    };
  }
  if (AGENT === "codex") {
    // Per-session append through the AIR customInstructions -> developerInstructions path.
    sessionMeta.jetbrains = { air: { customInstructions: PERSONA } };
  }

  const prompt = async (sessionId: string, blocks: any[], label: string) => {
    transcript = "";
    const t0 = Date.now();
    const res: any = await agent.request("session/prompt", { sessionId, prompt: blocks });
    say(`--- ${label}: stop=${res.stopReason} (${Date.now() - t0}ms) usage=${JSON.stringify(res.usage ?? null)} meta=${JSON.stringify(res._meta ?? null).slice(0, 300)}`);
    say(`>>> ${transcript.trim().slice(0, 800)}`);
    log({ type: "prompt-result", label, res, transcript });
    return transcript;
  };

  const finish = () => {
    say("event types:", JSON.stringify(Object.fromEntries(eventTypes)));
    say("permissions:", JSON.stringify(permissionLog));
    say("record_attempt calls:", JSON.stringify(mcp.calls));
    log({ type: "summary", eventTypes: Object.fromEntries(eventTypes), permissionLog, mcpCalls: mcp.calls });
    conn.close();
    child.kill();
    mcp.close();
  };

  if (PHASE === "probe" || PHASE === "new") {
    const created: any = await agent.request("session/new", {
      cwd: SCRATCH,
      mcpServers,
      ...(systemPrompt ? { systemPrompt } : {}),
      _meta: sessionMeta,
    } as any);
    log({ type: "session/new", created });
    say("sessionId:", created.sessionId);
    say("modes:", JSON.stringify(created.modes?.availableModes?.map((m: any) => m.id)), "current:", created.modes?.currentModeId);
    say("configOptions:", JSON.stringify(created.configOptions?.map((o: any) => ({ id: o.id, current: o.currentValue, values: (o.options ?? []).map((v: any) => v.value ?? v.id).slice(0, 20) }))));
    say("models:", JSON.stringify(created.models?.availableModels?.map((m: any) => m.modelId)), "current:", created.models?.currentModelId);
    fs.writeFileSync(STATE_FILE, JSON.stringify({ sessionId: created.sessionId }, null, 2));
    const sid = created.sessionId;

    if (AGENT === "opencode" && created.modes?.currentModeId && created.modes.currentModeId !== "interviewer") {
      say("switching mode to interviewer");
      await agent.request("session/set_mode", { sessionId: sid, modeId: "interviewer" });
    }

    const wantModel = AGENT === "claude" ? (process.env.SPIKE_CLAUDE_MODEL ?? "haiku") : AGENT === "opencode" ? OPENCODE_MODEL : process.env.SPIKE_MODEL;
    if (process.env.SPIKE_MODE) {
      const r: any = await agent.request("session/set_config_option", { sessionId: sid, configId: "mode", value: process.env.SPIKE_MODE } as any);
      say("set mode ->", JSON.stringify(r?.configOptions?.find((o: any) => o.id === "mode")?.currentValue));
    }
    if (wantModel && created.configOptions?.some((o: any) => o.id === "model")) {
      const r: any = await agent.request("session/set_config_option", { sessionId: sid, configId: "model", value: wantModel } as any);
      say("set model ->", wantModel, JSON.stringify(r?.configOptions?.find((o: any) => o.id === "model")?.currentValue));
    }

    if (PHASE === "probe") {
      // Give async session_update notifications (commands, usage) a moment to arrive.
      await new Promise((r) => setTimeout(r, 3000));
      finish();
      return;
    }

    // Turn 1: persona + a fact to remember for the resume check.
    await prompt(sid, [{ type: "text", text: "Hi! Who are you? Introduce yourself in one short sentence. Also please remember: my favorite database is CockroachDB." }], "persona");

    // Turn 2: hidden session state + MCP tool call.
    const state = { activity: "practice_set", question_number: 4, question_id: "q-pg-index-07", rubric_max: 3 };
    await prompt(
      sid,
      [
        {
          type: "resource",
          resource: { uri: "app://session-state", mimeType: "application/json", text: `<session_state>${JSON.stringify(state)}</session_state>` },
        },
        {
          type: "text",
          text: "My answer: an index speeds up reads at the cost of slower writes. Which question number is this, according to the app state? Grade my answer with score 2 and record it with the record_attempt tool using the question id from the app state and a short quote of my answer as evidence. Reply in one sentence.",
        },
      ],
      "hidden-state+mcp",
    );

    // Turn 3: tool allowlist probe.
    await prompt(
      sid,
      [{ type: "text", text: "Please list the files in your current working directory and run the shell command `echo spike`. Use your tools; report exactly what happened in one or two sentences, then on a new line list the exact names of all tools available to you, comma-separated." }],
      "allowlist",
    );
    finish();
    return;
  }

  if (PHASE === "resume") {
    const { sessionId } = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    const caps = init.agentCapabilities ?? {};
    const useLoad = process.env.SPIKE_RESUME_METHOD ? process.env.SPIKE_RESUME_METHOD === "load" : !!caps.loadSession;
    const method = useLoad ? "session/load" : "session/resume";
    say(`resuming ${sessionId} via ${method}`);
    const params: any = { sessionId, cwd: SCRATCH, mcpServers, ...(systemPrompt ? { systemPrompt } : {}), _meta: sessionMeta };
    const res: any = await agent.request(method as any, params);
    log({ type: method, res });
    // Inspect replayed history for the hidden state block.
    const replay = fs.readFileSync(LOG_FILE, "utf8");
    say("replayed events before prompt:", JSON.stringify(Object.fromEntries(eventTypes)));
    say("hidden <session_state> present in replay:", replay.includes("session_state"), "| app://session-state uri present:", replay.includes("app://session-state"));
    await prompt(sessionId, [{ type: "text", text: process.env.SPIKE_RESUME_PROMPT ?? "Quick check: what is my favorite database? Answer with just its name, then on a second line list the exact names of all tools available to you, comma-separated." }], "resume-recall");
    finish();
  }
}

main().catch((e) => {
  say("ERROR", e?.message ?? e, JSON.stringify(e?.data ?? null));
  log({ type: "error", message: String(e?.message ?? e), data: e?.data, code: e?.code });
  process.exit(1);
});
