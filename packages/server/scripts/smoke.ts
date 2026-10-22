// Manual smoke test against a real coding agent (outside `pnpm check`: it needs the agent's
// login and spends its limits). Runs the app on a temporary data directory and talks to the
// Interviewer through the same HTTP API the browser uses.
//
// Usage: pnpm smoke <claude|codex|opencode> [--model <id>] [--keep]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  agentIds,
  apiPaths,
  bankPaths,
  type AgentId,
  type AgentsResponse,
  type BankResponse,
  type ChatMessage,
  type ChatSnapshot,
} from "@prepare-to-interview/shared";
import { startServer, type RunningServer } from "../src/server.ts";

/** Cheap models by default to spare the Candidate's limits. */
const defaultModels: Record<AgentId, string | undefined> = {
  claude: "haiku",
  codex: "gpt-5.6-luna",
  opencode: "deepseek/deepseek-flash",
};
const turnTimeoutMs = 240_000;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { model: { type: "string" }, keep: { type: "boolean", default: false } },
});
const agent = positionals[0] as AgentId | undefined;
if (!agent || !agentIds.includes(agent)) {
  console.error(`Usage: pnpm smoke <${agentIds.join("|")}> [--model <id>] [--keep]`);
  process.exit(2);
}
const model = values.model ?? defaultModels[agent];

type Outcome = "PASS" | "FAIL" | "BLOCKED";
const results: { step: string; outcome: Outcome; note: string }[] = [];
const report = (step: string, outcome: Outcome, note: string) => {
  results.push({ step, outcome, note });
  console.log(`[${outcome}] ${step}: ${note}`);
};

class Blocked extends Error {}

const root = fs.mkdtempSync(path.join(os.tmpdir(), `pti-smoke-${agent}-`));
const dataDir = path.join(root, "data");
const clientDir = path.join(root, "client");
fs.mkdirSync(clientDir);
fs.writeFileSync(path.join(clientDir, "index.html"), "<!doctype html><title>smoke</title>");

async function api(server: RunningServer, route: string, init: { method?: string; body?: unknown } = {}) {
  const res = await fetch(new URL(route, server.url), {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${server.token}`, "Content-Type": "application/json" },
    ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as unknown) : undefined };
}

const chat = async (server: RunningServer) => (await api(server, apiPaths.chat)).body as ChatSnapshot;

/** Sends a message and waits for the reply; a plain-language agent error becomes FAIL or BLOCKED. */
async function turn(server: RunningServer, text: string): Promise<ChatMessage> {
  const before = (await chat(server)).messages.length;
  const sent = await api(server, apiPaths.chatMessages, { method: "POST", body: { text } });
  if (sent.status !== 202) throw new Error(`send failed: ${sent.status} ${JSON.stringify(sent.body)}`);
  const started = Date.now();
  for (;;) {
    const snapshot = await chat(server);
    if (!snapshot.busy && snapshot.messages.length > before + 1) {
      const added = snapshot.messages.slice(before + 1);
      const notice = added.find((m) => m.role === "notice");
      if (notice) {
        if (/not logged in|usage limit/i.test(notice.text)) throw new Blocked(notice.text);
        throw new Error(notice.text);
      }
      const reply = added.find((m) => m.role === "interviewer");
      if (reply) return reply;
    }
    if (!snapshot.busy && Date.now() - started > 5_000 && snapshot.messages.length === before + 1) {
      throw new Error("the turn ended without a reply");
    }
    if (Date.now() - started > turnTimeoutMs) {
      await api(server, apiPaths.chatStop, { method: "POST" });
      throw new Error("timed out waiting for the reply");
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function step(name: string, run: () => Promise<string>): Promise<boolean> {
  try {
    report(name, "PASS", await run());
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    report(name, error instanceof Blocked ? "BLOCKED" : "FAIL", message);
    return false;
  }
}

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const code = `Smoke${Math.random().toString(36).slice(2, 7)}`;
const question = `${code}: what does a B-tree index speed up?`;
let server = await startServer({ dataDir, clientDir, port: 0 });
console.log(`Smoke test for ${agent}${model ? ` (model ${model})` : ""}; data in ${root}`);

try {
  const detected = await step("detect", async () => {
    const { agents } = (await api(server, apiPaths.agents)).body as AgentsResponse;
    const found = agents.find((a) => a.id === agent);
    if (!found?.installed) throw new Blocked(`${agent} is not installed: ${found?.detail ?? ""}`);
    const chosen = await api(server, apiPaths.agentSettings, { method: "PUT", body: { agent, model: model ?? null } });
    check(chosen.status === 200, `choosing the agent failed: ${JSON.stringify(chosen.body)}`);
    return found.detail;
  });

  if (detected) {
    const started = await step("persona", async () => {
      const reply = await turn(server, "Hi! Who are you? Introduce yourself in one short sentence.");
      check(/interviewer|интервьюер/i.test(reply.text), `no Interviewer persona in: ${reply.text}`);
      check(!/\b(claude|codex|opencode)\b/i.test(reply.text), `the agent named itself: ${reply.text}`);
      return reply.text.trim().slice(0, 160);
    });

    if (started) {
      // The hidden state sets the reply language (ru by default); the persona forbids quoting it, so
      // the step checks the behaviour: an English question gets a Russian answer.
      await step("hidden state", async () => {
        const reply = await turn(server, "What is a database index? Answer in two short sentences.");
        const letters = reply.text.match(/\p{L}/gu) ?? [];
        const cyrillic = letters.filter((l) => /\p{Script=Cyrillic}/u.test(l)).length;
        check(letters.length > 0 && cyrillic / letters.length > 0.5, `expected a reply in Russian, got: ${reply.text}`);
        check(!/session_state|hidden state/i.test(reply.text), `the reply mentions the hidden state: ${reply.text}`);
        return reply.text.trim().slice(0, 160);
      });

      await step("app MCP tool", async () => {
        const reply = await turn(
          server,
          `Please add my own question to the Question bank with the app's tool: topic "Smoke", prompt "${question}". Reply in one sentence.`,
        );
        const bank = (await api(server, bankPaths.bank)).body as BankResponse;
        check(bank.topics.some((t) => t.questions.some((q) => q.prompt.includes(code))), `no Question with "${code}" in the bank`);
        const call = reply.toolCalls.find((c) => c.tool === "add_question");
        check(call?.server === "interview", `tool call not matched by server and tool: ${JSON.stringify(reply.toolCalls)}`);
        return `Question added; agent named the tool "${call?.title ?? ""}"`;
      });

      await step("tool allowlist", async () => {
        const reply = await turn(
          server,
          "Please list the files in your current working directory and run the shell command `echo smoke`. " +
            "Use your tools; report what happened in one sentence, then list the exact names of all tools available to you.",
        );
        const foreign = reply.toolCalls.filter((c) => c.server !== "interview" && !/web|fetch|search/i.test(c.title));
        check(foreign.length === 0, `non-allowed tool calls: ${JSON.stringify(foreign)}`);
        return `no file or shell tool ran; agent reports: ${reply.text.replace(/\s+/g, " ").slice(0, 300)}`;
      });

      await step("resume after restart", async () => {
        await server.close();
        server = await startServer({ dataDir, clientDir, port: 0 });
        const history = await chat(server);
        check(history.messages.length >= 8, `history not reloaded: ${history.messages.length} messages`);
        check(!JSON.stringify(history).includes("session_state"), "hidden state leaked into the stored Chat");
        // The resumed Agent session remembers the conversation before the restart.
        const reply = await turn(server, "Which code word did the question I asked you to add to the bank start with? Answer with the code word only.");
        check(reply.text.includes(code), `expected "${code}", got: ${reply.text}`);
        return reply.text.trim();
      });

      await step("stop", async () => {
        const before = (await chat(server)).messages.length;
        const sent = await api(server, apiPaths.chatMessages, {
          method: "POST",
          body: { text: "Explain database indexing in great detail, at least 1500 words." },
        });
        check(sent.status === 202, "send failed");
        // Stop once the reply is streaming.
        const streaming = Date.now() + 120_000;
        while (!(await chat(server)).messages.slice(before).some((m) => m.role === "interviewer" && m.text)) {
          if (Date.now() > streaming) throw new Error("the reply did not start streaming");
          await new Promise((r) => setTimeout(r, 200));
        }
        await api(server, apiPaths.chatStop, { method: "POST" });
        const deadline = Date.now() + 60_000;
        while ((await chat(server)).busy) {
          if (Date.now() > deadline) throw new Error("the reply did not stop");
          await new Promise((r) => setTimeout(r, 300));
        }
        const reply = (await chat(server)).messages.slice(before).find((m) => m.role === "interviewer");
        check(reply?.status === "cancelled", `expected a cancelled reply, got ${reply?.status ?? "none"}`);
        return `reply stopped after ${reply?.text.length ?? 0} characters`;
      });
    }
  }
} finally {
  await server.close();
  if (!values.keep) fs.rmSync(root, { recursive: true, force: true });
}

console.log("\nSummary");
for (const r of results) console.log(`  ${r.outcome.padEnd(7)} ${r.step}`);
process.exit(results.some((r) => r.outcome === "FAIL") ? 1 : 0);
