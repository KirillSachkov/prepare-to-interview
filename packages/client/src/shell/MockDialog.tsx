// Starting a Mock interview: the Candidate picks its duration and focus; the request goes to the Chat.
import { useEffect, useState, type SyntheticEvent } from "react";
import type { MockRequest, TopicProgress } from "@prepare-to-interview/shared";
import { requestMock } from "../practice/mock-api.ts";
import { fetchProgress } from "../practice/practice-api.ts";
import { cx, Modal } from "./ui.tsx";

const durations = [15, 30, 45, 60];
type FocusKind = MockRequest["focus"]["kind"];
const focusKinds: [FocusKind, string][] = [
  ["weak_spots", "Слабые места"],
  ["target", "Вся цель"],
  ["topics", "Темы"],
];

export function MockDialog({ close, started }: { close: () => void; started: () => void }) {
  const [duration, setDuration] = useState(30);
  const [focus, setFocus] = useState<FocusKind>("weak_spots");
  const [chosen, setChosen] = useState<string[]>([]);
  const [topics, setTopics] = useState<TopicProgress[]>([]);
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);

  useEffect(() => {
    fetchProgress()
      .then((progress) => setTopics(progress.topics))
      .catch(() => undefined);
  }, []);

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    setSending(true);
    setError(undefined);
    const body: MockRequest = { durationMinutes: duration, focus: focus === "topics" ? { kind: "topics", topics: chosen } : { kind: focus } };
    requestMock(body)
      .then(started)
      .catch((e: unknown) => setError(`Не удалось начать интервью: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => setSending(false));
  };

  const chip = (active: boolean) =>
    cx("rounded-lg border px-3 py-1.5 text-[13px]", active ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-stone-200 text-stone-600 hover:border-stone-300");
  return (
    <Modal title="Мок-интервью" close={close} width={460}>
      <form onSubmit={submit} className="space-y-4">
        <fieldset>
          <legend className="mb-1.5 text-[12.5px] text-stone-600">Длительность</legend>
          <div className="flex gap-2" role="radiogroup" aria-label="Длительность">
            {durations.map((minutes) => (
              <button key={minutes} type="button" role="radio" aria-checked={duration === minutes} onClick={() => setDuration(minutes)} className={chip(duration === minutes)}>
                {minutes} мин
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-1.5 text-[12.5px] text-stone-600">Фокус</legend>
          <div className="flex gap-2" role="radiogroup" aria-label="Фокус">
            {focusKinds.map(([kind, label]) => (
              <button key={kind} type="button" role="radio" aria-checked={focus === kind} onClick={() => setFocus(kind)} className={chip(focus === kind)}>
                {label}
              </button>
            ))}
          </div>
          {focus === "topics" && (
            <div className="mt-2 max-h-52 space-y-0.5 overflow-y-auto">
              {topics.length === 0 && <p className="text-[12.5px] text-stone-500">У цели подготовки пока нет тем.</p>}
              {topics.map((topic) => (
                <label key={topic.name} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-[13px] text-stone-700 hover:bg-stone-50">
                  <input
                    type="checkbox"
                    checked={chosen.includes(topic.name)}
                    onChange={(e) => setChosen((c) => (e.target.checked ? [...c, topic.name] : c.filter((t) => t !== topic.name)))}
                  />
                  {topic.name}
                </label>
              ))}
            </div>
          )}
        </fieldset>
        <p className="text-[12px] text-stone-400">Интервьюер задаёт вопросы по одному и уточняет ответы. Оценки — в конце.</p>
        {error && (
          <p role="alert" className="text-[12.5px] text-red-700">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={close} className="rounded-lg px-3 py-1.5 text-[13px] text-stone-500 hover:bg-stone-100">
            Отмена
          </button>
          <button
            type="submit"
            disabled={sending || (focus === "topics" && !chosen.length)}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-[13px] text-white disabled:opacity-50"
          >
            Начать
          </button>
        </div>
      </form>
    </Modal>
  );
}
