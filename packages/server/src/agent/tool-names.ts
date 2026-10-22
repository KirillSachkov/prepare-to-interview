/** An MCP tool call resolved to the app's server and tool name. */
export interface McpToolRef {
  server: string;
  tool: string;
}

/**
 * Resolves an agent's tool name to an MCP server and tool. Agents name the same tool differently:
 * Claude `mcp__interview__record_attempt`, Codex `mcp.interview.record_attempt` (or
 * `interview/record_attempt`), OpenCode `interview_record_attempt`. Only the given server names
 * match, so a built-in tool such as `WebFetch` never resolves.
 */
export function matchMcpTool(names: readonly (string | null | undefined)[], servers: readonly string[]): McpToolRef | undefined {
  for (const raw of names) {
    if (!raw) continue;
    const name = raw.trim().replace(/^(tool|mcp tool):\s*/i, "");
    for (const server of servers) {
      for (const prefix of [`mcp__${server}__`, `mcp.${server}.`, `mcp:${server}:`, `${server}/`, `${server}.`, `${server}_`]) {
        if (name.startsWith(prefix) && name.length > prefix.length) {
          const tool = name.slice(prefix.length).split(/\s/, 1)[0] ?? "";
          if (tool) return { server, tool };
        }
      }
    }
  }
  return undefined;
}
