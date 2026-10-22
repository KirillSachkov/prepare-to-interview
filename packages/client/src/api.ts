import {
  apiPaths,
  type CanvasSnapshot,
  type LayoutUpdate,
  type LayoutUpdateRequest,
  type ServerEvent,
} from "@prepare-to-interview/shared";

// The browser authenticates with the HttpOnly cookie set when the tokenized URL was opened.

/** A JSON request to the app; a failure throws the server's `error` text when it sent one. */
export async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? "GET",
    credentials: "same-origin",
    ...(init.body !== undefined && { headers: { "Content-Type": "application/json" }, body: JSON.stringify(init.body) }),
  });
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) {
    const message = (body as { error?: string } | undefined)?.error;
    throw new Error(message ?? `Request failed: ${res.status}`);
  }
  return body as T;
}

export async function fetchCanvas(): Promise<CanvasSnapshot> {
  const res = await fetch(apiPaths.canvas, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`Canvas request failed: ${res.status}`);
  return (await res.json()) as CanvasSnapshot;
}

/** Stores node positions or collapsed state in the layout store. */
export async function saveLayout(updates: LayoutUpdate[]): Promise<void> {
  const body: LayoutUpdateRequest = { updates };
  const res = await fetch(apiPaths.canvasLayout, {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Layout save failed: ${res.status} ${await res.text()}`);
}

/**
 * Subscribes to live server events, reconnecting after drops; `onOpen` runs on every (re)connect
 * and `onDisconnect` whenever the channel is down.
 */
export function subscribeToEvents(handlers: {
  onOpen: () => void;
  onEvent: (event: ServerEvent) => void;
  onDisconnect: () => void;
}): () => void {
  let socket: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const connect = () => {
    const url = new URL(apiPaths.events, window.location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(url);
    socket.onopen = handlers.onOpen;
    socket.onmessage = (message: MessageEvent<string>) => handlers.onEvent(JSON.parse(message.data) as ServerEvent);
    socket.onclose = () => {
      if (stopped) return;
      handlers.onDisconnect();
      retry = setTimeout(connect, 1000);
    };
  };
  connect();

  return () => {
    stopped = true;
    clearTimeout(retry);
    socket?.close();
  };
}
