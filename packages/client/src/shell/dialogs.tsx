import { useEffect, useId, useState, type SyntheticEvent } from "react";
import { settingsSections } from "../settings/sections.ts";
import type { CommandGroup, Commands } from "./commands.ts";
import { modLabel } from "./hotkeys.ts";
import { addOwnQuestion, fetchTopics } from "./target.ts";
import { comingSoonLabel, Kbd, Modal } from "./ui.tsx";

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
