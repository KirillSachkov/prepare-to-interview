# prepare-to-interview

A local app for technical interview practice in IT. Your own coding agent (Claude Code, Codex, or OpenCode, on your existing subscription) becomes a personal interviewer: it researches questions for the position you target, gives you practice sets and mock interviews on an interactive canvas, grades your answers, and tracks which topics you have mastered and which need repetition.

> **Status:** MVP. Onboarding, Research, Practice sets and Quizzes, Mock interviews, grading, the Skill map, and history work end to end on Claude Code and Codex; OpenCode is supported but less tested.

## What it does

- **Onboarding.** The Interviewer asks about the position you prepare for (role, stack, grade, vacancies, interview date), calibrates your level, and saves a Preparation target with its Topics. «+ Новая цель» in the Control panel adds another one.
- **Research.** On request («Исследовать», R) a background Research batch reads vacancies, the web, and your pasted materials, archives its Sources, and proposes Topics and Questions. They enter your Question bank only after you approve them in the Skill map («Предложено», B). If you ask the Interviewer to approve something, it shows a confirmation in the Chat first.
- **Practice.** Questions appear as Cards on the Canvas. A Practice set is answered in any order and submitted together; a Quiz of test Questions is checked instantly. Open answers are graded 0–3 by a separate Grader session against a Reference answer; hints lower the maximum score; Skipped is not a 0. Discuss any Card in the Chat («Обсудить») and dispute a grade there; the Interviewer can point at a Card or a Topic and the app brings it into view.
- **Mock interview.** The Interviewer places Cards one at a time with follow-ups and a timer; grades appear only at the end.
- **Progress.** Mastery per Topic, Due Questions (Leitner repetition), and readiness per target in the Control panel and the Skill map (K). Graded sets collapse into result Cards and move to «История» on a new set or a new day.
- **Continuity.** One continuous Chat; the app ends the agent's internal sessions at Activity boundaries after a short review and starts the next one from a Briefing. Profile and decision updates from a review are saved only when you confirm them.

Everything runs locally: `pnpm start`, then open the printed URL. No model API keys; your data stays in `~/.prepare-to-interview/`.

## Run it

Requirements: Node.js 24 or newer and pnpm 12.

```sh
pnpm install
pnpm start
```

`pnpm start` builds the client, starts the server on `127.0.0.1`, and prints a URL with an access token. Open that URL; the browser keeps the token in a cookie afterwards. The token is generated on first start and stored in the data directory.

The Canvas shows the Chat with the Interviewer. Pick your agent with the **Agent** button in the Chat header: the app lists Claude Code, Codex, and OpenCode and enables the ones it finds on your `PATH`. It uses the agent's own login and subscription (log in with `claude`, `codex login`, or `opencode auth login` first); OpenCode runs on the provider you configured in it, since OpenCode Zen free models do not work for third-party apps. The model field is optional. The Chat history and the agent's session survive a restart.

Configuration (environment variables):

- `PREPARE_TO_INTERVIEW_HOME`: data directory (default `~/.prepare-to-interview/`), holding the SQLite database and the token.
- `PREPARE_TO_INTERVIEW_PORT`: port (default `4747`).

## Development

```sh
pnpm --filter @prepare-to-interview/e2e exec playwright install chromium   # once
pnpm check
```

`pnpm check` runs the tests (Vitest), lint (ESLint), type check (`tsc`), and the browser end-to-end tests (`pnpm e2e`: Playwright, headless Chromium) across the workspace. Tests use a fake agent driver; the e2e tests build the client and start the server with a throwaway data directory and the fake driver on port 47490 (set `PTI_E2E_PORT` to use another).

To check a real agent, run `pnpm smoke <claude|codex|opencode> [--model <id>] [--keep]`. It starts the app on a temporary data directory and checks the persona, the hidden state (the reply language), an app MCP tool call (`add_question`), the tool allowlist, resume after a restart, and stop. It uses a cheap model by default but still spends a little of the agent's limits.

Packages: `packages/server` (HTTP, WebSocket, MCP server, SQLite storage, agent drivers), `packages/client` (React Flow Canvas), `packages/shared` (API types), `packages/e2e` (Playwright scenarios). Interviewer persona and skills live in `interviewer/`. After changing `packages/server/src/db/schema.ts`, run `pnpm --filter @prepare-to-interview/server db:generate` to add a migration.

## Security notes

- The server listens on `127.0.0.1` only and needs the access token (a cookie after the first visit); the data directory is readable by you only.
- Agent sessions get their own MCP tokens, which open only the app's MCP tools, never the REST API.
- The agent runs with your normal login. Codex also loads your `~/.codex` (global `AGENTS.md`, MCP servers, plugins; see ADR-0007), and those MCP servers can act outside the app. The app passes your environment to the agent, including cloud credentials such as `AWS_*` or `GOOGLE_*` that Claude Code needs for Bedrock or Vertex; start the app from a shell without credentials you do not want the agent to see.

## Documentation

- [project-brief.md](project-brief.md): product idea and MVP scope (in Russian)
- [GLOSSARY.md](GLOSSARY.md): domain language
- [docs/adr/](docs/adr/): architecture decisions

## Contributing

Issues and pull requests are welcome. Use the terms from `GLOSSARY.md`, and if a change contradicts an ADR, explain why in the pull request.

## License

[MIT](LICENSE)
