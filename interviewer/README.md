# Interviewer content

Plain-file product content the app loads into Agent sessions (ADR-0002), kept in English and
outside code so the method can improve without code changes:

- `persona.md`: the Interviewer persona, sent as the system prompt of every Agent session.
- `skills/<activity>/`: one skill per Activity (`onboarding`, `research`, `interview`, `review`).
- `references/`: shared references such as `rubric.md`, `modes.md`, and `market/ru.md`.

Skills and references arrive with the Activity tickets.
