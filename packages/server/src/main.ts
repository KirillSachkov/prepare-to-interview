import { resolveDataDir, resolvePort } from "./config.ts";
import { startServer } from "./server.ts";

const dataDir = resolveDataDir();
const server = await startServer({ dataDir, port: resolvePort() });

console.log(`prepare-to-interview is running. Data directory: ${dataDir}`);
console.log(`Open in your browser: ${server.url}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void server.close().then(() => process.exit(0));
  });
}
