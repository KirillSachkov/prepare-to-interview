# PROTOTYPE: Canvas UI variants

Throwaway code. It answers one question: what should the main Canvas look like
(ADR-0004), and where should the Question bank and the Proposed queue live?
Do not merge into `main`; fold the winning ideas into the real client instead.

```sh
pnpm --dir prototypes/canvas-ui install
pnpm --dir prototypes/canvas-ui dev   # http://127.0.0.1:5199/?variant=A
```

Switch variants with `?variant=A|B|C`, the floating bar at the bottom, or `←`/`→`
when no input is focused. The bar also has prototype-only controls: «новый день»
(simulates the next day, which moves results to history) and `{ }` (state dump).

- **A · Спокойный холст** (chosen, iteration 2): free React Flow canvas with an
  Excalidraw-style floating toolbar (V H | P M R B | K ⋯), hamburger menu with the
  Preparation target chip, Chat toggle (C), zoom pill, `?` shortcuts dialog, right-click
  context menus (canvas, Card, Practice set, Mock, Chat), Hint ladder, Skip, Reference
  answer, custom question, grid toggle, zen mode (Alt+Z). Practice sets are grouped
  regions; Mock interview is a thread of linked Cards. Question bank and Proposed queue
  live inside the Skill map view (right column). Fake data: AI Engineer + Backend Python.
- **B · Фокус-лента**: left rail; current items auto-arranged into one column; Chat docked
  to the right of the column and follows scrolling. The Skill map is a zoomed-out level of
  the same canvas (semantic zoom); zooming into a Topic shows its bank Questions.
  The Proposed queue is an inbox node at the top of the feed.
- **C · Столы**: canvas split into zones (Практика / Мок / Чат / Итоги) with snapping;
  a ⌘K command palette plus a corner widget; a Practice set is a deck with numbered tabs.
  Question bank and Proposed queue in a drawer; the Skill map is a heat-table overlay.

All data is fake and in memory. The Interviewer and Grader are simulated with timeouts;
the Grader scores open answers by length, so do not judge grading quality here.

`scripts/walk.mjs` drives each variant through the main flows with Playwright and
writes `screenshots/`. It needs the dev server running; set `PW_EXECUTABLE` to a
Chromium binary if Playwright's bundled browser is not installed (otherwise it uses Chrome).
