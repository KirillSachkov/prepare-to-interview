// The app server for end-to-end tests: the built client, a throwaway data directory, a fixed port.
// Playwright starts it (see playwright.config.ts); tests drive agent-side changes with the fake
// driver against its MCP endpoint, the same path a real agent takes.
import { startServer } from "@prepare-to-interview/server/server";
import { e2eEnv } from "./env.ts";

const { dataDir, port } = e2eEnv();
const server = await startServer({ dataDir, port });
console.log(`e2e server ready on ${String(server.port)}, data in ${dataDir}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void server.close().then(() => process.exit(0));
  });
}
