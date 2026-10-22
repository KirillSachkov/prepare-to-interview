# prepare-to-interview

A local app for technical interview practice in IT. Your own coding agent (Claude Code, Codex, or OpenCode, on your existing subscription) becomes a personal interviewer: it researches questions for the position you target, gives you practice sets and mock interviews on an interactive canvas, grades your answers, and tracks which topics you have mastered and which need repetition.

> **Status:** design stage. There is no runnable code yet.

## How it will work

- **Setup.** Tell the agent which positions you prepare for, share vacancies and your own materials; it researches topics and questions and you approve what enters your question bank.
- **Practice.** Questions appear as cards on the canvas. Answer them whenever you like and submit together, or run a live mock interview with follow-up questions.
- **Progress.** Every answer is graded on a 0–3 rubric; a skill map shows your mastery by topic and what is due for repetition.

Everything runs locally: `pnpm start`, then open `localhost`. No model API keys; your data stays in `~/.prepare-to-interview/`.

## Documentation

- [project-brief.md](project-brief.md): product idea and MVP scope (in Russian)
- [GLOSSARY.md](GLOSSARY.md): domain language
- [docs/adr/](docs/adr/): architecture decisions

## Contributing

Issues and pull requests are welcome. Use the terms from `GLOSSARY.md`, and if a change contradicts an ADR, explain why in the pull request.

## License

[MIT](LICENSE)
