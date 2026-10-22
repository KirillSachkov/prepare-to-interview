import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const homeEnv = "PTI_E2E_HOME";
const portEnv = "PTI_E2E_PORT";

/**
 * Where the e2e server keeps its data and listens. The Playwright runner creates the directory
 * once; the server and test workers inherit it through the environment.
 */
export function e2eEnv(): { dataDir: string; port: number } {
  process.env[homeEnv] ??= fs.mkdtempSync(path.join(os.tmpdir(), "pti-e2e-"));
  process.env[portEnv] ??= "47490";
  return { dataDir: process.env[homeEnv], port: Number(process.env[portEnv]) };
}
