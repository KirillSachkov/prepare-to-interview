// The Mock interview node (prototype variant A, A-09 and A-10): a header with the timer and the
// thread of Cards the Interviewer places one at a time, follow-ups linked to the Card they probe.
// Grades appear on the Cards only once the mock has ended and the Grader has graded it.
import { useEffect, useState } from "react";
import type { CardView, PracticeSetNode, PracticeSetView } from "@prepare-to-interview/shared";
import { answerMockCard, finishMock } from "../practice/mock-api.ts";
import { cardAction, discussCard } from "../practice/practice-api.ts";
import { useCardDraft } from "../practice/drafts.ts";
import { modLabel } from "../shell/hotkeys.ts";
import type { MenuEntry } from "../shell/menu.ts";
import { cx } from "../shell/ui.tsx";
import { Feedback, Options, practiceDragHandleClass, reason, ResultCard, ScoreDots, useAction } from "./practice-set.tsx";
import type { NodeTypeDefinition, NodeViewProps } from "./types.ts";

type Props = NodeViewProps<"practice_set">;

/** Follow-ups step right by this much per level, up to `maxIndent` levels. */
const indentPx = 28;
const maxIndent = 3;

function asNode(props: Props): PracticeSetNode {
  return { id: props.id, kind: "practice_set", position: { x: 0, y: 0 }, collapsed: props.collapsed, data: props.content };
}

/** The Card waiting for the Candidate's answer. */
export function openMockCard(set: PracticeSetView): CardView | undefined {
  return set.status === "active" ? set.cards.find((c) => c.status === "open") : undefined;
}

function MockInterviewBody(props: Props) {
  if (props.collapsed) return <ResultCard {...props} />;
  const set = props.content;
  const depth = followUpDepths(set.cards);
  return (
    <div data-set-id={props.id} className="w-[520px]">
      <MockHeader {...props} />
      {set.cards.map((card) => (
        <div key={card.id} style={{ marginLeft: Math.min(depth.get(card.id) ?? 0, maxIndent) * indentPx }}>
          <Connector label={card.followUp ? "уточнение" : null} />
          <MockCard card={card} running={set.status === "active"} />
        </div>
      ))}
      {set.status === "active" && !set.cards.length && <Connector label="Интервьюер готовит вопрос…" />}
    </div>
  );
}

/** How many follow-ups deep each Card is. */
function followUpDepths(cards: CardView[]): Map<string, number> {
  const depth = new Map<string, number>();
  for (const card of cards) depth.set(card.id, card.followUp ? (depth.get(card.followUp.cardId) ?? 0) + 1 : 0);
  return depth;
}

function Connector({ label }: { label: string | null }) {
  return (
    <div className="flex h-12 flex-col items-center justify-center" aria-hidden={label === null}>
      <span className="w-px flex-1 border-l border-dashed border-indigo-300" />
      {label && <span className="px-2 text-[10.5px] text-stone-500">{label}</span>}
      <span className="w-px flex-1 border-l border-dashed border-indigo-300" />
    </div>
  );
}

function MockHeader(props: Props) {
  const set = props.content;
  const mock = set.mock;
  const run = useAction();
  const status =
    set.status === "active"
      ? `вопрос ${set.cards.length} · оценки в конце`
      : set.status === "grading"
        ? set.cards.some((c) => c.status === "failed")
          ? "часть ответов не проверена"
          : "проверяющий оценивает…"
        : `итог ${set.result?.score ?? 0}/${set.result?.max ?? 0}`;
  return (
    <div className={`${practiceDragHandleClass} cursor-grab rounded-2xl border border-indigo-200 bg-indigo-50/70 px-4 py-3 active:cursor-grabbing`}>
      <div className="flex items-center gap-3">
        <span className={cx("h-2 w-2 rounded-full", set.status === "active" ? "animate-pulse bg-rose-500" : "bg-stone-300")} />
        <div className="text-[14px] font-semibold">{set.title}</div>
        {mock && <MockTimer startedAt={mock.startedAt} deadline={set.deadline} finishedAt={mock.finishedAt} />}
      </div>
      <div className="mt-1 flex items-center justify-between gap-3 text-[12px] text-stone-500">
        <span className="min-w-0 truncate">
          {status}
          {mock && ` · ${mock.focus}`}
        </span>
        <div className="nodrag flex shrink-0 items-center gap-2">
          {set.status === "active" && (
            <button
              type="button"
              onClick={() => run(() => finishMock(asNode(props)), "Не удалось завершить интервью")}
              className="rounded-lg bg-indigo-600 px-3 py-1 text-[12.5px] font-medium text-white"
            >
              Завершить
            </button>
          )}
          {set.status === "graded" && (
            <button type="button" onClick={() => props.setCollapsed(true)} className="rounded-lg px-3 py-1 text-[12.5px] text-stone-500 hover:bg-white">
              Свернуть в итог
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Time left while the mock runs (the server ends it at the deadline); how long it took afterwards. */
function MockTimer({ startedAt, deadline, finishedAt }: { startedAt: number; deadline: number | null; finishedAt: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  const running = finishedAt === null;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  const seconds = running ? Math.max(0, Math.round(((deadline ?? now) - now) / 1000)) : Math.round((finishedAt - startedAt) / 1000);
  const clock = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <div className="ml-auto text-[12px] text-stone-500" role="timer" aria-label={running ? `Осталось ${clock}` : `Длилось ${clock}`}>
      {running ? "осталось " : "длилось "}
      <span className="font-mono text-[13px] text-stone-700 tabular-nums">{clock}</span>
    </div>
  );
}

const cardStatusLabels: Partial<Record<CardView["status"], string>> = {
  open: "оценка в конце",
  answered: "ответ принят",
};

function MockCard({ card, running }: { card: CardView; running: boolean }) {
  const run = useAction();
  const editable = card.status === "open" && running;
  const { draft, update, failed } = useCardDraft(card.id, card.draft, editable);
  const [showReference, setShowReference] = useState(false);
  const answered = card.type === "open" ? draft.text.trim() !== "" : draft.choices.length > 0;
  const graded = card.attempt?.status === "graded" && card.status === "graded";

  return (
    <div
      data-card-id={card.id}
      tabIndex={0}
      className={cx(
        "rounded-2xl border bg-white p-4 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-300",
        editable ? "border-indigo-300 ring-4 ring-indigo-50" : "border-stone-200",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-[11px] text-stone-500">
          <span className="truncate rounded-full bg-stone-100 px-2 py-0.5 font-medium text-stone-600">{card.topic}</span>
          <span className="whitespace-nowrap">Вопрос интервьюера</span>
        </div>
        {graded && card.attempt?.score !== null && card.attempt?.score !== undefined && <ScoreDots score={card.attempt.score} />}
        {cardStatusLabels[card.status] && <span className="text-[11px] whitespace-nowrap text-stone-400">{cardStatusLabels[card.status]}</span>}
        {card.status === "skipped" && <span className="text-xs text-stone-400">Пропущено</span>}
        {card.status === "grading" && <span className="animate-pulse text-xs text-indigo-500">проверяется…</span>}
        {card.status === "failed" && <span className="text-xs text-red-600">не проверено</span>}
      </div>

      {card.followUp && (
        <blockquote className="mt-2.5 border-l-2 border-indigo-200 pl-2 text-[12.5px] text-stone-500 italic">Вы сказали: «{card.followUp.quote}»</blockquote>
      )}
      <p className="mt-2.5 text-[14.5px] leading-snug font-medium text-stone-800">{card.prompt}</p>

      {card.type === "open" ? (
        <textarea
          aria-label="Ваш ответ"
          className="nodrag nowheel nopan mt-3 block w-full resize-y rounded-lg border border-stone-200 bg-stone-50/60 px-3 py-2 text-[13.5px] leading-relaxed outline-none placeholder:text-stone-400 focus:border-indigo-300 focus:bg-white disabled:text-stone-600"
          rows={4}
          placeholder="Отвечайте как на собеседовании…"
          value={draft.text}
          disabled={!editable}
          onChange={(e) => update({ text: e.target.value })}
        />
      ) : (
        <Options card={card} chosen={draft.choices} editable={editable} choose={(choices) => update({ choices })} />
      )}
      {failed && editable && <p className="mt-1 text-[11.5px] text-red-600">Черновик пока не сохранён на сервере.</p>}

      {card.error && (
        <div role="alert" className="mt-2.5 rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-800">
          {card.error}
        </div>
      )}

      {card.attempt && card.status !== "open" && <Feedback card={card} />}

      {showReference && card.referenceAnswer && (
        <div className="fade-in mt-2 rounded-lg border border-indigo-100 bg-indigo-50/50 px-3 py-2 text-[12.5px] leading-relaxed text-indigo-900">
          <span className="font-medium">Эталон:</span> {card.referenceAnswer}
        </div>
      )}

      <div className="nodrag mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {editable && (
          <>
            <button
              type="button"
              disabled={!answered}
              onClick={() => run(() => answerMockCard(card.id), "Не удалось ответить")}
              title={`Ответить — ${modLabel}+Enter`}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 font-medium text-white disabled:bg-stone-300"
            >
              Ответить <span className="ml-1 text-[11px] text-indigo-200">{modLabel}↵</span>
            </button>
            <button
              type="button"
              onClick={() => {
                update({ text: "", choices: [] });
                run(() => answerMockCard(card.id), "Не удалось ответить");
              }}
              className="text-stone-400 hover:text-stone-600"
            >
              Не знаю
            </button>
          </>
        )}
        {card.status === "failed" && (
          <>
            <button type="button" onClick={() => run(() => cardAction(card.id, "check"), "Не удалось проверить")} className="rounded-lg bg-stone-900 px-3 py-1.5 font-medium text-white">
              Проверить снова
            </button>
            <button type="button" onClick={() => run(() => cardAction(card.id, "skip"), "Не удалось пропустить")} className="text-stone-400 hover:text-stone-600">
              Пропустить
            </button>
          </>
        )}
        {card.referenceAnswer && card.type === "open" && (
          <button type="button" onClick={() => setShowReference((s) => !s)} className="text-indigo-600 hover:text-indigo-800">
            {showReference ? "Скрыть эталон" : "Показать эталон"}
          </button>
        )}
        {!running && (
          <button
            type="button"
            onClick={() => run(() => discussCard(card.id), "Не удалось обсудить карточку")}
            className="ml-auto text-stone-400 transition hover:text-indigo-600"
          >
            Обсудить →
          </button>
        )}
      </div>
    </div>
  );
}

function MockInterviewSummary(props: Props) {
  const set = props.content;
  return (
    <div className={`${practiceDragHandleClass} w-[520px] rounded-[22px] border border-indigo-200 bg-indigo-50 px-5 py-6`}>
      <div className="truncate text-3xl font-semibold text-stone-700">{set.title}</div>
      <div className="mt-2 text-xl text-stone-500">
        {set.status === "graded" ? `итог ${set.result?.score ?? 0}/${set.result?.max ?? 0}` : `вопрос ${set.cards.length}`}
      </div>
    </div>
  );
}

function mockMenu(node: Props, target: Element, notify: (message: string) => void): MenuEntry[] {
  const set = node.content;
  const fail = (failure: string) => (e: unknown) => notify(`${failure}: ${reason(e)}`);
  if (node.collapsed) return [{ label: "Развернуть", run: () => node.setCollapsed(false) }];
  const cardId = target.closest<HTMLElement>("[data-card-id]")?.dataset.cardId;
  const card = set.cards.find((c) => c.id === cardId);
  const cardEntries: MenuEntry[] =
    card && set.status !== "active"
      ? [{ label: "Обсудить в чате", run: () => void discussCard(card.id).catch(fail("Не удалось обсудить карточку")) }, "separator"]
      : [];
  return [
    ...cardEntries,
    {
      label: "Ответить",
      hint: `${modLabel}+↵`,
      disabled: !card || card !== openMockCard(set),
      run: () => card && void answerMockCard(card.id).catch(fail("Не удалось ответить")),
    },
    { label: "Завершить интервью", disabled: set.status !== "active", run: () => void finishMock(asNode(node)).catch(fail("Не удалось завершить интервью")) },
    { label: "Свернуть в итог", disabled: set.status !== "graded", run: () => node.setCollapsed(true) },
  ];
}

/** Renders a Practice set in `mock` mode as a Mock interview and leaves other sets to `definition`. */
export function withMockInterviews(definition: NodeTypeDefinition<"practice_set">): NodeTypeDefinition<"practice_set"> {
  const { View, Summary } = definition;
  return {
    ...definition,
    View: (props) => (props.content.mode === "mock" ? <MockInterviewBody {...props} /> : <View {...props} />),
    Summary: (props) => (props.content.mode === "mock" ? <MockInterviewSummary {...props} /> : <Summary {...props} />),
    menu: (node, context) => (node.content.mode === "mock" ? mockMenu(node, context.target, context.notify) : (definition.menu?.(node, context) ?? [])),
  };
}
