import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface DataDir {
  root: string;
  databaseFile: string;
  token: string;
}

/**
 * Prepares the data directory and returns the access token, generating it on first start.
 * The directory and the token file are readable by the owner only.
 */
export function openDataDir(root: string): DataDir {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  return { root, databaseFile: path.join(root, "app.db"), token: loadOrCreateToken(path.join(root, "token")) };
}

function loadOrCreateToken(file: string): string {
  const existing = readToken(file);
  if (existing) return existing;
  // Write the token to a private temp file, then link it into place: the token file is never
  // observed empty, and if another process starting at the same time wins, its token is used.
  const token = crypto.randomBytes(32).toString("base64url");
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, token + "\n", { mode: 0o600 });
  try {
    fs.linkSync(temp, file);
    return token;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const winner = readToken(file);
    if (winner) return winner;
    // An empty or blank token file (for example after a crash) is replaced.
    fs.renameSync(temp, file);
    return token;
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

function readToken(file: string): string | undefined {
  try {
    return fs.readFileSync(file, "utf8").trim() || undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
