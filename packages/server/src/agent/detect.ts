import fs from "node:fs";
import path from "node:path";
import { agentIds, agentLabels, type AgentAvailability, type AgentId } from "@prepare-to-interview/shared";
import { installHint } from "./errors.ts";

/** The command each supported agent installs. Claude and Codex run through pinned ACP adapters that
 * share the CLI's login, so the CLI on PATH is the sign that the Candidate uses that agent. */
const commands: Record<AgentId, string> = { claude: "claude", codex: "codex", opencode: "opencode" };

export type AgentDetector = () => AgentAvailability[];

/** Finds installed agents by looking up their commands on PATH (no shell, no agent started). */
export function detectInstalledAgents(env: NodeJS.ProcessEnv = process.env): AgentAvailability[] {
  return agentIds.map((id) => {
    const found = findOnPath(commands[id], env);
    return { id, label: agentLabels[id], installed: found !== undefined, detail: found ?? installHint(id) };
  });
}

export function findOnPath(command: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const extensions = process.platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of (env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of extensions) {
      const candidate = path.join(dir, command + ext);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        // not here
      }
    }
  }
  return undefined;
}
