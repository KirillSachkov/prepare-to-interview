# Drive the Candidate's installed coding agent over ACP

The app runs on the Candidate's own subscription to an installed coding agent (Claude Code, Codex, OpenCode) and never asks for model API keys. A local Node server launches the agent through the Agent Client Protocol (`@agentclientprotocol/sdk` with the `claude-agent-acp` and `codex-acp` adapters, `opencode acp` natively), passes the app's MCP server at session creation, and renders the stream in its own chat. Adapter versions are pinned because ACP and the adapters change almost daily. An internal agent-driver interface keeps a direct per-agent integration (as in Orca: `claude` stream-json, `codex app-server`) available as a fallback.

The owner accepted the risk that Anthropic's policy on third-party apps using Claude subscription login is ambiguous for this setup; the project targets personal local use.

## Considered options

- **Own agent loop over model APIs**: requires API keys and paid usage, which the project rules out.
- **Embedded PTY terminal running the agent's TUI**: policy-clean and agent-agnostic, but the chat cannot be shaped into the app's interface.
- **Headless CLI drivers per agent**: works, but every agent needs its own driver for streaming, resume, and permissions, which is the session-management code ACP already provides.
