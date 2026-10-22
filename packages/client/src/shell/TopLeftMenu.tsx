// Top-left hamburger with the Preparation target switcher, «Новая цель», history, and settings, plus the
// compact chip with the active target, readiness, and days left.
import type { Commands } from "./commands.ts";
import { MenuList } from "./ContextMenu.tsx";
import { commandEntry } from "./menu.ts";
import { useTargets } from "./target.ts";
import { cx, Icon, MenuHeading, MenuRow, MenuSeparator } from "./ui.tsx";

export function TopLeftMenu({
  commands,
  open,
  setOpen,
  openSettings,
}: {
  commands: Commands;
  open: boolean;
  setOpen: (open: boolean) => void;
  openSettings: () => void;
}) {
  const { active, all, switchTo, error } = useTargets();
  const close = () => setOpen(false);
  return (
    <div className="absolute top-4 left-4 z-30 flex items-center gap-2" onMouseDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-label="Меню"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cx(
          "grid h-10 w-10 place-items-center rounded-xl border shadow-sm",
          open ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "border-stone-200 bg-white text-stone-600",
        )}
      >
        <Icon name="burger" />
      </button>
      <button
        type="button"
        aria-label="Цель подготовки"
        onClick={() => setOpen(!open)}
        className="flex h-10 items-center gap-2 rounded-xl border border-stone-200 bg-white/90 px-3 text-[12.5px] shadow-sm backdrop-blur"
      >
        <span className="font-semibold text-stone-800">{active?.name ?? "Цель не выбрана"}</span>
        <span className="text-stone-300">·</span>
        <span className="text-indigo-600 tabular-nums">{percent(active?.readiness)}</span>
        {active && active.daysLeft !== null && (
          <>
            <span className="text-stone-300">·</span>
            <span className="text-stone-500">{daysLeft(active.daysLeft)}</span>
          </>
        )}
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Меню"
          className="fade-in absolute top-12 left-0 w-64 rounded-xl border border-stone-200 bg-white p-1.5 shadow-lg"
        >
          <MenuHeading>Цель подготовки</MenuHeading>
          {all.map((target) => (
            <MenuRow
              key={target.id}
              active={target.id === active?.id}
              onClick={() => {
                if (target.id !== active?.id) switchTo(target.id);
                close();
              }}
            >
              <span className="flex-1">
                {target.name} {target.grade && <span className="text-stone-400">· {target.grade}</span>}
              </span>
              {target.daysLeft !== null && <span className="text-[11px] text-stone-400">{daysLeft(target.daysLeft)}</span>}
            </MenuRow>
          ))}
          {!all.length && <div className="px-2.5 py-1 text-[12px] text-stone-400">Целей пока нет.</div>}
          {error && (
            <div role="alert" className="px-2.5 py-1 text-[12px] text-red-700">
              {error}
            </div>
          )}
          <MenuList entries={[commandEntry(commands["target.new"])]} close={close} />
          <MenuSeparator />
          <div className="px-2.5 py-1.5 text-[12px] text-stone-500">
            Готовность <b className="text-stone-800">{percent(active?.readiness)}</b> · в повторении{" "}
            {active?.due ?? "—"}
            {active?.interviewDate && (
              <div className="text-stone-400">Собеседование {formatDate(active.interviewDate)}</div>
            )}
          </div>
          <MenuSeparator />
          <MenuList entries={[commandEntry(commands["history.open"]), { label: "Настройки", run: openSettings }]} close={close} />
        </div>
      )}
    </div>
  );
}

const percent = (value: number | null | undefined) => (value === null || value === undefined ? "—" : `${value}%`);

const daysLeft = (days: number) => (days === 0 ? "сегодня" : `${days} дн.`);

/** `2026-11-05` as «5 нояб. 2026 г.» in the Candidate's locale conventions. */
function formatDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
