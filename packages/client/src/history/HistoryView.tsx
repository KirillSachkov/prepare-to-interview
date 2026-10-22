// History of graded Practice sets that left the Canvas (ADR-0004 auto-tidy). The Control panel
// menu opens it as a dialog; the Skill map can embed `HistoryView`, filtered by Topic.
import { useEffect, useState } from "react";
import type { CardView, HistoryEntry } from "@prepare-to-interview/shared";
import { discussCard } from "../practice/practice-api.ts";
import { cx, MenuHeading, MenuRow, Modal } from "../shell/ui.tsx";
import { fetchHistory } from "./history-api.ts";

/** Graded Practice sets in history, newest first; loads once when shown. */
export function useHistory(): { entries?: HistoryEntry[]; error?: string } {
  const [entries, setEntries] = useState<HistoryEntry[]>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    fetchHistory()
      .then((response) => setEntries(response.entries))
      .catch((e: unknown) => setError(`Не удалось загрузить историю: ${e instanceof Error ? e.message : String(e)}`));
  }, []);
  return { ...(entries && { entries }), ...(error && { error }) };
}

const emptyText = "Итоги попадут сюда сами при новой подборке или на следующий день.";

/** The history list with expandable results; `topic` keeps only sets with Cards on that Topic. */
export function HistoryView({ topic, onDiscuss }: { topic?: string; onDiscuss?: () => void }) {
  const { entries, error } = useHistory();
  const [open, setOpen] = useState<string | null>(null);
  const [notice, setNotice] = useState<string>();
  const shown = entries?.filter((e) => !topic || e.set.cards.some((c) => c.topic === topic));
  const discuss = (card: CardView) => {
    setNotice(undefined);
    discussCard(card.id)
      .then(onDiscuss)
      .catch((e: unknown) => setNotice(`Не удалось обсудить карточку: ${e instanceof Error ? e.message : String(e)}`));
  };
  return (
    <div className="space-y-1" aria-label="История">
      {error && (
        <p role="alert" className="text-[12.5px] text-red-700">
          {error}
        </p>
      )}
      {notice && (
        <p role="alert" className="text-[12.5px] text-red-700">
          {notice}
        </p>
      )}
      {shown?.length === 0 && <p className="text-[13px] text-stone-500">{emptyText}</p>}
      {shown?.map((entry) => {
        const result = entry.set.result;
        const expanded = open === entry.id;
        return (
          <section key={entry.id} className="rounded-xl border border-stone-200" aria-label={entry.set.title}>
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setOpen(expanded ? null : entry.id)}
              className="flex w-full items-center gap-3 px-3 py-2 text-left text-[13px] hover:bg-stone-50"
            >
              <span className="flex-1 truncate font-medium text-stone-800">{entry.set.title}</span>
              <span className="text-[11.5px] text-stone-400">{formatDay(entry.gradedAt)}</span>
              <span className="text-[12px] text-stone-500 tabular-nums">
                {result ? `${result.score}/${result.max}` : "—"}
                {result && result.skipped > 0 && ` · пропущено ${result.skipped}`}
              </span>
            </button>
            {expanded && (
              <ul className="space-y-2 border-t border-stone-100 px-3 py-2">
                {entry.set.cards
                  .filter((c) => !topic || c.topic === topic)
                  .map((card) => (
                    <li key={card.id} className="text-[12.5px]">
                      <div className="flex items-start gap-2">
                        <span className={cx("mt-1 h-2 w-2 shrink-0 rounded-full", scoreColour(card))} />
                        <div className="min-w-0 flex-1">
                          <div className="text-stone-800">{card.prompt}</div>
                          <div className="text-stone-500">
                            {card.topic} · {describeAttempt(card)}
                          </div>
                          {card.attempt?.quote && <div className="text-stone-500">«{card.attempt.quote}»</div>}
                          {card.attempt?.gap && <div className="text-stone-500">Пробел: {card.attempt.gap}</div>}
                        </div>
                        <button type="button" onClick={() => discuss(card)} className="shrink-0 text-indigo-600">
                          Обсудить
                        </button>
                      </div>
                    </li>
                  ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** `discussed` runs once a Card from history went into the Chat. */
export function HistoryDialog({ close, discussed }: { close: () => void; discussed: () => void }) {
  return (
    <Modal title="История" close={close} width={560}>
      <HistoryView onDiscuss={discussed} />
    </Modal>
  );
}

/** The latest results in the toolbar's «Ещё» menu, with a row that opens the whole history. */
export function HistoryMenuSection({ openHistory }: { openHistory: () => void }) {
  const { entries } = useHistory();
  return (
    <>
      <MenuHeading>История · {entries?.length ?? "…"}</MenuHeading>
      {entries?.slice(0, 5).map((e) => (
        <MenuRow key={e.id} onClick={openHistory} hint={e.set.result ? `${e.set.result.score}/${e.set.result.max}` : undefined}>
          <span className="truncate">
            {e.set.title} · {formatDay(e.gradedAt)}
          </span>
        </MenuRow>
      ))}
      {entries?.length === 0 && <div className="px-2.5 pb-1.5 text-[12px] text-stone-400">{emptyText}</div>}
      {entries && entries.length > 0 && <MenuRow onClick={openHistory}>Вся история…</MenuRow>}
    </>
  );
}

function describeAttempt(card: CardView): string {
  const attempt = card.attempt;
  if (!attempt || attempt.status === "skipped") return "пропущено";
  const corrected = attempt.corrected ? ` (исправлено с ${attempt.corrected.from})` : "";
  return `${attempt.score ?? 0} из ${attempt.maxScore}${corrected}`;
}

function scoreColour(card: CardView): string {
  const attempt = card.attempt;
  if (attempt?.status !== "graded") return "bg-stone-200";
  const score = attempt.score ?? 0;
  return score === 3 ? "bg-emerald-400" : score >= 2 ? "bg-amber-400" : "bg-rose-400";
}

function formatDay(ms: number): string {
  return new Date(ms).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}
