# Interviewer content

Plain-file product content the app loads into Agent sessions (ADR-0002), kept in English and
outside code so the method can improve without code changes:

- `persona.md`: the Interviewer persona, sent as the system prompt of every Chat Agent session.
- `grader.md`: the Grader persona for the hidden Agent session that grades one open answer;
  `references/rubric.md` is appended to it.
- `skills/<activity>/SKILL.md`: one skill per Activity (`onboarding` and `practice_set` now;
  `research`, `interview`, and `review` arrive with their Activities). The app sends the running
  Activity's skill to the agent once per Agent session, as a hidden block `app://skill/<activity>`;
  the `practice_set` skill arrives with `references/rubric.md` and `references/modes.md` appended.
- `references/`: shared references: `rubric.md` (the 0–3 Rubric), `modes.md` (training and mock),
  and `market/ru.md` (the Market guide for the Russian-speaking market, a stub until Research).
