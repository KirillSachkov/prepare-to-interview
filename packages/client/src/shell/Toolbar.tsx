// Excalidraw-style floating toolbar at the top: tools, activity actions, view switch, and «Ещё».
import type { Command, CommandId, Commands } from "./commands.ts";
import { commandEntry, type MenuEntry } from "./menu.ts";
import { MenuList } from "./ContextMenu.tsx";
import { comingSoonLabel, cx, Icon, MenuHeading } from "./ui.tsx";

const groups: CommandId[][] = [
  ["tool.select", "tool.hand"],
  ["practice.today", "mock.start", "research.start", "bank.open"],
  ["view.skillMap"],
];

export function Toolbar({
  commands,
  moreOpen,
  setMoreOpen,
}: {
  commands: Commands;
  moreOpen: boolean;
  setMoreOpen: (open: boolean) => void;
}) {
  const grid = commands["view.grid"];
  const more: MenuEntry[] = [
    commandEntry(commands["quiz.start"]),
    commandEntry(commands["view.fitAll"]),
    commandEntry(grid, `Сетка: ${grid.active ? "вкл" : "выкл"}`),
    commandEntry(commands["view.zen"]),
    commandEntry(commands["help.shortcuts"]),
  ];
  return (
    <div
      className="pointer-events-none absolute top-4 left-1/2 z-30 flex -translate-x-1/2 flex-col items-center"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        role="toolbar"
        aria-label="Панель инструментов"
        className="pointer-events-auto flex items-center gap-0.5 rounded-xl border border-stone-200 bg-white p-1 shadow-[0_1px_3px_rgba(0,0,0,.06),0_6px_20px_rgba(0,0,0,.05)]"
      >
        {groups.map((ids, i) => (
          <div key={ids.join()} className="flex items-center gap-0.5">
            {i > 0 && <span className="mx-1 h-7 w-px bg-stone-200" />}
            {ids.map((id) => (
              <ToolButton key={id} command={commands[id]} />
            ))}
          </div>
        ))}
        <div className="relative">
          <ToolButton
            command={{ label: "Ещё", icon: "more", run: () => setMoreOpen(!moreOpen), active: moreOpen }}
          />
          {moreOpen && (
            <div
              role="menu"
              aria-label="Ещё"
              className="fade-in absolute top-12 right-0 w-64 rounded-xl border border-stone-200 bg-white p-1.5 shadow-lg"
            >
              <MenuList entries={more} close={() => setMoreOpen(false)} />
              <div role="separator" className="mx-2 my-1 h-px bg-stone-100" />
              <MenuHeading>История · {comingSoonLabel}</MenuHeading>
              <div className="px-2.5 pb-1.5 text-[12px] text-stone-400">
                Итоги попадут сюда сами при новой подборке или на следующий день.
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="mt-2 text-[11.5px] text-stone-400">
        Чтобы двигать холст, зажмите колесо мыши или пробел, либо выберите руку (H)
      </div>
    </div>
  );
}

type ToolButtonSpec = Pick<Command, "label" | "icon" | "hotkey" | "run" | "active" | "badge" | "accentBadge">;

function ToolButton({ command }: { command: ToolButtonSpec }) {
  const active = command.active;
  const available = Boolean(command.run);
  const hotkey = command.hotkey?.label;
  const tooltip = available ? command.label : `${command.label} · ${comingSoonLabel}`;
  return (
    <div className="group relative">
      <button
        type="button"
        aria-label={command.label}
        aria-pressed={active}
        disabled={!available}
        onClick={command.run}
        className={cx(
          "relative flex h-10 w-10 flex-col items-center justify-center rounded-lg transition disabled:opacity-35",
          active ? "bg-indigo-100 text-indigo-700" : "text-stone-600 hover:bg-stone-100",
        )}
      >
        {command.icon && <Icon name={command.icon} size={17} />}
        {hotkey && <span className="absolute right-1 bottom-0.5 text-[8.5px] leading-none text-stone-400">{hotkey}</span>}
        {command.badge !== undefined && (
          <span
            className={cx(
              "absolute -top-1 -right-1 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[9.5px] font-semibold",
              command.accentBadge ? "bg-indigo-500 text-white" : "bg-stone-800 text-white",
            )}
          >
            {command.badge}
          </span>
        )}
      </button>
      <div
        role="tooltip"
        className="pointer-events-none absolute top-12 left-1/2 z-40 hidden -translate-x-1/2 rounded-md bg-stone-900 px-2 py-1 text-[11.5px] whitespace-nowrap text-white group-hover:block"
      >
        {tooltip}
        {hotkey && <span className="ml-1.5 text-stone-400">{hotkey}</span>}
      </div>
    </div>
  );
}
