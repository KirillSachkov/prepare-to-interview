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
  try {
    const existing = fs.readFileSync(file, "utf8").trim();
    if (existing) return existing;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const token = crypto.randomBytes(32).toString("base64url");
  fs.writeFileSync(file, token + "\n", { mode: 0o600 });
  return token;
}
