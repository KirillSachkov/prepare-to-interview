# Interviewer content

Plain-file product content the app loads into Agent sessions (ADR-0002), kept in English and
outside code so the method can improve without code changes:

- `persona.md`: the Interviewer persona, sent as the system prompt of every Chat Agent session.
- `grader.md`: the Grader persona for the hidden Agent session that grades one open answer;
  `references/rubric.md` is appended to it.
- `skills/<activity>/SKILL.md`: one skill per Activity (`onboarding`, `practice_set`, and
  `research` now; `interview` and `review` arrive with their Activities). The app sends the running
  Activity's skill to the agent once per Agent session, as a hidden block `app://skill/<activity>`;
  the `practice_set` skill arrives with `references/rubric.md` and `references/modes.md` appended.
  `research` is different: a Research batch runs in its own hidden Agent session whose system
  prompt is `skills/research/SKILL.md` with `references/market/ru.md` and `references/rubric.md`.
- `references/`: shared references: `rubric.md` (the 0–3 Rubric), `modes.md` (training and mock),
  and `market/ru.md` (the Market guide for the Russian-speaking market: where Research looks and
  how it weighs Sources).
