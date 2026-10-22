import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CanvasSnapshot, DemoNoteNode } from "@prepare-to-interview/shared";
import { startServer, type RunningServer, type ServerOptions } from "../src/server.ts";

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

export async function startTestServer(
  dirs = makeTempDirs(),
  options: Partial<ServerOptions> = {},
): Promise<{
  server: RunningServer;
  dirs: ReturnType<typeof makeTempDirs>;
}> {
  const server = await startServer({ dataDir: dirs.dataDir, clientDir: dirs.clientDir, port: 0, ...options });
  return { server, dirs };
}

/** The demo notes in a snapshot, without the Chat node every Canvas has. */
export function demoNotes(snapshot: CanvasSnapshot): DemoNoteNode[] {
  return snapshot.nodes.filter((n) => n.kind === "demo_note");
}

export function authHeaders(server: RunningServer): Record<string, string> {
  return { Authorization: `Bearer ${server.token}` };
}
