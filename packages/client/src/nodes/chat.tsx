// The Chat node type: the Chat itself (ticket #3) plus the shell's collapsed bar, zoomed-out summary,
// and context-menu items.
import { ChatNode } from "../chat/ChatNode.tsx";
import { commandEntry } from "../shell/menu.ts";
import { comingSoonLabel } from "../shell/ui.tsx";
import type { NodeTypeDefinition, NodeViewProps } from "./types.ts";

type Props = NodeViewProps<"chat">;

function ChatView({ collapsed, setCollapsed, selected }: Props) {
  if (!collapsed) return <ChatNode selected={selected} />;
  return (
    <div className="chat-drag-handle flex w-[340px] cursor-grab items-center gap-2 rounded-2xl border border-stone-200 bg-white px-4 py-3 shadow-sm">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-indigo-100 text-[11px] font-semibold text-indigo-700">
        И
      </span>
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-stone-500">Interviewer</span>
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

function ChatSummary() {
  return (
    <div className="chat-drag-handle flex h-full min-h-[120px] w-full min-w-[340px] items-center justify-center rounded-2xl border border-stone-200 bg-white text-3xl font-semibold text-stone-600">
      Чат
    </div>
  );
}

export const chatNodeType: NodeTypeDefinition<"chat"> = {
  View: ChatView,
  Summary: ChatSummary,
  size: { width: 400, height: 560 },
  dragHandle: ".chat-drag-handle",
  menu: (node, { commands }) => [
    { label: node.collapsed ? "Развернуть" : "Свернуть", run: () => node.setCollapsed(!node.collapsed) },
    { label: "Новая тема разговора", hint: comingSoonLabel, disabled: true },
    "separator",
    commandEntry(commands["chat.toggle"], "Скрыть чат"),
  ],
};
