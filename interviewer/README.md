# Interviewer content

Plain-file product content the app loads into Agent sessions (ADR-0002), kept in English and
outside code so the method can improve without code changes:

- `persona.md`: the Interviewer persona, sent as the system prompt of every Chat Agent session.
- `grader.md`: the Grader persona for the hidden Agent session that grades one open answer;
  `references/rubric.md` is appended to it.
- `skills/<skill>/SKILL.md`: one skill per Activity (`onboarding`, `practice_set`, `interview`
  for the `mock_interview` Activity, and `review`, which the app starts at every Activity
  boundary; `research` arrives with its Activity). The app sends the running Activity's skill to
  the agent once per Agent session, as a hidden block `app://skill/<activity>`; the
  `practice_set` skill arrives with `references/rubric.md` and `references/modes.md` appended, the
  `interview` skill with `references/modes.md`.
- `references/`: shared references: `rubric.md` (the 0–3 Rubric), `modes.md` (training and mock),
  and `market/ru.md` (the Market guide for the Russian-speaking market, a stub until Research).
