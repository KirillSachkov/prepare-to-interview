import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { NodeResizer, type Node, type NodeProps } from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";
import { agentLabels, type AgentId, type ChatMessage } from "@prepare-to-interview/shared";
import { AgentSettingsPanel } from "../settings/AgentSettingsPanel.tsx";
import { fetchAgents } from "./chat-api.ts";
import { useChat } from "./useChat.ts";

/** The Chat lives on the Canvas as a single node; its id is fixed. */
export const chatNodeId = "chat";
export type ChatFlowNode = Node<Record<string, never>, "chat">;

/** Default placement and size; the Canvas layout store may override them. */
export const chatFlowNode: ChatFlowNode = {
  id: chatNodeId,
  type: "chat",
  position: { x: -440, y: 0 },
  data: {},
  dragHandle: ".chat-drag-handle",
  style: { width: 400, height: 560 },
};

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

/** Chat node: streamed Interviewer replies, stop, and the stored history, on the Candidate's agent. */
export function ChatNode({ selected }: NodeProps<ChatFlowNode>) {
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
      <header className="chat-drag-handle flex cursor-grab items-center justify-between border-b border-stone-200 px-3 py-2">
        <div>
          <div className="text-sm font-medium text-stone-900">Interviewer</div>
          <div className="text-xs text-stone-500">{agent ? `on ${agentLabels[agent]}` : "No agent chosen"}</div>
        </div>
        <button
          type="button"
          className="nodrag rounded px-2 py-1 text-xs text-stone-600 hover:bg-stone-100"
          aria-label="Agent settings"
          onClick={() => setSettingsOpen((open) => !open)}
        >
          {settingsOpen ? "Close" : "Agent"}
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
                <p className="m-auto text-center text-sm text-stone-500">Say hello to start preparing.</p>
              )}
              <ThreadPrimitive.Messages>
                {({ message }) => <ChatBubble message={byId.get(message.id)} />}
              </ThreadPrimitive.Messages>
              {chat.busy && byId.size > 0 && [...byId.values()].at(-1)?.role === "candidate" && (
                <p className="text-xs text-stone-400">Interviewer is thinking…</p>
              )}
            </ThreadPrimitive.Viewport>
            {chat.error && <p className="border-t border-red-200 bg-red-50 px-3 py-1 text-xs text-red-800">{chat.error}</p>}
            <ComposerPrimitive.Root className="nodrag flex items-end gap-2 border-t border-stone-200 p-2">
              <ComposerPrimitive.Input
                rows={1}
                autoFocus
                placeholder="Write to the Interviewer…"
                className="max-h-40 min-h-9 flex-1 resize-none rounded border border-stone-300 px-2 py-1.5 text-sm outline-none focus:border-stone-500"
              />
              {chat.busy ? (
                <ComposerPrimitive.Cancel className="rounded bg-stone-200 px-3 py-1.5 text-sm text-stone-800 hover:bg-stone-300">
                  Stop
                </ComposerPrimitive.Cancel>
              ) : (
                <ComposerPrimitive.Send className="rounded bg-stone-800 px-3 py-1.5 text-sm text-white disabled:bg-stone-300">
                  Send
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
  return (
    <MessagePrimitive.Root className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
          mine ? "bg-stone-800 text-white" : "bg-stone-100 text-stone-900"
        }`}
      >
        {message.text || (message.status === "streaming" ? "…" : "")}
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
      {message.status === "cancelled" && <span className="mt-0.5 text-xs text-stone-400">Stopped</span>}
      {message.status === "failed" && <span className="mt-0.5 text-xs text-red-600">Not finished</span>}
    </MessagePrimitive.Root>
  );
}
