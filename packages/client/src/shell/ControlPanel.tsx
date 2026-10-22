// The Control panel (GLOSSARY, ADR-0004): the fixed chrome over the Canvas with Preparation targets,
// overall readiness, and actions. In variant A it is split into the top-left menu with its target
// chip, the floating toolbar, and the Chat toggle; Zen mode hides it.
import type { Commands } from "./commands.ts";
import { Toolbar } from "./Toolbar.tsx";
import { TopLeftMenu } from "./TopLeftMenu.tsx";
import { cx, Icon } from "./ui.tsx";

export type ControlPanelPopover = "menu" | "more";

export function ControlPanel({
  commands,
  popover,
  setPopover,
  openSettings,
}: {
  commands: Commands;
  popover: ControlPanelPopover | null;
  setPopover: (popover: ControlPanelPopover | null) => void;
  openSettings: () => void;
}) {
  const chat = commands["chat.toggle"];
  return (
    <section aria-label="Панель управления" className="contents">
      <TopLeftMenu
        commands={commands}
        open={popover === "menu"}
        setOpen={(open) => setPopover(open ? "menu" : null)}
        openSettings={openSettings}
      />
      <Toolbar commands={commands} moreOpen={popover === "more"} setMoreOpen={(open) => setPopover(open ? "more" : null)} />
      <div className="absolute top-4 right-4 z-30">
        <button
          type="button"
          aria-label="Чат"
          aria-pressed={chat.active}
          title={`${chat.label} — ${chat.hotkey?.label ?? ""}`}
          onClick={chat.run}
          className={cx(
            "flex h-10 items-center gap-2 rounded-xl border px-3 text-[13px] shadow-sm",
            chat.active ? "border-indigo-100 bg-indigo-50 text-indigo-700" : "border-stone-200 bg-white text-stone-500",
          )}
        >
          <Icon name="chat" /> Чат
        </button>
      </div>
    </section>
  );
}
