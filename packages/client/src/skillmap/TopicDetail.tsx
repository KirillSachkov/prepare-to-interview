// A Topic opened from the Skill map: its Questions with Sources and Attempt history, and the
// Reference answer the Candidate can edit or mark verified.
import { useState } from "react";
import type { AttemptRecord, BankQuestion } from "@prepare-to-interview/shared";
import { cx } from "../shell/ui.tsx";
import { SkillMapHistory } from "./history-slot.tsx";
import { fetchTopic, updateReference, useLive } from "./skillmap-api.ts";
import { heat, Ring, SourceLine } from "./ui.tsx";

const typeLabels: Record<BankQuestion["type"], string> = {
  open: "Развёрнутый ответ",
  single_choice: "Тест · один ответ",
  multiple_choice: "Тест · несколько ответов",
};

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function TopicDetail({
  topicId,
  back,
  practise,
  notify,
  discussed,
}: {
  topicId: string;
  back: () => void;
  practise: (topic: string) => void;
  notify: (text: string) => void;
  discussed: () => void;
}) {
  const { data, error, reload } = useLive(() => fetchTopic(topicId), topicId);
  const topic = data?.topic;
  return (
    <div>
      <button type="button" onClick={back} className="mb-4 text-[12.5px] text-stone-500 hover:text-indigo-700">
        ← Все темы
      </button>
      {error && (
        <p role="alert" className="text-[13px] text-red-700">
          {error}
        </p>
      )}
      {topic && (
        <div className="mb-6 flex items-center gap-4">
          <Ring mastery={topic.mastery} size={52} />
          <div className="min-w-0 flex-1">
            <h2 className="text-[20px] font-semibold">{topic.name}</h2>
            <div className="text-[12.5px] text-stone-500">
              {topic.group && `${topic.group} · `}
              <span className={heat(topic.mastery).text}>{heat(topic.mastery).label}</span>
              {topic.due > 0 && ` · к повторению ${String(topic.due)}`}
            </div>
            {topic.sources.length > 0 && (
              <div className="mt-1 text-[11.5px] text-stone-400">
                Источники:{" "}
                {topic.sources.map((s, i) => (
                  <span key={s.id}>
                    {i > 0 && ", "}
                    <SourceLine source={s} />
                  </span>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => practise(topic.name)}
            className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-[12.5px] text-stone-600 hover:border-indigo-300 hover:text-indigo-700"
          >
            Потренировать
          </button>
        </div>
      )}
      {data?.questions.length === 0 && <p className="text-[13px] text-stone-500">В теме пока нет вопросов.</p>}
      <div className="space-y-3">
        {data?.questions.map((q) => <QuestionItem key={q.id} question={q} saved={reload} notify={notify} />)}
      </div>
      {topic && <SkillMapHistory key={topic.id} topic={topic.name} onDiscuss={discussed} />}
    </div>
  );
}

function QuestionItem({ question: q, saved, notify }: { question: BankQuestion; saved: () => void; notify: (text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(q.referenceAnswer ?? "");
  const [busy, setBusy] = useState(false);

  const save = (update: { referenceAnswer?: string | null; verified?: boolean }) => {
    setBusy(true);
    updateReference(q.id, update)
      .then(() => {
        setEditing(false);
        saved();
      })
      .catch((e: unknown) => notify(`Не удалось сохранить эталон: ${reason(e)}`))
      .finally(() => setBusy(false));
  };

  return (
    <article aria-label={q.prompt} data-question-id={q.id} className="rounded-2xl border border-stone-200 bg-white p-4">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-[11.5px] text-stone-400">
        <span>{typeLabels[q.type]}</span>
        {q.topic && <span>· {q.topic}</span>}
        {q.status === "proposed" && <span className="rounded-full bg-indigo-50 px-1.5 text-indigo-700">предложено</span>}
        {q.due && <span className="rounded-full bg-indigo-50 px-1.5 font-medium text-indigo-700">к повторению</span>}
        {q.box !== null && <span>коробка {q.box}{q.dueOn && !q.due ? ` · повтор с ${q.dueOn}` : ""}</span>}
        {q.mastery !== null && <span className={heat(q.mastery).text}>освоение {Math.round(q.mastery * 100)}%</span>}
      </div>
      <h3 className="text-[14px] leading-snug font-medium text-stone-800">{q.prompt}</h3>
      {q.options && (
        <ul className="mt-2 space-y-0.5 text-[12.5px]">
          {q.options.map((o) => (
            <li key={o.text} className={o.correct ? "text-emerald-700" : "text-stone-500"}>
              {o.correct ? "✓" : "·"} {o.text}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 rounded-xl bg-stone-50 p-3 text-[12.5px]">
        <div className="mb-1 flex items-center gap-2">
          <span className="font-medium text-stone-600">Эталонный ответ</span>
          <span className={cx("rounded-full px-1.5 text-[11px]", q.verified ? "bg-emerald-50 text-emerald-700" : "bg-stone-200/70 text-stone-500")}>
            {q.verified ? "проверен" : "черновик"}
          </span>
          {!editing && (
            <button type="button" onClick={() => {
                setText(q.referenceAnswer ?? "");
                setEditing(true);
              }} className="ml-auto text-stone-500 hover:text-indigo-700">
              Изменить
            </button>
          )}
        </div>
        {editing ? (
          <div className="space-y-2">
            <textarea
              aria-label="Эталонный ответ"
              value={text}
              rows={4}
              maxLength={10_000}
              onChange={(e) => setText(e.target.value)}
              className="w-full resize-y rounded-lg border border-stone-200 bg-white px-3 py-2 text-[12.5px] outline-none focus:border-indigo-300"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(false)} className="rounded-lg px-3 py-1 text-stone-500 hover:bg-stone-100">
                Отмена
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => save({ referenceAnswer: text })}
                className="rounded-lg bg-indigo-600 px-3 py-1 text-white disabled:opacity-50"
              >
                Сохранить
              </button>
            </div>
          </div>
        ) : (
          <p className="whitespace-pre-wrap text-stone-600">{q.referenceAnswer ?? "Эталона пока нет."}</p>
        )}
        {q.referenceAnswer && !editing && (
          <button
            type="button"
            disabled={busy}
            onClick={() => save({ verified: !q.verified })}
            className="mt-2 rounded-md border border-stone-200 bg-white px-2 py-1 text-[12px] text-stone-600 hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-50"
          >
            {q.verified ? "Снять отметку «проверен»" : "Отметить эталон проверенным"}
          </button>
        )}
        {q.sources.length > 0 && (
          <div className="mt-2 text-[11.5px] text-stone-400">
            Источники:{" "}
            {q.sources.map((s, i) => (
              <span key={s.id}>
                {i > 0 && ", "}
                <SourceLine source={s} />
              </span>
            ))}
          </div>
        )}
      </div>

      <AttemptHistory attempts={q.attempts} />
    </article>
  );
}

const modeLabels: Record<AttemptRecord["mode"], string> = { training: "тренировка", mock: "мок" };

function AttemptHistory({ attempts }: { attempts: AttemptRecord[] }) {
  if (!attempts.length) return <p className="mt-3 text-[12px] text-stone-400">Попыток пока нет.</p>;
  return (
    <section aria-label="История попыток" className="mt-3">
      <h4 className="mb-1.5 text-[11px] font-medium tracking-wider text-stone-400 uppercase">История попыток</h4>
      <ol className="space-y-2">
        {attempts.map((a) => (
          <li key={a.id} className="border-l-2 border-stone-200 pl-3 text-[12.5px]">
            <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-stone-400">
              <span>{new Date(a.createdAt).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}</span>
              <span>· {modeLabels[a.mode]}</span>
              {a.hintRung > 0 && <span>· подсказок: {a.hintRung}</span>}
              {a.retry && <span>· повторная попытка, не в статистике</span>}
              <span className={cx("ml-auto font-medium", a.status === "skipped" ? "text-stone-500" : (a.score ?? 0) >= 3 ? "text-emerald-700" : (a.score ?? 0) >= 2 ? "text-amber-700" : "text-rose-700")}>
                {a.status === "skipped" ? "Пропущено" : `${String(a.score ?? 0)}/${String(a.maxScore)}`}
              </span>
            </div>
            {a.quote && <p className="text-stone-700">«{a.quote}»</p>}
            {a.strengths && <p className="text-stone-600">Верно: {a.strengths}</p>}
            {a.gap && <p className="text-stone-600">Не хватает: {a.gap}</p>}
            {a.answer && (
              <details className="text-stone-500">
                <summary className="cursor-pointer text-[11.5px]">Ответ</summary>
                <p className="whitespace-pre-wrap">{a.answer}</p>
              </details>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
