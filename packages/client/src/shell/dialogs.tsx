import { useEffect, useId, useState, type SyntheticEvent } from "react";
import type { TopicProgress } from "@prepare-to-interview/shared";
import { fetchProgress } from "../practice/practice-api.ts";
import { settingsSections } from "../settings/sections.ts";
import type { CommandGroup, Commands } from "./commands.ts";
import { modLabel } from "./hotkeys.ts";
import { addOwnQuestion, fetchTopics } from "./target.ts";
import { comingSoonLabel, Kbd, MenuRow, Modal } from "./ui.tsx";

const groupOrder: CommandGroup[] = ["Инструменты", "Холст", "Карточки", "Вид"];

/** Mouse and trackpad gestures, listed next to the hotkeys of their group. */
const gestures: Partial<Record<CommandGroup, [string, string][]>> = {
  Холст: [
    ["Двигать", "колесо / пробел + тащить / средняя кнопка"],
    ["Масштаб", `${modLabel} + колесо, щипок`],
    ["Выделить рамкой", "тащить по пустому месту"],
  ],
  Карточки: [["Действия с карточкой", "правый клик"]],
};

/** Lists every command that has a hotkey, so a new hotkey shows up here without extra work. */
export function ShortcutsDialog({ commands, close }: { commands: Commands; close: () => void }) {
  const all = Object.values(commands);
  return (
    <Modal title="Горячие клавиши" close={close} width={720}>
      <div className="grid grid-cols-2 gap-x-8 gap-y-5">
        {groupOrder.map((group) => (
          <section key={group} aria-label={group}>
            <div className="mb-1.5 text-[11px] font-medium tracking-wider text-stone-400 uppercase">{group}</div>
            {all
              .filter((command) => command.group === group && command.hotkey)
              .map((command) => (
                <Row
                  key={command.id}
                  action={command.run ? command.label : `${command.label} · ${comingSoonLabel}`}
                  keys={command.hotkey?.label ?? ""}
                />
              ))}
            {gestures[group]?.map(([action, keys]) => <Row key={action} action={action} keys={keys} />)}
          </section>
        ))}
      </div>
      <p className="mt-4 text-[12px] text-stone-400">
        Пока курсор в поле ответа, буквенные клавиши печатают текст и не срабатывают как команды.
      </p>
    </Modal>
  );
}

function Row({ action, keys }: { action: string; keys: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-stone-100 py-1.5 text-[13px]">
      <span className="text-stone-700">{action}</span>
      <Kbd>{keys}</Kbd>
    </div>
  );
}

export function SettingsDialog({ close }: { close: () => void }) {
  return (
    <Modal title="Настройки" close={close} width={460}>
      {settingsSections.length ? (
        <div className="space-y-5">
          {settingsSections.map(({ id, title, Panel }) => (
            <section key={id} aria-label={title}>
              <h3 className="mb-2 text-[13px] font-semibold text-stone-700">{title}</h3>
              <Panel />
            </section>
          ))}
        </div>
      ) : (
        <p className="text-[13px] text-stone-500">Настройки появятся позже.</p>
      )}
    </Modal>
  );
}

/** The Candidate's own Question, such as one from a real interview, saved straight into the bank. */
export function QuestionDialog({ close, added }: { close: () => void; added: (topic: string) => void }) {
  const [topics, setTopics] = useState<string[]>([]);
  const [topic, setTopic] = useState("");
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const listId = useId();

  useEffect(() => {
    fetchTopics()
      .then((response) => setTopics(response.topics))
      .catch(() => undefined);
  }, []);

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(undefined);
    addOwnQuestion({ topic: topic.trim(), prompt: prompt.trim() })
      .then((response) => added(response.topic))
      .catch((e: unknown) => setError(`Не удалось добавить вопрос: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => setSaving(false));
  };

  const field = "w-full rounded-lg border border-stone-200 px-3 py-2 text-[13px] outline-none focus:border-indigo-300";
  return (
    <Modal title="Свой вопрос" close={close} width={480}>
      <form onSubmit={submit} className="space-y-3">
        <label className="block text-[12.5px] text-stone-600">
          Вопрос
          <textarea
            autoFocus
            required
            maxLength={4000}
            rows={4}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Например, вопрос с прошлого собеседования"
            className={`${field} mt-1 resize-y`}
          />
        </label>
        <label className="block text-[12.5px] text-stone-600">
          Тема
          <input
            required
            maxLength={120}
            list={listId}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Выберите тему или введите новую"
            className={`${field} mt-1`}
          />
          <datalist id={listId}>
            {topics.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </label>
        {error && (
          <p role="alert" className="text-[12.5px] text-red-700">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={close} className="rounded-lg px-3 py-1.5 text-[13px] text-stone-500 hover:bg-stone-100">
            Отмена
          </button>
          <button
            type="submit"
            disabled={saving || !prompt.trim() || !topic.trim()}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-[13px] text-white disabled:opacity-50"
          >
            Добавить в банк
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Topics of the active Preparation target with their Mastery; choosing one asks for a Practice set on it. */
export function TopicPracticeDialog({ close, choose }: { close: () => void; choose: (topic: string) => void }) {
  const [topics, setTopics] = useState<TopicProgress[]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    fetchProgress()
      .then((progress) => setTopics(progress.topics))
      .catch((e: unknown) => setError(`Не удалось загрузить темы: ${e instanceof Error ? e.message : String(e)}`));
  }, []);

  return (
    <Modal title="Подборка по теме" close={close} width={420}>
      {error && (
        <p role="alert" className="text-[12.5px] text-red-700">
          {error}
        </p>
      )}
      {topics?.length === 0 && <p className="text-[13px] text-stone-500">У цели подготовки пока нет тем. Расскажите о ней Интервьюеру в чате.</p>}
      <div className="max-h-80 space-y-0.5 overflow-y-auto">
        {topics?.map((topic) => (
          <MenuRow key={topic.name} hint={topic.mastery === null ? "не начата" : `${Math.round(topic.mastery * 100)}%`} onClick={() => choose(topic.name)}>
            <span className="mr-2 h-2 w-2 shrink-0 rounded-full" style={{ background: heat(topic.mastery) }} />
            {topic.name}
            {topic.due > 0 && <span className="ml-2 text-[11px] text-stone-400">повторить {topic.due}</span>}
          </MenuRow>
        ))}
      </div>
    </Modal>
  );
}

/** Mastery colour: grey for a never-touched Topic, then red, amber, green. */
function heat(mastery: number | null): string {
  if (mastery === null) return "#d6d3d1";
  if (mastery < 0.4) return "#e11d48";
  if (mastery < 0.7) return "#d97706";
  return "#059669";
}
