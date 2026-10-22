// Where history of results appears in the Skill map (story 77). Ticket #9 replaces this
// placeholder with the history of graded Practice sets and Mock interviews.
export function SkillMapHistory() {
  return (
    <section aria-label="История" data-slot="history" className="mb-8">
      <h3 className="mb-2 text-[12px] font-medium tracking-wider text-stone-400 uppercase">История</h3>
      <p className="text-[12.5px] text-stone-400">Итоги подборок попадут сюда сами при новой подборке или на следующий день.</p>
    </section>
  );
}
