# The maintainer's development harness stays out of the repository

The repository publishes the product, its domain docs, and contributor guidance. The maintainer's personal agent pipeline (`/.agents/`, `/.claude/`, `/WORKFLOW.md`, `/docs/agents/`) is git-ignored and exists only in the maintainer's checkout. Product-owned agent material, such as the Interviewer's skills, lives in its own product directory, never in the ignored root paths.
