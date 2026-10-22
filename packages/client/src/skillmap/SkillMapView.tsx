// The Skill map (prototype variant A, screenshots A-13..A-15): a separate view of the active
// Preparation target's Topics with Mastery rings, Due badges, and readiness, plus a side panel with
// the Proposed queue and the Question bank. Opening a Topic shows its Questions with history.
import { useState, type ReactNode } from "react";
import type { SkillMapTopic } from "@prepare-to-interview/shared";
import { cx } from "../shell/ui.tsx";
import { SkillMapHistory } from "./history-slot.tsx";
import { BankPanel, ProposedPanel } from "./panels.tsx";
import { fetchSkillMap, useLive } from "./skillmap-api.ts";
import { TopicDetail } from "./TopicDetail.tsx";
import { heat, Ring } from "./ui.tsx";

export type SkillMapTab = "proposed" | "bank";

export interface SkillMapViewProps {
  tab: SkillMapTab;
  setTab: (tab: SkillMapTab) => void;
  /** Asks the Interviewer for a Practice set on the Topic and returns to the Canvas. */
  practise: (topic: string) => void;
  research: () => void;
  notify: (text: string) => void;
  /** A history Card went into the Chat with «Обсудить»: show the Chat. */
  discussed: () => void;
  /** A Topic the Interviewer pointed at: it opens; a new `seq` opens it again. */
  focusTopic?: { topicId: string; seq: number } | null;
}

const legend = [0.2, 0.55, 0.85].map((m) => heat(m));

export function SkillMapView(props: SkillMapViewProps) {
  const { data, error } = useLive(fetchSkillMap);
  const [openTopic, setOpenTopic] = useState<string | null>(props.focusTopic?.topicId ?? null);
  // A new focus from the Interviewer opens its Topic (state adjusted while rendering, not in an effect).
  const [seenFocus, setSeenFocus] = useState(props.focusTopic);
  if (props.focusTopic !== seenFocus) {
    setSeenFocus(props.focusTopic);
    if (props.focusTopic) setOpenTopic(props.focusTopic.topicId);
  }
  const groups = [...new Set((data?.topics ?? []).map((t) => t.group))];

  return (
    <div role="region" aria-label="Карта навыков" className="absolute inset-0 z-20 flex bg-[#f7f6f3] pt-24">
      <div className="min-w-0 flex-1 overflow-y-auto px-10 pt-2 pb-20">
        {openTopic ? (
          <TopicDetail topicId={openTopic} back={() => setOpenTopic(null)} practise={props.practise} notify={props.notify} discussed={props.discussed} />
        ) : (
          <>
            <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
              <div>
                <h2 className="text-[20px] font-semibold">Карта навыков</h2>
                <p className="text-[13px] text-stone-500">Цвет показывает освоение темы, бейдж — сколько вопросов пора повторить.</p>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] whitespace-nowrap text-stone-500">
                {data && (
                  <span aria-label="Готовность" className="mr-2 rounded-lg bg-white px-2.5 py-1 text-[12.5px] text-stone-600 shadow-sm">
                    {data.targetName ?? "Цель не выбрана"} · готовность{" "}
                    <span className="font-semibold text-indigo-600 tabular-nums">{data.readiness === null ? "—" : `${String(data.readiness)}%`}</span>
                    {data.due > 0 && <span className="text-stone-400"> · к повторению {data.due}</span>}
                  </span>
                )}
                {legend.map((h) => (
                  <span key={h.label} className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: h.stroke }} />
                    {h.label}
                  </span>
                ))}
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: heat(null).stroke }} />
                  {heat(null).label}
                </span>
              </div>
            </div>
            {error && (
              <p role="alert" className="text-[13px] text-red-700">
                {error}
              </p>
            )}
            {data && !data.topics.length && (
              <p className="mb-8 text-[13px] text-stone-500">
                {data.targetId
                  ? "У цели подготовки пока нет тем. Попросите Интервьюера исследовать вакансии (R) или расскажите о цели в чате."
                  : "Сначала создайте цель подготовки: расскажите о ней Интервьюеру в чате."}
              </p>
            )}
            {groups.map((group) => (
              <section key={group ?? ""} aria-label={group ?? "Темы"} className="mb-8">
                {group && <h3 className="mb-3 text-[12px] font-medium tracking-wider text-stone-400 uppercase">{group}</h3>}
                <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
                  {data?.topics
                    .filter((t) => t.group === group)
                    .map((t) => (
                      <TopicCard key={t.topicId} topic={t} open={() => setOpenTopic(t.topicId)} practise={() => props.practise(t.name)} />
                    ))}
                </div>
              </section>
            ))}
            <SkillMapHistory onDiscuss={props.discussed} />
          </>
        )}
      </div>

      <aside aria-label="Банк и предложенное" className="mr-4 mb-20 flex w-[380px] shrink-0 flex-col rounded-2xl border border-stone-200 bg-white">
        <div role="tablist" className="flex gap-1 border-b border-stone-100 p-2 text-[13px]">
          <TabButton selected={props.tab === "proposed"} onClick={() => props.setTab("proposed")}>
            Предложено
            {(data?.proposed ?? 0) > 0 && (
              <span className="ml-1 rounded-full bg-indigo-500 px-1.5 text-[10px] text-white">{data?.proposed}</span>
            )}
          </TabButton>
          <TabButton selected={props.tab === "bank"} onClick={() => props.setTab("bank")}>
            Банк вопросов
          </TabButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4">
          {props.tab === "proposed" ? (
            <ProposedPanel research={props.research} notify={props.notify} />
          ) : (
            <BankPanel openTopic={setOpenTopic} />
          )}
        </div>
      </aside>
    </div>
  );
}

function TabButton({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      className={cx("flex-1 rounded-lg py-1.5", selected ? "bg-stone-100 font-medium" : "text-stone-500")}
    >
      {children}
    </button>
  );
}

function TopicCard({ topic, open, practise }: { topic: SkillMapTopic; open: () => void; practise: () => void }) {
  const h = heat(topic.mastery);
  return (
    <div role="article" aria-label={topic.name} data-topic-id={topic.topicId} className="rounded-2xl border border-stone-200 bg-white p-4 transition hover:shadow-sm">
      <button type="button" onClick={open} className="flex w-full items-center gap-3 text-left">
        <Ring mastery={topic.mastery} />
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] leading-snug font-medium">{topic.name}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11.5px]">
            <span className={h.text}>{h.label}</span>
            {topic.due > 0 && <span className="rounded-full bg-indigo-50 px-1.5 font-medium text-indigo-700">{topic.due} к повторению</span>}
            <span className="text-stone-400">вопросов: {topic.questions}</span>
          </div>
        </div>
      </button>
      <button
        type="button"
        onClick={practise}
        className="mt-3 w-full rounded-lg border border-stone-200 py-1.5 text-[12.5px] text-stone-600 transition hover:border-indigo-300 hover:text-indigo-700"
      >
        Потренировать
      </button>
    </div>
  );
}
