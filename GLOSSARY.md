# Interview Preparation

A local app where a person prepares for technical IT interviews with an AI agent and sees which topics and questions they have mastered and which still need work.

## Preparation

**Candidate**:
The person using the app to prepare for interviews.
_Avoid_: User (in domain text), student, learner

**Candidate profile**:
What the agent knows about the Candidate: experience, stack, strengths, weak spots, and format preferences.
_Avoid_: Memory, user settings

**Preparation target**:
One position the Candidate is preparing for: role, stack, grade, market, language, linked vacancies, optional interview date, and the agreed Topics with priorities.
_Avoid_: Goal, track, plan, position (alone)

**Market**:
A job market with its own sources, conventions, and established terminology, such as the Russian-speaking IT market.
_Avoid_: Region, locale

**Decision log**:
The record of choices the Candidate and agent agreed on, such as excluding a Topic or shifting focus.
_Avoid_: Notes, history

## Question bank

**Question bank**:
The single shared collection of Topics and Questions; Preparation targets select from it rather than owning copies.
_Avoid_: Database, deck

**Topic**:
A unit of knowledge Questions belong to, such as "PostgreSQL indexes"; Topics nest into groups.
_Avoid_: Skill, subject, category

**Question**:
A prompt the Candidate answers, with a type, a Reference answer, Rubric anchors, and Sources.
_Avoid_: Task, problem, item

**Question type**:
The answer form a Question expects: an open answer or a test with fixed options; coding and SQL types come later.
_Avoid_: Format, kind

**Reference answer**:
The expected content of a good answer, backed by Sources; marked draft or verified.
_Avoid_: Correct answer, solution

**Rubric**:
The 0–3 scale for grading an open answer: 0 wrong or missing, 1 fragments without the key idea, 2 key idea with gaps, 3 complete and justified.
_Avoid_: Grading scheme

**Rubric anchors**:
What each Rubric score means for one specific Question.
_Avoid_: Criteria

**Source**:
An external material a Topic, Question, or Reference answer is based on, such as an article, vacancy, or the Candidate's own notes.
_Avoid_: Reference, link

**Research**:
The agent's collection of Topics and Questions for a Preparation target from Sources.
_Avoid_: Scraping, import

**Research batch**:
One run of Research for a Preparation target, in the background beside the Chat; what it finds waits as Proposed.
_Avoid_: Research session, crawl

**Proposed**:
The status of Research output awaiting the Candidate's approval before it enters the Question bank.
_Avoid_: Draft, pending

## Practice

**Card**:
One Question placed on the Canvas for the Candidate to answer, later showing the grade and feedback.
_Avoid_: Tile, widget

**Practice set**:
A group of Cards the Candidate answers in any order and submits together.
_Avoid_: Session, batch, quiz (for open-answer sets)

**Quiz**:
A Practice set made only of test Cards, checked instantly.
_Avoid_: Test (for the whole set)

**Mock interview**:
A live interview where the agent places Cards one at a time, asks follow-ups, and reveals grades only at the end.
_Avoid_: Exam, real interview

**Follow-up**:
A Mock interview Card that probes an answer the Candidate just gave, quoting a piece of it.
_Avoid_: Sub-question, clarification

**Attempt**:
One answer to one Question, with its score or Skipped status, the quoted evidence, the hint level used, and the mode.
_Avoid_: Answer (as a record), try

**Skipped**:
The status of an Attempt the Candidate declined to answer; it is not a score of 0.

**Hint ladder**:
The escalating hints available during practice; each rung lowers the maximum score of the Attempt.

**Grader**:
The agent role that scores submitted open answers against the Reference answer and Rubric anchors without the conversation history.
_Avoid_: Checker, reviewer

**Mastery**:
How well the Candidate knows a Topic or Question, derived from recent Attempts.
_Avoid_: Progress (for a single Topic), level

**Readiness**:
How prepared the Candidate is for one Preparation target: the Mastery of its Topics, weighted by their priority.
_Avoid_: Score, progress, completion

**Due**:
The state of a Question scheduled for repetition now.
_Avoid_: Overdue, to review

## Agent

**Interviewer**:
The persona the app gives the Candidate's own coding agent: it runs onboarding, Research, practice, and reviews.
_Avoid_: Bot, assistant, AI

**Activity**:
One bounded piece of work with the Interviewer: onboarding, a Research batch, a Practice set, a Mock interview, or a review.
_Avoid_: Session (for user-facing work)

**Agent session**:
An internal conversation with the coding agent that the app starts and ends at Activity boundaries; the Candidate never manages it.
_Avoid_: Chat, thread

**Briefing**:
The compact summary the app gives the agent at the start of an Agent session: Preparation target, Due Questions, weak Topics, and recent summaries.
_Avoid_: Context dump, memory

**Chat**:
The single continuous conversation the Candidate sees, spanning many Agent sessions.
_Avoid_: Session

## Interface

**Canvas**:
The single shared workspace showing only current items: active Practice sets, the Chat, and recent results.
_Avoid_: Board, dashboard

**Control panel**:
The fixed area over the Canvas with Preparation targets, overall readiness, and actions.
_Avoid_: Sidebar, HUD

**Skill map**:
The separate view of Topics with their Mastery.
_Avoid_: Progress tree, roadmap
