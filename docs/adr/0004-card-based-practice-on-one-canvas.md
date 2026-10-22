# Practice happens on Cards on one shared Canvas

The interface is a single React Flow Canvas rather than pages or per-target boards. Every Question reaches the Candidate as a Card: in a Practice set the Candidate answers Cards in any order and submits them together; in a Mock interview the Interviewer places Cards one at a time with follow-ups. Test Cards are checked by the server instantly; open answers go to the Grader. The Chat is a node on the Canvas, a fixed Control panel holds Preparation targets, readiness, and actions, and the Skill map is a separate view.

The Canvas keeps only current items: a graded Practice set collapses into a result Card and moves to history automatically when a new Practice set or a new day starts. The Candidate never manages sessions or tidies the Canvas.

## Considered options

- **Chat-only interaction with a read-only dashboard**: answering several questions in a chat is clumsy, and results scatter across the conversation.
- **tldraw**: requires a license key or watermark in production, unsuitable for an open-source project.
