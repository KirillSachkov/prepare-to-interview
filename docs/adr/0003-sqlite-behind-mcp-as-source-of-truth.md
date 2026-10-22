# SQLite behind the app's MCP server is the source of truth

Everything with a schema (Preparation targets, Candidate profile, Decision log, Question bank, Sources, Attempts, scheduling state, Agent session transcripts and summaries) lives in SQLite with FTS5 search. The agent reads and writes it only through the app's MCP tools, which validate input and compute derived values. Research prose follows an LLM-wiki layout in Markdown: an immutable archive of raw Sources and agent-maintained notes with source links, indexed into the same FTS.

User data lives outside the repository in `~/.prepare-to-interview/` (overridable by an environment variable), so cloning, updating, or deleting the repo never touches it.

## Considered options

- **Agent-edited Markdown or JSON files**: comparable tutor tools ended up adding hooks to stop the agent from inventing fields and miscomputing schedules.
- **Vector RAG or memory services (mem0, Zep, Letta)**: unnecessary for a bank of hundreds to a few thousand items and heavy for a local single-user app. Tables stay ready for adding `sqlite-vec` if FTS misses synonyms in practice.
