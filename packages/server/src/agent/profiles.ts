import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { AgentId } from "@prepare-to-interview/shared";
import type { AcpProfile, LaunchSpec } from "./acp-driver.ts";
import type { AllowedBuiltin, SessionConfig } from "./driver.ts";

export interface ProfileContext {
  /** Empty app-owned working directory for agent sessions: no project files or AGENTS.md to pick up. */
  workDir: string;
  /** App-owned directory for generated agent files, such as Codex instruction files. */
  stateDir: string;
  /** Environment the agent processes inherit (before the app strips API keys). */
  env: NodeJS.ProcessEnv;
  /** Command that starts OpenCode; Claude and Codex run through their pinned adapters. */
  opencodeCommand?: string;
}

const require = createRequire(import.meta.url);

function adapterEntry(pkg: string, bin: string): string {
  const manifest = require.resolve(`${pkg}/package.json`);
  const { bin: bins } = JSON.parse(fs.readFileSync(manifest, "utf8")) as { bin: Record<string, string> };
  const entry = bins[bin];
  if (!entry) throw new Error(`${pkg} has no "${bin}" binary`);
  return path.join(path.dirname(manifest), entry);
}

/**
 * The agent runs on the Candidate's own login, never on API keys from the app's environment, and
 * never inherits variables of a coding-agent session the app itself was started from.
 */
export function agentEnv(env: NodeJS.ProcessEnv, extra: Record<string, string> = {}): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (/^(ANTHROPIC_|OPENAI_|CODEX_API_KEY$|CLAUDECODE$|CLAUDE_CODE_|OPENCODE_CONFIG)/.test(key)) continue;
    result[key] = value;
  }
  return { ...result, ...extra };
}

const claudeBuiltins: Record<AllowedBuiltin, string> = { web_fetch: "WebFetch", web_search: "WebSearch" };

/**
 * Claude: per-session system prompt override and an exact tool allowlist. `settingSources: []`
 * drops the Candidate's settings, hooks, and skills; `strictMcpConfig` and
 * `ENABLE_CLAUDEAI_MCP_SERVERS=false` drop account connectors, so only the app's MCP tools and
 * the allowed web tools remain. The mode is set explicitly because user settings may default to `auto`.
 */
export function claudeProfile(ctx: ProfileContext): AcpProfile {
  return {
    agent: "claude",
    defaultMode: "default",
    launch: () => ({
      command: process.execPath,
      args: [adapterEntry("@agentclientprotocol/claude-agent-acp", "claude-agent-acp")],
      env: agentEnv(ctx.env, { ENABLE_CLAUDEAI_MCP_SERVERS: "false" }),
      cwd: ctx.workDir,
    }),
    sessionParams: (config) => ({
      systemPrompt: { mode: "override", content: [{ type: "text", text: config.persona }] },
      _meta: {
        claudeCode: {
          options: {
            tools: config.allowedBuiltins.map((b) => claudeBuiltins[b]),
            settingSources: [],
            strictMcpConfig: true,
            env: { ENABLE_CLAUDEAI_MCP_SERVERS: "false" },
          },
        },
      },
    }),
  };
}

/** Codex features switched off so the agent keeps no shell and as few inherited tools as config allows. */
const codexDisabledFeatures = [
  "shell_tool",
  "unified_exec",
  "apps",
  "plugins",
  "remote_plugin",
  "multi_agent",
  "goals",
  "image_generation",
  "view_image",
  "browser_use",
  "browser_use_external",
  "computer_use",
  "in_app_browser",
  "hooks",
  "skill_search",
  "tool_suggest",
  "sleep_tool",
  "code_mode_host",
  "workspace_dependencies",
  "skill_mcp_dependency_install",
  "default_mode_request_user_input",
];

/**
 * Codex: the base prompt is replaced only per process (`model_instructions_file` in
 * `CODEX_CONFIG`), so each persona gets its own process; the persona is also appended per
 * session. The sandbox is read-only and the shell is off. Codex still inherits `~/.codex`
 * (global AGENTS.md, user MCP servers): see ADR-0007.
 */
export function codexProfile(ctx: ProfileContext): AcpProfile {
  return {
    agent: "codex",
    launch: (config) => {
      const instructions = writeOnce(path.join(ctx.stateDir, "codex"), "instructions", config.persona);
      const codexConfig = {
        model_instructions_file: instructions,
        developer_instructions: config.persona,
        sandbox_mode: "read-only",
        approval_policy: "on-request",
        web_search: config.allowedBuiltins.includes("web_search") ? "live" : "disabled",
        project_doc_max_bytes: 0,
        features: Object.fromEntries(codexDisabledFeatures.map((f) => [f, false])),
      };
      return {
        command: process.execPath,
        args: [adapterEntry("@agentclientprotocol/codex-acp", "codex-acp")],
        env: agentEnv(ctx.env, { CODEX_CONFIG: JSON.stringify(codexConfig) }),
        cwd: ctx.workDir,
      };
    },
    sessionParams: (config) => ({ _meta: { jetbrains: { air: { customInstructions: config.persona } } } }),
  };
}

const opencodeBuiltins: Record<AllowedBuiltin, string> = { web_fetch: "webfetch", web_search: "websearch" };
const opencodeAgent = "interviewer";

/**
 * OpenCode: one process per persona with a primary custom agent defined in
 * `OPENCODE_CONFIG_CONTENT`; permissions deny everything except the app's MCP tools and the
 * allowed web tools. The model comes from `set_config_option`, since the global default
 * overrides `agent.model`.
 */
export function opencodeProfile(ctx: ProfileContext): AcpProfile {
  return {
    agent: "opencode",
    defaultMode: opencodeAgent,
    launch: (config): LaunchSpec => ({
      command: ctx.opencodeCommand ?? "opencode",
      args: ["acp", "--cwd", ctx.workDir],
      env: agentEnv(ctx.env, { OPENCODE_CONFIG_CONTENT: JSON.stringify(opencodeConfig(config)) }),
      cwd: ctx.workDir,
    }),
    sessionParams: () => ({}),
  };
}

export function opencodeConfig(config: SessionConfig): Record<string, unknown> {
  const permission: Record<string, string> = { "*": "deny" };
  for (const builtin of config.allowedBuiltins) permission[opencodeBuiltins[builtin]] = "allow";
  for (const server of config.mcpServers) permission[`${server.name}_*`] = "allow";
  return {
    $schema: "https://opencode.ai/config.json",
    default_agent: opencodeAgent,
    agent: {
      [opencodeAgent]: {
        description: "Interviewer persona of prepare-to-interview",
        mode: "primary",
        prompt: config.persona,
        permission,
        tools: Object.fromEntries(
          ["bash", "edit", "write", "read", "grep", "glob", "list", "patch", "todowrite", "todoread", "task", "skill"].map(
            (t) => [t, false],
          ),
        ),
      },
    },
  };
}

export function createProfile(agent: AgentId, ctx: ProfileContext): AcpProfile {
  switch (agent) {
    case "claude":
      return claudeProfile(ctx);
    case "codex":
      return codexProfile(ctx);
    case "opencode":
      return opencodeProfile(ctx);
  }
}

/** Writes content to a file named by its hash, once, and returns the path. */
function writeOnce(dir: string, prefix: string, content: string): string {
  const hash = crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
  const file = path.join(dir, `${prefix}-${hash}.md`);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, content.endsWith("\n") ? content : content + "\n", { mode: 0o600 });
  }
  return file;
}
