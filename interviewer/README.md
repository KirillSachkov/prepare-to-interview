# Interviewer content

Plain-file product content the app loads into Agent sessions (ADR-0002), kept in English and
outside code so the method can improve without code changes:

- `persona.md`: the Interviewer persona, sent as the system prompt of every Agent session.
- `skills/<activity>/SKILL.md`: one skill per Activity (`onboarding` now; `research`, `interview`,
  and `review` arrive with their Activities). The app sends the running Activity's skill to the
  agent once per Agent session, as a hidden block `app://skill/<activity>`.
- `references/`: shared references: `rubric.md` (the 0–3 Rubric), `modes.md` (training and mock),
  and `market/ru.md` (the Market guide for the Russian-speaking market, a stub until Research).
