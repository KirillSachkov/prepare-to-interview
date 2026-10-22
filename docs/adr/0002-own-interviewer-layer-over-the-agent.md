# The app controls the Interviewer, not files in the agent's working directory

The app treats the coding agent as an engine and owns the Interviewer itself. Per Agent session it sets the persona (replace or append the system prompt through each adapter's mechanism), restricts built-in tools to the app's MCP tools plus web search and fetch where the agent allows it, loads the skill for the current Activity, and attaches a hidden state block to every turn. The server owns the flow of every Activity and all arithmetic (scheduling, Mastery); the agent conducts the conversation and judges answers.

Agent sessions are internal. The app ends one at each Activity boundary (onboarding done, Research batch done, Practice set graded, Mock interview finished) and as a safeguard on a new day or a long conversation; the agent records a summary, and the next session starts from a Briefing. Open answers are graded by a separate Grader session that sees only the Question, Reference answer, Rubric anchors, and the answer; the Chat receives a short result summary.

## Consequences

- Adapters differ: Claude allows per-session prompt replacement and an exact tool allowlist; Codex appends per session (replacement needs a separate process) and only coarse tool modes; OpenCode replaces through a custom agent in config. Data integrity therefore rests on MCP schema validation, not on the tool allowlist.
- Hidden state blocks can return through `session/load`; the UI filters them out.
- Agent sessions inherit parts of the Candidate's global agent configuration. Claude drops user settings, hooks, skills, and claude.ai connectors (`settingSources: []`, `strictMcpConfig`, `ENABLE_CLAUDEAI_MCP_SERVERS=false`), though the spike saw user slash commands in `available_commands_update`. Codex inherits `~/.codex`: the global `AGENTS.md`, user MCP servers, skills, and plugins (ADR-0007). OpenCode takes its default model and providers from the global config, so the app sets the model per session. The persona, the per-turn hidden state, and MCP validation keep the Interviewer on track despite this.
