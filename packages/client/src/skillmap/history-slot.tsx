// History of results in the Skill map (story 77): graded Practice sets and Mock interviews that
// left the Canvas, all of them on the map and those touching a Topic in its detail.
import { HistoryView } from "../history/HistoryView.tsx";

export function SkillMapHistory({ topic, onDiscuss }: { topic?: string; onDiscuss: () => void }) {
  return (
    <section aria-label={topic ? "История по теме" : "История итогов"} className="mt-8 mb-8">
      <h3 className="mb-2 text-[12px] font-medium tracking-wider text-stone-400 uppercase">История</h3>
      <HistoryView {...(topic !== undefined && { topic })} onDiscuss={onDiscuss} />
    </section>
  );
}
