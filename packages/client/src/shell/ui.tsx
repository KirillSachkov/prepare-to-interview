// Small presentational pieces of the Canvas shell, ported from prototype variant A.
import type { ReactNode } from "react";

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

const icons = {
  select: ["M5 3l14 8-6 1.5L10 19z"],
  hand: [
    "M18 11V6a2 2 0 0 0-4 0v5",
    "M14 10V4a2 2 0 0 0-4 0v6",
    "M10 10.5V6a2 2 0 0 0-4 0v8",
    "M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.3l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15",
  ],
  set: ["M8 3h12v12", "M4 7h12v13H4z"],
  mock: ["M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z", "M19 10v2a7 7 0 0 1-14 0v-2", "M12 19v3"],
  research: ["M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14z", "M21 21l-4.3-4.3"],
  bank: [
    "M22 12h-6l-2 3h-4l-2-3H2",
    "M5.5 5.1L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z",
  ],
  map: ["M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z", "M9 3v15", "M15 6v15"],
  more: ["M5 12h.01", "M12 12h.01", "M19 12h.01"],
  burger: ["M4 6h16", "M4 12h16", "M4 18h16"],
  chat: ["M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"],
} as const;

export type IconName = keyof typeof icons;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === "more" ? 3 : 1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {icons[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-stone-200 bg-stone-50 px-1 font-sans text-[10.5px] text-stone-500">
      {children}
    </kbd>
  );
}

export const comingSoonLabel = "скоро";

export function MenuRow({
  children,
  onClick,
  active,
  hint,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "flex w-full items-center gap-3 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-indigo-50/70 disabled:pointer-events-none disabled:opacity-40",
        active && "font-medium text-indigo-700",
      )}
    >
      <span className="flex flex-1 items-center">{children}</span>
      {hint && <span className="text-[11.5px] text-stone-400">{hint}</span>}
    </button>
  );
}

export const MenuSeparator = () => <div role="separator" className="mx-2 my-1 h-px bg-stone-100" />;

export function MenuHeading({ children }: { children: ReactNode }) {
  return (
    <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium tracking-wider text-stone-400 uppercase">{children}</div>
  );
}

export function Modal({
  title,
  close,
  children,
  width = 560,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  width?: number;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-stone-900/15" onMouseDown={close}>
      <div
        role="dialog"
        aria-label={title}
        className="fade-in max-h-[85vh] overflow-y-auto rounded-2xl border border-stone-200 bg-white p-6 shadow-2xl"
        style={{ width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center">
          <h2 className="text-[16px] font-semibold">{title}</h2>
          <button
            type="button"
            aria-label="Закрыть"
            onClick={close}
            className="ml-auto rounded-lg px-2 py-1 text-stone-400 hover:bg-stone-100"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
