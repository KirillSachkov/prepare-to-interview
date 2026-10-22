import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, type RunningServer } from "../src/server.ts";

export const testIndexHtml = "<!doctype html><title>canvas test</title><div id=root></div>";

/** Creates an isolated data directory and a stand-in client build. Never touches the real home. */
export function makeTempDirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pti-test-"));
  const dataDir = path.join(root, "data");
  const clientDir = path.join(root, "client");
  fs.mkdirSync(clientDir);
  fs.writeFileSync(path.join(clientDir, "index.html"), testIndexHtml);
  return {
    dataDir,
    clientDir,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

export async function startTestServer(dirs = makeTempDirs()): Promise<{
  server: RunningServer;
  dirs: ReturnType<typeof makeTempDirs>;
}> {
  const server = await startServer({ dataDir: dirs.dataDir, clientDir: dirs.clientDir, port: 0 });
  return { server, dirs };
}

export function authHeaders(server: RunningServer): Record<string, string> {
  return { Authorization: `Bearer ${server.token}` };
}
