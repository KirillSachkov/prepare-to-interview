// The Practice set node (prototype variant A): a region of Cards answered in any order and
// submitted together; once graded it collapses into a small result Card.
import { useContext, useEffect, useEffectEvent, useState, type ReactNode } from "react";
import { wideSetCards, type CardView, type PracticeSetNode, type PracticeSetView } from "@prepare-to-interview/shared";
import { cardAction, discussCard, setReveal, submitPracticeSet, type CardAction } from "../practice/practice-api.ts";
import { draftOf, useCardDraft, useDraftChanges } from "../practice/drafts.ts";
import { modLabel } from "../shell/hotkeys.ts";
import type { MenuEntry } from "../shell/menu.ts";
import { cx } from "../shell/ui.tsx";
import { NotifyContext } from "./flow.tsx";
import type { NodeTypeDefinition, NodeViewProps } from "./types.ts";

type Props = NodeViewProps<"practice_set">;

/** Class of the parts that drag a Practice set (its header, the result Card, the summary). */
export const practiceDragHandleClass = "practice-drag-handle";

const typeLabels: Record<CardView["type"], string> = {
  open: "Развёрнутый ответ",
  single_choice: "Тест · один ответ",
  multiple_choice: "Тест · несколько ответов",
};

/** Error text of a failed action, in Russian. */
export const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function useAction() {
  const notify = useContext(NotifyContext);
  return (run: () => Promise<unknown>, failure: string) => {
    run().catch((e: unknown) => notify(`${failure}: ${reason(e)}`));
  };
}

/** The node as the shell knows it, for actions that need the whole set. */
function asNode(props: Props): PracticeSetNode {
  return { id: props.id, kind: "practice_set", position: { x: 0, y: 0 }, collapsed: props.collapsed, data: props.content };
}

/** Cards with an answer, counting the Candidate's unsaved local drafts. */
function answeredCount(set: PracticeSetView): number {
  return set.cards.filter((c) => {
    if (c.status !== "open") return true;
    const draft = draftOf(c.id, c.draft, true);
    return draft.text.trim() !== "" || draft.choices.length > 0;
  }).length;
}

function PracticeSetBody(props: Props) {
  const set = props.content;
  if (props.collapsed) return <ResultCard {...props} />;
  const wide = set.cards.length >= wideSetCards;
  return (
    <div
      data-set-id={props.id}
      className={cx("rounded-[22px] border border-stone-200/80 bg-stone-200/30 p-3", wide ? "w-[800px]" : "w-[440px]")}
    >
      <SetHeader {...props} />
      <div className={cx("grid gap-3", wide ? "grid-cols-2" : "grid-cols-1")}>
        {set.cards.map((card) => (
          <Card key={card.id} card={card} set={set} />
        ))}
      </div>
    </div>
  );
}

function SetHeader(props: Props) {
  useDraftChanges();
  const set = props.content;
  const run = useAction();
  const answered = answeredCount(set);
  const status =
    set.status === "active"
      ? `отвечено ${answered} из ${set.cards.length}`
      : set.status === "grading"
        ? set.cards.some((c) => c.status === "failed")
          ? "часть ответов не проверена"
          : "проверяется…"
        : `итог ${set.result?.score ?? 0}/${set.result?.max ?? 0}`;
  return (
    <div className={`${practiceDragHandleClass} flex cursor-grab items-center gap-3 px-2 pt-1 pb-3 active:cursor-grabbing`}>
      <div className="min-w-0">
        <div className="truncate text-[14px] font-semibold">{set.title}</div>
        <div className="text-[12px] text-stone-500">
          {set.kind === "quiz" ? "Квиз · тесты проверяются сразу" : "Отвечайте в любом порядке"} · {status}
          {set.deadline !== null && set.status === "active" && (
            <>
              {" · "}
              <Countdown deadline={set.deadline} onExpired={() => run(() => submitPracticeSet(asNode(props)), "Не удалось отправить квиз")} />
            </>
          )}
        </div>
      </div>
      <div className="nodrag ml-auto flex items-center gap-2">
        {set.status === "active" && set.kind === "practice" && (
          <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-stone-500" title="Показывать оценку после каждого ответа">
            <input
              type="checkbox"
              checked={set.reveal === "each_answer"}
              onChange={(e) =>
                run(() => setReveal(props.id, e.target.checked ? "each_answer" : "after_submit"), "Не удалось сменить режим")
              }
            />
            Оценка сразу
          </label>
        )}
        {set.status === "active" && (
          <button
            type="button"
            disabled={!answered}
            onClick={() => run(() => submitPracticeSet(asNode(props)), "Не удалось отправить подборку")}
            title={`Отправить — ${modLabel}+Enter`}
            className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-[13px] font-medium whitespace-nowrap text-white disabled:bg-stone-300"
          >
            Отправить <span className="ml-1 text-[11px] text-indigo-200">{modLabel}↵</span>
          </button>
        )}
        {set.status === "graded" && (
          <button
            type="button"
            onClick={() => props.setCollapsed(true)}
            className="rounded-lg px-3 py-1.5 text-[12.5px] text-stone-500 hover:bg-white"
          >
            Свернуть в итог
          </button>
        )}
      </div>
    </div>
  );
}

function Countdown({ deadline, onExpired }: { deadline: number; onExpired: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const left = Math.max(0, Math.round((deadline - now) / 1000));
  const expired = left === 0;
  const expire = useEffectEvent(onExpired);
  useEffect(() => {
    if (expired) {
      expire();
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expired]);
  return (
    <span className="text-stone-700 tabular-nums">
      {String(Math.floor(left / 60)).padStart(2, "0")}:{String(left % 60).padStart(2, "0")}
    </span>
  );
}

/** Whether the Card's answer is checked on its own now rather than with the whole set. */
function checksAlone(set: PracticeSetView): boolean {
  return set.reveal === "each_answer" || set.status !== "active";
}

function Card({ card, set }: { card: CardView; set: PracticeSetView }) {
  const run = useAction();
  const editable = card.status === "open";
  const { draft, update, failed } = useCardDraft(card.id, card.draft, editable);
  const [showReference, setShowReference] = useState(false);
  const act = (action: CardAction, failure: string) => run(() => cardAction(card.id, action), failure);
  const answered = card.type === "open" ? draft.text.trim() !== "" : draft.choices.length > 0;
  const graded = card.attempt?.status === "graded" && card.status !== "open";

  return (
    <div
      data-card-id={card.id}
      tabIndex={0}
      className="rounded-2xl border border-stone-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,.03)] outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-[11px] text-stone-500">
          <span className="truncate rounded-full bg-stone-100 px-2 py-0.5 font-medium text-stone-600">{card.topic}</span>
          <span className="whitespace-nowrap">{typeLabels[card.type]}</span>
        </div>
        {graded && card.attempt?.score !== null && card.attempt?.score !== undefined && <ScoreDots score={card.attempt.score} />}
        {card.status === "skipped" && <span className="text-xs text-stone-400">Пропущено</span>}
        {card.status === "grading" && <span className="animate-pulse text-xs text-indigo-500">проверяется…</span>}
        {card.status === "failed" && <span className="text-xs text-red-600">не проверено</span>}
      </div>

      <p className="mt-2.5 text-[14.5px] leading-snug font-medium text-stone-800">{card.prompt}</p>

      {card.type === "open" ? (
        <textarea
          aria-label="Ваш ответ"
          className="nodrag nowheel nopan mt-3 block w-full resize-y rounded-lg border border-stone-200 bg-stone-50/60 px-3 py-2 text-[13.5px] leading-relaxed outline-none placeholder:text-stone-400 focus:border-indigo-300 focus:bg-white disabled:text-stone-600"
          rows={4}
          placeholder="Ваш ответ…"
          value={draft.text}
          disabled={!editable}
          onChange={(e) => update({ text: e.target.value })}
        />
      ) : (
        <Options card={card} chosen={draft.choices} editable={editable} choose={(choices) => update({ choices })} />
      )}
      {failed && editable && <p className="mt-1 text-[11.5px] text-red-600">Черновик пока не сохранён на сервере.</p>}

      {card.hints.length > 0 && (
        <div className="mt-2.5 space-y-1 rounded-lg border border-amber-200/70 bg-amber-50/60 px-3 py-2 text-[12px] leading-relaxed text-amber-900">
          {card.hints.map((hint, i) => (
            <div key={hint}>
              <span className="font-medium">Подсказка {i + 1}.</span> {hint}
            </div>
          ))}
          <div className="text-[11px] text-amber-700/80">С подсказками максимум {card.maxScore}/3</div>
        </div>
      )}

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
        {editable && checksAlone(set) && (
          <button
            type="button"
            disabled={!answered}
            onClick={() => act("check", "Не удалось проверить")}
            className="rounded-lg bg-stone-900 px-3 py-1.5 font-medium text-white disabled:bg-stone-300"
          >
            Проверить
          </button>
        )}
        {card.status === "failed" && (
          <button type="button" onClick={() => act("check", "Не удалось проверить")} className="rounded-lg bg-stone-900 px-3 py-1.5 font-medium text-white">
            Проверить снова
          </button>
        )}
        {editable && card.hints.length < card.hintRungs && (
          <button type="button" onClick={() => act("hint", "Не удалось открыть подсказку")} className="text-amber-700 hover:text-amber-900">
            Подсказка <span className="text-stone-400">−1 балл</span>
          </button>
        )}
        {editable && (
          <button type="button" onClick={() => act("skip", "Не удалось пропустить")} className="text-stone-400 hover:text-stone-600">
            Пропустить
          </button>
        )}
        {card.referenceAnswer && card.type === "open" && (
          <button type="button" onClick={() => setShowReference((s) => !s)} className="text-indigo-600 hover:text-indigo-800">
            {showReference ? "Скрыть эталон" : "Показать эталон"}
          </button>
        )}
        {(card.status === "graded" || card.status === "skipped") && (
          <button type="button" onClick={() => act("retry", "Не удалось открыть карточку")} className="text-stone-500 hover:text-indigo-600">
            Ещё раз
          </button>
        )}
        <button
          type="button"
          onClick={() => run(() => discussCard(card.id), "Не удалось обсудить карточку")}
          className="ml-auto text-stone-400 transition hover:text-indigo-600"
        >
          Обсудить →
        </button>
      </div>
    </div>
  );
}

export function Options({
  card,
  chosen,
  editable,
  choose,
}: {
  card: CardView;
  chosen: number[];
  editable: boolean;
  choose: (choices: number[]) => void;
}) {
  const correct = card.status === "graded" ? card.attempt?.correct : null;
  const single = card.type === "single_choice";
  return (
    <div className="mt-3 space-y-1.5" role={single ? "radiogroup" : "group"}>
      {(card.options ?? []).map((option, i) => {
        const picked = chosen.includes(i);
        const right = correct?.includes(i) ?? false;
        const wrong = Boolean(correct) && picked && !right;
        return (
          <button
            key={option}
            type="button"
            role={single ? "radio" : "checkbox"}
            aria-checked={picked}
            disabled={!editable}
            onClick={() => choose(single ? [i] : picked ? chosen.filter((c) => c !== i) : [...chosen, i])}
            className={cx(
              "nodrag flex w-full items-center gap-2.5 rounded-lg border px-3 py-1.5 text-left text-[13px] transition",
              right ? "border-emerald-300 bg-emerald-50" : wrong ? "border-rose-300 bg-rose-50" : picked ? "border-indigo-300 bg-indigo-50" : "border-stone-200 hover:border-stone-300",
            )}
          >
            <span
              className={cx(
                "grid h-4 w-4 shrink-0 place-items-center border",
                single ? "rounded-full" : "rounded",
                picked ? "border-indigo-500 bg-indigo-500" : "border-stone-300",
              )}
            >
              {picked && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
            </span>
            {option}
          </button>
        );
      })}
    </div>
  );
}

export function Feedback({ card }: { card: CardView }) {
  const attempt = card.attempt;
  if (!attempt || attempt.status === "skipped") return null;
  const testVerdict = attempt.score === 3 ? "Верно." : attempt.score === 0 ? "Неверно." : "Частично верно.";
  return (
    <div className="fade-in mt-3 rounded-lg bg-stone-50 px-3 py-2.5 text-[12.5px] leading-relaxed text-stone-600">
      {attempt.quote && <blockquote className="mb-1.5 border-l-2 border-stone-300 pl-2 text-stone-500 italic">«{attempt.quote}»</blockquote>}
      {card.type === "open" ? (
        <>
          {attempt.strengths && <p>{attempt.strengths}</p>}
          {attempt.gap && <p className="mt-1 text-stone-700">{attempt.gap}</p>}
        </>
      ) : (
        <p>{testVerdict}</p>
      )}
    </div>
  );
}

export function ScoreDots({ score }: { score: number }) {
  const color = score === 3 ? "bg-emerald-500" : score === 2 ? "bg-amber-500" : "bg-rose-500";
  return (
    <span className="inline-flex items-center gap-1" aria-label={`Оценка ${score} из 3`}>
      {[0, 1, 2].map((i) => (
        <span key={i} className={cx("h-2 w-2 rounded-full", i < score ? color : "bg-stone-200")} />
      ))}
      <span className="ml-1 text-xs font-medium text-stone-500 tabular-nums">{score}/3</span>
    </span>
  );
}

function Ring({ value, children }: { value: number; children: ReactNode }) {
  const size = 42;
  const stroke = 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = value < 0.4 ? "#e11d48" : value < 0.7 ? "#d97706" : "#059669";
  return (
    <div className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e7e5e4" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - value)} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-[11px] font-semibold tabular-nums">{children}</div>
    </div>
  );
}

export function ResultCard(props: Props) {
  const set = props.content;
  const result = set.result;
  return (
    <div data-set-id={props.id} className={`${practiceDragHandleClass} fade-in w-[260px] cursor-grab rounded-2xl border border-stone-200 bg-white p-4 shadow-sm`}>
      <div className="flex items-center gap-3">
        <Ring value={result && result.max ? result.score / result.max : 0}>{result?.score ?? "—"}</Ring>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold">{set.title}</div>
          <div className="text-[11.5px] text-stone-400">
            {result ? `итог ${result.score}/${result.max}` : "не отправлено"}
            {result && result.skipped > 0 && ` · пропущено ${result.skipped}`}
          </div>
        </div>
      </div>
      <div className="mt-3 flex gap-1">
        {set.cards.map((card) => (
          <span
            key={card.id}
            title={card.prompt}
            className={cx(
              "h-1.5 flex-1 rounded-full",
              card.attempt?.status !== "graded"
                ? "bg-stone-200"
                : (card.attempt.score ?? 0) === 3
                  ? "bg-emerald-400"
                  : (card.attempt.score ?? 0) >= 2
                    ? "bg-amber-400"
                    : "bg-rose-400",
            )}
          />
        ))}
      </div>
      <div className="mt-3 flex justify-end text-[11.5px]">
        <button type="button" data-focus-target className="nodrag text-indigo-600" onClick={() => props.setCollapsed(false)}>
          Развернуть
        </button>
      </div>
    </div>
  );
}

function PracticeSetSummary(props: Props) {
  useDraftChanges();
  const set = props.content;
  return (
    <div className={`${practiceDragHandleClass} w-[440px] rounded-[22px] border border-stone-200 bg-white px-5 py-6`}>
      <div className="truncate text-3xl font-semibold text-stone-700">{set.title}</div>
      <div className="mt-2 text-xl text-stone-500">
        {set.status === "graded" ? `итог ${set.result?.score ?? 0}/${set.result?.max ?? 0}` : `${answeredCount(set)} из ${set.cards.length}`}
      </div>
    </div>
  );
}

function cardMenu(node: Props, card: CardView, notify: (message: string) => void): MenuEntry[] {
  const run = (action: () => Promise<unknown>, failure: string) => () => {
    action().catch((e: unknown) => notify(`${failure}: ${reason(e)}`));
  };
  const open = card.status === "open";
  return [
    { label: "Обсудить в чате", run: run(() => discussCard(card.id), "Не удалось обсудить карточку") },
    {
      label: "Подсказка",
      hint: "−1 балл",
      disabled: !open || card.hints.length >= card.hintRungs,
      run: run(() => cardAction(card.id, "hint"), "Не удалось открыть подсказку"),
    },
    { label: "Пропустить", disabled: !open, run: run(() => cardAction(card.id, "skip"), "Не удалось пропустить") },
    {
      label: "Ещё раз",
      disabled: card.status !== "graded" && card.status !== "skipped",
      run: run(() => cardAction(card.id, "retry"), "Не удалось открыть карточку"),
    },
    "separator",
    ...setMenu(node, notify),
  ];
}

function setMenu(node: Props, notify: (message: string) => void): MenuEntry[] {
  const set = node.content;
  const fail = (failure: string) => (e: unknown) => notify(`${failure}: ${reason(e)}`);
  if (node.collapsed) return [{ label: "Развернуть", run: () => node.setCollapsed(false) }];
  return [
    {
      label: "Отправить",
      hint: `${modLabel}+↵`,
      disabled: set.status !== "active" || !answeredCount(set),
      run: () => void submitPracticeSet(asNode(node)).catch(fail("Не удалось отправить подборку")),
    },
    ...(set.kind === "practice" && set.status === "active"
      ? [
          {
            label: set.reveal === "each_answer" ? "Оценки после отправки" : "Оценка после каждого ответа",
            run: () =>
              void setReveal(node.id, set.reveal === "each_answer" ? "after_submit" : "each_answer").catch(fail("Не удалось сменить режим")),
          },
        ]
      : []),
    { label: "Свернуть в итог", disabled: set.status !== "graded", run: () => node.setCollapsed(true) },
  ];
}

export const practiceSetType: NodeTypeDefinition<"practice_set"> = {
  View: PracticeSetBody,
  Summary: PracticeSetSummary,
  dragHandle: `.${practiceDragHandleClass}`,
  menu: (node, { target, notify }) => {
    const cardId = target.closest<HTMLElement>("[data-card-id]")?.dataset.cardId;
    const card = node.content.cards.find((c) => c.id === cardId);
    return card && !node.collapsed ? cardMenu(node, card, notify) : setMenu(node, notify);
  },
};
