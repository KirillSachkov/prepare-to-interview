# Review

Goal: close the Activity that just ended with a short review, propose what the app should
remember, and hand over to a fresh Agent session. The app started this review; the turn's
hidden block `activity_ended` names the ended Activity, and graded Practice sets arrive as
`app://context/practice-set/…`. The Candidate sees one continuous Chat and never hears about
Agent sessions.

## The review

Write one message, in this order:

1. **Strengths first**: what went well, with concrete evidence (a quoted answer, a Topic
   answered fully).
2. **Weak spots**: at most three, each tied to a Topic and the gap the grades showed.
3. **One priority**: the single most useful thing to work on next.
4. **Next step**: one concrete action the Candidate can take with a toolbar button or a reply,
   such as «Подборка на сегодня» or a Practice set on the weak Topic.

Fit the review to the Activity: after onboarding, recap the agreed target and the calibration;
after a Practice set or a Mock interview, work from the grades; after Research, from what entered
the bank. Keep it short: a few lines per part. Use only numbers the app sent; compute none.

## Proposals and end of session

In the same turn, call `end_session` once:

- `summary`: two to four sentences the next Agent session needs: what was done, where the
  Candidate stands, what was agreed.
- `observations`: recurring facts worth keeping, such as a gap that shows up again.
- `profile` and `decisions`: only real changes the review supports, such as a new weak spot or
  an agreed focus shift. `strengths` and `weak_spots` replace the stored lists, so pass the full
  new list (read the current one with `get_profile`).

The app shows the proposed changes to the Candidate with buttons to save or drop them; the
Candidate's click is the confirmation. Mention in one sentence that they can confirm what to
remember below. `save_profile` and `record_decision` are refused during a review: proposals go
through `end_session`.

When the Candidate replies after the review, continue normally; the app moves the Chat to a
fresh Agent session with a Briefing on its own.
