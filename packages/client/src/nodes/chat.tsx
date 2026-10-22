// Placeholder Chat node: the Canvas shell's stand-in until the Chat itself lands (ticket #3).
import { commandEntry } from "../shell/menu.ts";
import { comingSoonLabel } from "../shell/ui.tsx";
import type { NodeTypeDefinition, NodeViewProps } from "./types.ts";

type Props = NodeViewProps<"chat">;

const Avatar = () => (
  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-indigo-100 text-[11px] font-semibold text-indigo-700">
    И
  </span>
);

function ChatView({ collapsed, setCollapsed }: Props) {
  if (collapsed) {
    return (
      <div className="drag flex w-[340px] cursor-grab items-center gap-2 rounded-2xl border border-stone-200 bg-white px-4 py-3 shadow-sm">
        <Avatar />
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-stone-500">Интервьюер</span>
        <button
          type="button"
          data-focus-target
          onClick={() => setCollapsed(false)}
          className="nodrag text-[11px] text-stone-400 hover:text-indigo-600"
        >
          развернуть
        </button>
      </div>
    );
  }
  return (
    <div className="flex h-[480px] w-[340px] flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,.04),0_8px_24px_rgba(0,0,0,.04)]">
      <div className="drag flex cursor-grab items-center gap-2 border-b border-stone-100 px-4 py-3 active:cursor-grabbing">
        <Avatar />
        <span className="text-[13px] font-semibold">Интервьюер</span>
        <button
          type="button"
          aria-label="Свернуть чат"
          title="Свернуть"
          onClick={() => setCollapsed(true)}
          className="nodrag ml-auto rounded px-1.5 text-[13px] text-stone-300 hover:bg-stone-100 hover:text-stone-500"
        >
          –
        </button>
      </div>
      <div className="grid flex-1 place-items-center px-6 text-center text-[12.5px] text-stone-400">
        Здесь будет разговор с Интервьюером.
      </div>
      <div className="border-t border-stone-100 p-3">
        <input
          data-focus-target
          disabled
          placeholder={`Написать интервьюеру… (${comingSoonLabel})`}
          className="nodrag w-full rounded-xl bg-stone-100/80 px-4 py-2.5 text-[13px] outline-none"
        />
      </div>
    </div>
  );
}

function ChatSummary() {
  return (
    <div className="drag flex h-[120px] w-[340px] items-center justify-center gap-3 rounded-2xl border border-stone-200 bg-white text-3xl font-semibold text-stone-600">
      Чат
    </div>
  );
}

export const chatNodeType: NodeTypeDefinition<"chat"> = {
  View: ChatView,
  Summary: ChatSummary,
  dragHandle: ".drag",
  menu: (node, commands) => [
    { label: node.collapsed ? "Развернуть" : "Свернуть", run: () => node.setCollapsed(!node.collapsed) },
    { label: "Новая тема разговора", hint: comingSoonLabel, disabled: true },
    "separator",
    commandEntry(commands["chat.toggle"], "Скрыть чат"),
  ],
};
