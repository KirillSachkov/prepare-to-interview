// The app server for end-to-end tests: the built client, a throwaway data directory, a fixed port,
// and the fake agent driver instead of real coding agents. Playwright starts it (see
// playwright.config.ts). Tests drive agent-side changes with the fake driver against the MCP
// endpoint, the same path a real agent takes.
import { FakeDriver, type FakeResponder } from "@prepare-to-interview/server/agent/fake-driver";
import { startServer } from "@prepare-to-interview/server/server";
import { agentIds, agentLabels } from "@prepare-to-interview/shared";
import { e2eEnv } from "./env.ts";

const { dataDir, port } = e2eEnv();

/**
 * The Grader's side of the fake agent: every open answer gets 2 of 3, quoting the answer's first
 * sentence, so tests see scores, quotes, and feedback arrive on Cards.
 */
const grader: FakeResponder = (config, input) => {
  if (!config.persona.startsWith("# Grader")) return undefined;
  const answer = /<answer>\n([\s\S]*?)\n<\/answer>/.exec(input.text)?.[1] ?? "";
  const quote = answer.split(/(?<=[.!?])\s/)[0] ?? answer;
  const verdict = { score: 2, quote, right: "Ключевая идея названа.", gap: "Не хватает проверки на метриках." };
  return [{ event: { type: "message_chunk", text: JSON.stringify(verdict) } }];
};
const server = await startServer({
  dataDir,
  port,
  // Every agent reads as installed, and none is chosen until a test picks one.
  detectAgents: () => agentIds.map((id) => ({ id, label: agentLabels[id], installed: true, detail: `/e2e/${id}` })),
  drivers: () => new FakeDriver([], { respond: grader }),
});
console.log(`e2e server ready on ${String(server.port)}, data in ${dataDir}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void server.close().then(() => process.exit(0));
  });
}
