// Contract between the app server and the browser client: REST paths, Canvas shapes, and
// live events pushed over the WebSocket channel.

export const apiPaths = {
  canvas: "/api/canvas",
  /** PUT a {@link LayoutUpdateRequest}: where nodes sit and whether they are collapsed. */
  canvasLayout: "/api/canvas/layout",
  events: "/api/events",
  mcp: "/mcp",
} as const;

/** Query parameter that carries the access token in the URL printed at start. */
export const tokenQueryParam = "token";

export interface CanvasPosition {
  x: number;
  y: number;
}

/** How a node sits on the Canvas; kept in the layout store, apart from domain data. */
export interface NodeLayout {
  position: CanvasPosition;
  collapsed: boolean;
}

interface CanvasNodeBase extends NodeLayout {
  id: string;
}

/** Placeholder node kind proving the stack end to end; real Cards arrive with the domain tickets. */
export interface DemoNoteNode extends CanvasNodeBase {
  kind: "demo_note";
  data: {
    title: string;
    body: string;
  };
}

/** The single Chat node; the Canvas always has it, whether or not the Candidate shows it. */
export const chatNodeId = "chat";

export interface ChatNode extends CanvasNodeBase {
  id: typeof chatNodeId;
  kind: "chat";
  data: Record<string, never>;
}

export type CanvasNode = DemoNoteNode | ChatNode;
export type CanvasNodeKind = CanvasNode["kind"];

export interface CanvasSnapshot {
  nodes: CanvasNode[];
}

/** One node's layout change; omitted fields keep their stored value. */
export interface LayoutUpdate {
  nodeId: string;
  position?: CanvasPosition;
  collapsed?: boolean;
}

export interface LayoutUpdateRequest {
  updates: LayoutUpdate[];
}

export interface NodeLayoutEntry extends NodeLayout {
  nodeId: string;
}

export type ServerEvent =
  | { type: "canvas.node_added"; node: CanvasNode }
  | { type: "canvas.layout_changed"; layouts: NodeLayoutEntry[] };
