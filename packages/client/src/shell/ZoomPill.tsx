import { useStore } from "@xyflow/react";
import type { Commands } from "./commands.ts";

/** Bottom-left − % + control; clicking the percentage resets to 100%. */
export function ZoomPill({ commands }: { commands: Commands }) {
  const zoom = useStore((s) => s.transform[2]);
  const { "zoom.in": zoomIn, "zoom.out": zoomOut, "zoom.reset": reset } = commands;
  return (
    <div className="absolute bottom-4 left-4 z-30 flex items-center rounded-xl border border-stone-200 bg-white shadow-sm">
      <button
        type="button"
        aria-label="Отдалить"
        title={`Отдалить — ${zoomOut.hotkey?.label ?? ""}`}
        onClick={zoomOut.run}
        className="h-9 w-9 rounded-l-xl text-[16px] text-stone-500 hover:bg-stone-100"
      >
        −
      </button>
      <button
        type="button"
        aria-label="Сбросить масштаб"
        title={`Сбросить до 100% — ${reset.hotkey?.label ?? ""}`}
        onClick={reset.run}
        className="h-9 min-w-14 px-1 text-[12.5px] text-stone-600 tabular-nums hover:bg-stone-100"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        type="button"
        aria-label="Приблизить"
        title={`Приблизить — ${zoomIn.hotkey?.label ?? ""}`}
        onClick={zoomIn.run}
        className="h-9 w-9 rounded-r-xl text-[16px] text-stone-500 hover:bg-stone-100"
      >
        +
      </button>
    </div>
  );
}
