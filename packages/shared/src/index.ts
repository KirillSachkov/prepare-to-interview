// Contract between the app server and the browser client: REST paths, Canvas shapes, and
// live events pushed over the WebSocket channel.

export const apiPaths = {
  canvas: "/api/canvas",
  events: "/api/events",
  mcp: "/mcp",
} as const;

/** Query parameter that carries the access token in the URL printed at start. */
export const tokenQueryParam = "token";

export interface CanvasPosition {
  x: number;
  y: number;
}

/** Placeholder node kind proving the stack end to end; real Cards arrive with the domain tickets. */
export interface DemoNoteNode {
  id: string;
  kind: "demo_note";
  position: CanvasPosition;
  data: {
    title: string;
    body: string;
  };
}

export type CanvasNode = DemoNoteNode;

export interface CanvasSnapshot {
  nodes: CanvasNode[];
}

export type ServerEvent = { type: "canvas.node_added"; node: CanvasNode };
