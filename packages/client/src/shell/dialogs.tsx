import { settingsSections } from "../settings/sections.ts";
import type { CommandGroup, Commands } from "./commands.ts";
import { modLabel } from "./hotkeys.ts";
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
