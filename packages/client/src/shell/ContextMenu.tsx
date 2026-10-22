// Right-click menu and the shared list renderer used by every dropdown in the shell.
import { useLayoutEffect, useRef, useState } from "react";
import type { MenuEntry } from "./menu.ts";
import { MenuRow, MenuSeparator } from "./ui.tsx";

export function MenuList({ entries, close }: { entries: MenuEntry[]; close: () => void }) {
  return (
    <>
      {entries.map((entry, i) =>
        entry === "separator" ? (
          <MenuSeparator key={`separator-${i}`} />
        ) : (
          <MenuRow
            key={entry.label}
            hint={entry.hint}
            disabled={entry.disabled ?? !entry.run}
            onClick={() => {
              entry.run?.();
              close();
            }}
          >
            {entry.label}
          </MenuRow>
        ),
      )}
    </>
  );
}

export interface OpenMenu {
  x: number;
  y: number;
  /** Which target the menu belongs to, for tests and assistive technology. */
  target: string;
  entries: MenuEntry[];
}

/** Opens at the cursor and stays inside the window. */
export function ContextMenu({ menu, close }: { menu: OpenMenu; close: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: menu.x, y: menu.y });
  useLayoutEffect(() => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    // Measuring the rendered menu is the only way to keep it inside the window.
    setPosition({
      x: Math.max(8, Math.min(menu.x, window.innerWidth - rect.width - 8)),
      y: Math.max(8, Math.min(menu.y, window.innerHeight - rect.height - 8)),
    });
  }, [menu.x, menu.y]);

  return (
    <div
      className="fixed inset-0 z-50"
      onMouseDown={close}
      onContextMenu={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div
        ref={ref}
        role="menu"
        aria-label={menu.target}
        data-menu-target={menu.target}
        className="absolute w-60 rounded-xl border border-stone-200 bg-white p-1.5 shadow-[0_8px_30px_rgba(0,0,0,.12)]"
        style={{ left: position.x, top: position.y }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <MenuList entries={menu.entries} close={close} />
      </div>
    </div>
  );
}
