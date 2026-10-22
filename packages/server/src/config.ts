import os from "node:os";
import path from "node:path";

export const dataDirEnv = "PREPARE_TO_INTERVIEW_HOME";
export const portEnv = "PREPARE_TO_INTERVIEW_PORT";
export const defaultPort = 4747;

/** The only interface the server binds to: the app drives the Candidate's agent and must stay local. */
export const loopbackHost = "127.0.0.1";

type Env = Record<string, string | undefined>;

/** User data lives outside the repository so cloning, updating, or deleting it never loses progress. */
export function resolveDataDir(env: Env = process.env): string {
  const override = env[dataDirEnv]?.trim();
  return override ? path.resolve(override) : path.join(os.homedir(), ".prepare-to-interview");
}

export function resolvePort(env: Env = process.env): number {
  const raw = env[portEnv]?.trim();
  if (!raw) return defaultPort;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`${portEnv} must be an integer port between 0 and 65535, got "${raw}"`);
  }
  return port;
}
