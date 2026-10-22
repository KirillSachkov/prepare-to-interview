# prepare-to-interview

A local app for technical interview practice in IT. Your own coding agent (Claude Code, Codex, or OpenCode, on your existing subscription) becomes a personal interviewer: it researches questions for the position you target, gives you practice sets and mock interviews on an interactive canvas, grades your answers, and tracks which topics you have mastered and which need repetition.

> **Status:** early development. The app starts and shows a Canvas; interview features are not built yet.

## How it will work

- **Setup.** Tell the agent which positions you prepare for, share vacancies and your own materials; it researches topics and questions and you approve what enters your question bank.
- **Practice.** Questions appear as cards on the canvas. Answer them whenever you like and submit together, or run a live mock interview with follow-up questions.
- **Progress.** Every answer is graded on a 0–3 rubric; a skill map shows your mastery by topic and what is due for repetition.

Everything runs locally: `pnpm start`, then open `localhost`. No model API keys; your data stays in `~/.prepare-to-interview/`.

## Run it

Requirements: Node.js 24 or newer and pnpm 12.

```sh
pnpm install
pnpm start
```

`pnpm start` builds the client, starts the server on `127.0.0.1`, and prints a URL with an access token. Open that URL; the browser keeps the token in a cookie afterwards. The token is generated on first start and stored in the data directory.

Configuration (environment variables):

- `PREPARE_TO_INTERVIEW_HOME`: data directory (default `~/.prepare-to-interview/`), holding the SQLite database and the token.
- `PREPARE_TO_INTERVIEW_PORT`: port (default `4747`).

## Development

```sh
pnpm --filter @prepare-to-interview/e2e exec playwright install chromium   # once
pnpm check
```

`pnpm check` runs the tests (Vitest), lint (ESLint), type check (`tsc`), and the browser end-to-end tests (`pnpm e2e`: Playwright, headless Chromium) across the workspace. The e2e tests build the client and start the server with a throwaway data directory; agent-side changes go through the fake agent driver. Packages: `packages/server` (HTTP, WebSocket, MCP server, SQLite storage, agent drivers), `packages/client` (React Flow Canvas), `packages/shared` (API types), `packages/e2e` (Playwright scenarios). Interviewer persona and skills live in `interviewer/`. After changing `packages/server/src/db/schema.ts`, run `pnpm --filter @prepare-to-interview/server db:generate` to add a migration.

## Documentation

- [project-brief.md](project-brief.md): product idea and MVP scope (in Russian)
- [GLOSSARY.md](GLOSSARY.md): domain language
- [docs/adr/](docs/adr/): architecture decisions

## Contributing

Issues and pull requests are welcome. Use the terms from `GLOSSARY.md`, and if a change contradicts an ADR, explain why in the pull request.

## License

[MIT](LICENSE)
