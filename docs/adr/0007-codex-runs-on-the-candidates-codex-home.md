# Codex runs on the Candidate's own `~/.codex`, not an app-owned `CODEX_HOME`

The Codex driver starts `codex-acp` with the Candidate's normal Codex home, so it uses the existing ChatGPT login with no extra step. An app-owned `CODEX_HOME` would give an exact tool set and stop the global `~/.codex/AGENTS.md`, user MCP servers, and plugins from leaking into Agent sessions, but it needs a second `codex login`, and copying or linking `auth.json` is unsafe because refresh tokens rotate. We accept the leak: the persona replaces the base prompt through `model_instructions_file` and is appended per session, the hidden state sets the reply language every turn, the sandbox is read-only with the shell and most features off, and data integrity rests on MCP validation (ADR-0002).

## Consequences

- Codex may still offer inherited tools such as `apply_patch`, `node_repl`, or user MCP servers; they cannot change app data, which goes only through the app's MCP tools.
- A Candidate who wants isolation can set `CODEX_HOME` to a separate directory, run `codex login` there once, and start the app with the same `CODEX_HOME`; the app passes the variable through. Revisit an app-managed isolated home if inherited instructions visibly derail the Interviewer.
