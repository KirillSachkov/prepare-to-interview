// The app server for end-to-end tests: the built client, a throwaway data directory, a fixed port,
// and the fake agent driver instead of real coding agents. Playwright starts it (see
// playwright.config.ts). Tests drive agent-side changes with the fake driver against the MCP
// endpoint, the same path a real agent takes.
import { FakeDriver } from "@prepare-to-interview/server/agent/fake-driver";
import { startServer } from "@prepare-to-interview/server/server";
import { agentIds, agentLabels } from "@prepare-to-interview/shared";
import { e2eEnv } from "./env.ts";

const { dataDir, port } = e2eEnv();
const server = await startServer({
  dataDir,
  port,
  // Every agent reads as installed, and none is chosen until a test picks one.
  detectAgents: () => agentIds.map((id) => ({ id, label: agentLabels[id], installed: true, detail: `/e2e/${id}` })),
  drivers: () => new FakeDriver([]),
});
console.log(`e2e server ready on ${String(server.port)}, data in ${dataDir}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void server.close().then(() => process.exit(0));
  });
}
