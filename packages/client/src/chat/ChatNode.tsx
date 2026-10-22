import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { NodeResizer } from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";
import { agentLabels, type AgentId, type ChatMessage } from "@prepare-to-interview/shared";
import { Markdown } from "./markdown.tsx";
import { ProposalCard } from "./ProposalCard.tsx";
import { AgentSettingsPanel } from "../settings/AgentSettingsPanel.tsx";
import { focusCard } from "../practice/focus.ts";
import { fetchAgents } from "./chat-api.ts";
import { useChat } from "./useChat.ts";

function toThreadMessage(message: ChatMessage): ThreadMessageLike {
  const content = [{ type: "text" as const, text: message.text }];
  const createdAt = new Date(message.createdAt);
  if (message.role === "candidate") return { id: message.id, role: "user", content, createdAt };
  if (message.role === "notice") return { id: message.id, role: "system", content, createdAt };
  const status: ThreadMessageLike["status"] =
    message.status === "streaming"
      ? { type: "running" }
      : message.status === "complete"
        ? { type: "complete", reason: "stop" }
        : { type: "incomplete", reason: message.status === "cancelled" ? "cancelled" : "error" };
  return { id: message.id, role: "assistant", content, createdAt, status };
}

function textOf(message: AppendMessage): string {
  return message.content.map((part) => (part.type === "text" ? part.text : "")).join("");
}

/** Class of the parts that drag the Chat node (its header, collapsed bar, and summary). */
export const chatDragHandleClass = "chat-drag-handle";

/**
 * Chat node: streamed Interviewer replies, stop, and the stored history, on the Candidate's agent.
 * Registered as the `chat` node type in `nodes/chat.tsx`; the header is its drag handle.
 */
export function ChatNode({ selected }: { selected: boolean }) {
  const chat = useChat();
  const [agent, setAgent] = useState<AgentId | null>();
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (settingsOpen) return;
    fetchAgents()
      .then((response) => {
        setAgent(response.settings.agent);
        if (!response.settings.agent) setSettingsOpen(true);
      })
      .catch(() => setAgent(null));
  }, [settingsOpen]);

  const byId = useMemo(() => new Map(chat.messages.map((m) => [m.id, m])), [chat.messages]);
  const runtime = useExternalStoreRuntime({
    messages: chat.messages,
    isRunning: chat.busy,
    convertMessage: toThreadMessage,
    onNew: (message) => chat.send(textOf(message)),
    onCancel: () => chat.stop(),
  });

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-stone-300 bg-white shadow-md">
      <NodeResizer isVisible={selected} minWidth={320} minHeight={320} />
      <header className={`${chatDragHandleClass} flex cursor-grab items-center justify-between border-b border-stone-200 px-3 py-2`}>
        <div>
          <div className="text-sm font-medium text-stone-900">Интервьюер</div>
          <div className="text-xs text-stone-500">{agent ? `на ${agentLabels[agent]}` : "Агент не выбран"}</div>
        </div>
        <button
          type="button"
          className="nodrag rounded px-2 py-1 text-xs text-stone-600 hover:bg-stone-100"
          aria-label="Настройки агента"
          onClick={() => setSettingsOpen((open) => !open)}
        >
          {settingsOpen ? "Закрыть" : "Агент"}
        </button>
      </header>
      {settingsOpen ? (
        <div className="nodrag nowheel flex-1 overflow-y-auto">
          <AgentSettingsPanel onClose={() => setSettingsOpen(false)} />
        </div>
      ) : (
        <AssistantRuntimeProvider runtime={runtime}>
          <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
            <ThreadPrimitive.Viewport className="nodrag nowheel flex min-h-0 flex-1 cursor-auto flex-col gap-2 overflow-y-auto px-3 py-3 select-text">
              {chat.messages.length === 0 && (
                <p className="m-auto text-center text-sm text-stone-500">Поздоровайтесь, чтобы начать подготовку.</p>
              )}
              <ThreadPrimitive.Messages>
                {({ message }) => <ChatBubble message={byId.get(message.id)} />}
              </ThreadPrimitive.Messages>
              {chat.busy && byId.size > 0 && [...byId.values()].at(-1)?.role === "candidate" && (
                <p className="text-xs text-stone-400">Интервьюер думает…</p>
              )}
            </ThreadPrimitive.Viewport>
            {chat.error && <p className="border-t border-red-200 bg-red-50 px-3 py-1 text-xs text-red-800">{chat.error}</p>}
            <ComposerPrimitive.Root className="nodrag flex items-end gap-2 border-t border-stone-200 p-2">
              <ComposerPrimitive.Input
                rows={1}
                data-focus-target
                placeholder="Написать интервьюеру…"
                className="max-h-40 min-h-9 flex-1 resize-none rounded border border-stone-300 px-2 py-1.5 text-sm outline-none focus:border-stone-500"
              />
              {chat.busy ? (
                <ComposerPrimitive.Cancel className="rounded bg-stone-200 px-3 py-1.5 text-sm text-stone-800 hover:bg-stone-300">
                  Стоп
                </ComposerPrimitive.Cancel>
              ) : (
                <ComposerPrimitive.Send className="rounded bg-stone-800 px-3 py-1.5 text-sm text-white disabled:bg-stone-300">
                  Отправить
                </ComposerPrimitive.Send>
              )}
            </ComposerPrimitive.Root>
          </ThreadPrimitive.Root>
        </AssistantRuntimeProvider>
      )}
    </div>
  );
}

function ChatBubble({ message }: { message: ChatMessage | undefined }) {
  if (!message) return null;
  if (message.role === "notice") {
    return (
      <MessagePrimitive.Root className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
        {message.text}
      </MessagePrimitive.Root>
    );
  }
  const mine = message.role === "candidate";
  const card = message.card;
  return (
    <MessagePrimitive.Root className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
      {card && (
        <button
          type="button"
          title="Показать карточку"
          onClick={() => focusCard(card.id)}
          className="mb-1 max-w-[85%] truncate rounded-md border border-indigo-100 bg-indigo-50/60 px-2 py-1 text-left text-[11px] text-indigo-700 hover:bg-indigo-50"
        >
          ↗ {card.prompt}
        </button>
      )}
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
          mine ? "bg-stone-800 text-white" : "bg-stone-100 text-stone-900"
        }`}
      >
        {mine || !message.text ? message.text || (message.status === "streaming" ? "…" : "") : <Markdown text={message.text} />}
        {message.proposal && <ProposalCard proposal={message.proposal} />}
        {message.toolCalls.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-xs text-stone-500">
            {message.toolCalls.map((call) => (
              <li key={call.id}>
                {call.server && call.tool ? `${call.server}.${call.tool}` : call.title} · {call.status}
              </li>
            ))}
          </ul>
        )}
      </div>
      {message.status === "cancelled" && <span className="mt-0.5 text-xs text-stone-400">Остановлено</span>}
      {message.status === "failed" && <span className="mt-0.5 text-xs text-red-600">Не закончено</span>}
    </MessagePrimitive.Root>
  );
}
