import { useCallback, useEffect, useMemo, useState } from "react";
import { stripHiddenState, type ChatMessage, type ServerEvent } from "@prepare-to-interview/shared";
import { subscribeToEvents } from "../api.ts";
import { fetchChat, sendChatMessage, stopReply } from "./chat-api.ts";

export interface ChatState {
  messages: ChatMessage[];
  busy: boolean;
  /** A problem reaching the app itself; agent errors arrive as notice messages. */
  error: string | undefined;
  send: (text: string) => Promise<void>;
  stop: () => Promise<void>;
}

function upsert(messages: ChatMessage[], message: ChatMessage): ChatMessage[] {
  const index = messages.findIndex((m) => m.id === message.id);
  if (index === -1) return [...messages, message];
  const next = [...messages];
  next[index] = message;
  return next;
}

/** The Chat as stored on the server, kept live over the event channel. */
export function useChat(): ChatState {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(
    () =>
      subscribeToEvents({
        // The snapshot loads after the live channel opens, so no change falls between them.
        onOpen: () => {
          fetchChat()
            .then((snapshot) => {
              setError(undefined);
              setMessages(snapshot.messages);
              setBusy(snapshot.busy);
            })
            .catch((e: unknown) => setError(String(e)));
        },
        onEvent: (event: ServerEvent) => {
          if (event.type === "chat.message") setMessages((current) => upsert(current, event.message));
          else if (event.type === "chat.delta") {
            setMessages((current) =>
              current.map((m) => (m.id === event.messageId ? { ...m, text: m.text + event.text } : m)),
            );
          } else if (event.type === "chat.busy") setBusy(event.busy);
        },
        onDisconnect: () => setError("Нет связи с приложением."),
      }),
    [],
  );

  const send = useCallback(async (text: string) => {
    try {
      await sendChatMessage(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const stop = useCallback(async () => {
    try {
      await stopReply();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // Streamed text may carry a hidden state echo until the final message replaces it.
  const visible = useMemo(() => messages.map((m) => ({ ...m, text: stripHiddenState(m.text) })), [messages]);
  return { messages: visible, busy, error, send, stop };
}
