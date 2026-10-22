// The Skill map's side panel: the Proposed queue (Research output awaiting approval, by batch)
// and the shared Question bank by Topic with filters.
import { useState } from "react";
import type { ProposedBatch, ReviewRequest, SourceRef } from "@prepare-to-interview/shared";
import { cx } from "../shell/ui.tsx";
import { fetchBank, fetchProposed, review, useLive } from "./skillmap-api.ts";
import { heat, SourceLine } from "./ui.tsx";

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function ProposedPanel({ research, notify }: { research: () => void; notify: (text: string) => void }) {
  const { data, error, reload } = useLive(fetchProposed);
  const [busy, setBusy] = useState(false);
  const decide = (body: ReviewRequest) => {
    setBusy(true);
    review(body)
      .then(reload)
      .catch((e: unknown) => notify(`Не удалось сохранить решение: ${reason(e)}`))
      .finally(() => setBusy(false));
  };
  return (
    <div aria-label="Предложено">
      <p className="py-3 text-[12px] text-stone-500">Найдено Интервьюером. В банк попадёт только одобренное.</p>
      {error && (
        <p role="alert" className="text-[12.5px] text-red-700">
          {error}
        </p>
      )}
      {data?.count === 0 && <p className="py-3 text-[13px] text-stone-400">Очередь пуста.</p>}
      {data?.batches.map((batch) => (
        <Batch key={batch.id ?? "interviewer"} batch={batch} busy={busy} decide={decide} />
      ))}
      <div className="flex gap-2 py-4">
        {(data?.count ?? 0) > 1 && (
          <button
            type="button"
            disabled={busy}
            onClick={() => decide({ action: "approve", all: true })}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-50"
          >
            Одобрить все
          </button>
        )}
        <button type="button" onClick={research} className="rounded-lg px-3 py-1.5 text-[12.5px] text-stone-600 hover:bg-stone-100">
          Исследовать ещё <span className="text-stone-400">R</span>
        </button>
      </div>
    </div>
  );
}

function Batch({ batch, busy, decide }: { batch: ProposedBatch; busy: boolean; decide: (body: ReviewRequest) => void }) {
  const title = batch.id
    ? `Исследование${batch.startedAt ? ` · ${new Date(batch.startedAt).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}` : ""}`
    : "Предложено в чате";
  const items = batch.topics.length + batch.questions.length;
  return (
    <section aria-label={title} className="mb-3 rounded-xl border border-stone-100 p-3">
      <div className="flex items-center gap-2">
        <h3 className="text-[12.5px] font-medium text-stone-700">{title}</h3>
        {batch.targetName && <span className="text-[11.5px] text-stone-400">· {batch.targetName}</span>}
        {batch.running && <span className="text-[11.5px] text-indigo-600">· идёт…</span>}
      </div>
      {batch.summary && <p className="mt-1 text-[12px] text-stone-500">{batch.summary}</p>}
      <ul className="divide-y divide-stone-100">
        {batch.topics.map((t) => (
          <Item
            key={t.id}
            label={`Новая тема${t.group ? ` · ${t.group}` : ""}`}
            title={t.name}
            detail={t.reason}
            sources={t.sources}
            busy={busy}
            decide={(action) => decide({ action, topics: [t.id] })}
          />
        ))}
        {batch.questions.map((q) => (
          <Item
            key={q.id}
            label={`Вопрос · ${q.topic}`}
            title={q.prompt}
            detail={q.referenceAnswer && `Эталон: ${q.referenceAnswer}`}
            sources={q.sources}
            busy={busy}
            decide={(action) => decide({ action, questions: [q.id] })}
          />
        ))}
      </ul>
      {items > 1 && (
        <div className="flex gap-1 pt-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => decide({ action: "approve", batchId: batch.id })}
            className="rounded-md bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
          >
            Одобрить пакет
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => decide({ action: "reject", batchId: batch.id })}
            className="rounded-md px-2 py-1 text-xs text-stone-500 hover:bg-stone-100 disabled:opacity-50"
          >
            Отклонить пакет
          </button>
        </div>
      )}
    </section>
  );
}

function Item(props: {
  label: string;
  title: string;
  detail: string | null;
  sources: SourceRef[];
  busy: boolean;
  decide: (action: "approve" | "reject") => void;
}) {
  return (
    <li aria-label={props.title} className="fade-in flex items-start gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-stone-400">{props.label}</div>
        <div className="text-[13px] leading-snug font-medium text-stone-800">{props.title}</div>
        {props.detail && <div className="mt-0.5 line-clamp-2 text-[11.5px] text-stone-500">{props.detail}</div>}
        {props.sources.length > 0 && (
          <div className="mt-0.5 truncate text-[11px] text-stone-400">
            Источник:{" "}
            {props.sources.map((s, i) => (
              <span key={s.id}>
                {i > 0 && ", "}
                <SourceLine source={s} />
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="flex shrink-0 gap-1">
        <button
          type="button"
          disabled={props.busy}
          onClick={() => props.decide("reject")}
          className="rounded-md px-2 py-1 text-xs text-stone-400 hover:bg-stone-100 disabled:opacity-50"
        >
          Нет
        </button>
        <button
          type="button"
          disabled={props.busy}
          onClick={() => props.decide("approve")}
          className="rounded-md bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
        >
          Одобрить
        </button>
      </div>
    </li>
  );
}

type TypeFilter = "all" | "open" | "test";

export function BankPanel({ openTopic }: { openTopic: (topicId: string) => void }) {
  const { data, error } = useLive(fetchBank);
  const [open, setOpen] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [type, setType] = useState<TypeFilter>("all");
  const needle = query.trim().toLocaleLowerCase();
  const topics = (data?.topics ?? [])
    .map((t) => ({
      ...t,
      questions: t.questions.filter(
        (q) =>
          (type === "all" || (type === "open") === (q.type === "open")) &&
          (!needle || q.prompt.toLocaleLowerCase().includes(needle) || t.name.toLocaleLowerCase().includes(needle)),
      ),
    }))
    .filter((t) => t.questions.length);
  const filtering = needle !== "" || type !== "all";
  return (
    <div aria-label="Банк вопросов" className="py-2">
      <div className="mb-2 flex gap-2">
        <input
          type="search"
          aria-label="Найти в банке"
          placeholder="Найти вопрос или тему"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-stone-200 px-2.5 py-1.5 text-[12.5px] outline-none focus:border-indigo-300"
        />
        <select
          aria-label="Тип вопроса"
          value={type}
          onChange={(e) => setType(e.target.value as TypeFilter)}
          className="rounded-lg border border-stone-200 px-2 text-[12.5px] text-stone-600"
        >
          <option value="all">Все</option>
          <option value="open">Ответ</option>
          <option value="test">Тест</option>
        </select>
      </div>
      {error && (
        <p role="alert" className="text-[12.5px] text-red-700">
          {error}
        </p>
      )}
      {data && !topics.length && <p className="py-3 text-[13px] text-stone-400">{filtering ? "Ничего не нашлось." : "Банк пока пуст."}</p>}
      <ul>
        {topics.map((t) => {
          const expanded = filtering || open === t.topicId;
          return (
            <li key={t.topicId}>
              <div className={cx("flex items-center gap-2 rounded-lg px-2 py-2 text-[13px] hover:bg-stone-50", expanded && "bg-stone-50")}>
                <button type="button" aria-expanded={expanded} onClick={() => setOpen(open === t.topicId ? null : t.topicId)} className="flex flex-1 items-center gap-2 text-left">
                  <span className="h-2 w-2 rounded-full" style={{ background: heat(t.mastery).stroke }} />
                  <span className="flex-1">{t.name}</span>
                  <span className="text-[11.5px] text-stone-400">{t.questions.length}</span>
                </button>
                <button type="button" onClick={() => openTopic(t.topicId)} className="text-[11.5px] text-stone-400 hover:text-indigo-700">
                  Открыть
                </button>
              </div>
              {expanded && (
                <ul className="mb-2 ml-6 space-y-1.5">
                  {t.questions.map((q) => (
                    <li key={q.id} className="text-[12.5px] leading-snug text-stone-600">
                      {q.prompt} <span className="text-stone-300">· {q.type === "open" ? "ответ" : "тест"}</span>
                      {q.verified && <span className="text-emerald-600"> · проверен</span>}
                      {q.due && <span className="text-indigo-600"> · повторить</span>}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
