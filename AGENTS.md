# Agent instructions

Open-source, locally run app for technical interview practice: the Candidate's own coding agent acts as the Interviewer, and a Canvas shows what is mastered and what needs repetition.
Read [project-brief.md](project-brief.md) for the product idea and MVP scope.

## Domain docs

Single-context: [GLOSSARY.md](GLOSSARY.md) defines the domain language; name concepts with its terms.
[docs/adr/](docs/adr/) records architecture decisions; when your work contradicts an ADR, say so explicitly instead of silently overriding it.

## Maintainer workflow

A maintainer checkout also holds a git-ignored development harness ([ADR-0006](docs/adr/0006-maintainer-harness-stays-out-of-the-repo.md)).
When `WORKFLOW.md` exists, read it before assigned project work: it sets session mode, checks, and delivery gates.

### Issue tracker

GitHub Issues of `KirillSachkov/prepare-to-interview`. Maintainer details: `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). Maintainer details: `docs/agents/triage-labels.md`.
