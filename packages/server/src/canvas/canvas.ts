import { eq, inArray } from "drizzle-orm";
import {
  chatNodeId,
  type CanvasFocus,
  type CanvasNode,
  type CanvasSnapshot,
  type ChatNode,
  type LayoutUpdate,
  type NodeLayout,
  type NodeLayoutEntry,
} from "@prepare-to-interview/shared";
import type { Database } from "../db/database.ts";
import { canvasLayout } from "../db/schema.ts";
import type { EventBus } from "../events.ts";

/** Until the Candidate moves it, the Chat sits left of the first placed node. */
const defaultChatLayout: NodeLayout = { position: { x: -460, y: 0 }, collapsed: false };
/** Horizontal gap between placed nodes. */
const placementGap = 80;

/** A layout update named a node the Canvas does not have. */
export class UnknownNodeError extends Error {
  readonly nodeIds: string[];

  constructor(nodeIds: string[]) {
    super(`Unknown Canvas node: ${nodeIds.join(", ")}`);
    this.nodeIds = nodeIds;
  }
}

/** Domain records the Canvas shows, such as Practice sets; each source owns its node ids. */
export type NodeSource = () => CanvasNode[];

type LayoutRow = typeof canvasLayout.$inferSelect;

/**
 * What the Canvas shows: the Chat plus nodes from domain sources, each with its stored layout.
 * The layout store holds only positions and collapsed state, apart from domain data.
 */
export class Canvas {
  readonly #db: Database;
  readonly #events: EventBus;
  readonly #sources: NodeSource[] = [];

  constructor(db: Database, events: EventBus) {
    this.#db = db;
    this.#events = events;
  }

  /** Adds domain nodes to every snapshot; call once per source at startup. */
  addSource(source: NodeSource): void {
    this.#sources.push(source);
  }

  snapshot(): CanvasSnapshot {
    const chatRow = this.#db.select().from(canvasLayout).where(eq(canvasLayout.nodeId, chatNodeId)).get();
    return { nodes: [toChatNode(chatRow), ...this.#sources.flatMap((source) => source())] };
  }

  /** The stored layout of each given node that has one. */
  layouts(nodeIds: string[]): Map<string, NodeLayout> {
    if (!nodeIds.length) return new Map();
    const rows = this.#db.select().from(canvasLayout).where(inArray(canvasLayout.nodeId, nodeIds)).all();
    return new Map(rows.map((row) => [row.nodeId, toLayout(row)]));
  }

  /**
   * Gives a new node a place right of every placed node, `width` being the caller's estimate of
   * the rightmost node's width. Returns the stored layout.
   */
  place(nodeId: string, estimatedWidth: number): NodeLayout {
    const rows = this.#db.select().from(canvasLayout).all().filter((r) => r.nodeId !== chatNodeId);
    const rightmost = rows.reduce<LayoutRow | undefined>((best, r) => (!best || r.x > best.x ? r : best), undefined);
    const layout: NodeLayout = {
      position: { x: rightmost ? rightmost.x + estimatedWidth + placementGap : 0, y: rightmost ? rightmost.y : 0 },
      collapsed: false,
    };
    const row = { nodeId, x: layout.position.x, y: layout.position.y, collapsed: false };
    this.#db.insert(canvasLayout).values(row).onConflictDoUpdate({ target: canvasLayout.nodeId, set: row }).run();
    return layout;
  }

  /** Tells live clients about a node that just appeared. */
  added(node: CanvasNode): void {
    this.#events.publish({ type: "canvas.node_added", node });
  }

  /** Tells live clients to bring something into view and highlight it. */
  focus(focus: CanvasFocus): void {
    this.#events.publish({ type: "canvas.focus", focus });
  }

  /** Tells live clients about a node whose content changed. */
  updated(node: CanvasNode): void {
    this.#events.publish({ type: "canvas.node_updated", node });
  }

  /** Drops a node's layout and tells live clients it is gone. */
  removed(nodeId: string): void {
    this.#db.delete(canvasLayout).where(eq(canvasLayout.nodeId, nodeId)).run();
    this.#events.publish({ type: "canvas.node_removed", nodeId });
  }

  /**
   * Applies layout changes atomically and notifies live clients. Throws {@link UnknownNodeError}
   * and changes nothing when any update names a node the Canvas does not have.
   */
  updateLayout(updates: LayoutUpdate[]): NodeLayoutEntry[] {
    if (!updates.length) return [];
    const layouts = this.#db.transaction((tx) => {
      const ids = [...new Set(updates.map((u) => u.nodeId))];
      const stored = new Map(
        tx.select().from(canvasLayout).where(inArray(canvasLayout.nodeId, ids)).all().map((row) => [row.nodeId, row]),
      );
      const unknown = ids.filter((id) => id !== chatNodeId && !stored.has(id));
      if (unknown.length) throw new UnknownNodeError(unknown);

      const changed = new Map<string, NodeLayoutEntry>();
      for (const update of updates) {
        const current = changed.get(update.nodeId) ?? toEntry(update.nodeId, stored.get(update.nodeId));
        const next: NodeLayoutEntry = {
          nodeId: update.nodeId,
          position: update.position ?? current.position,
          collapsed: update.collapsed ?? current.collapsed,
        };
        const row = { nodeId: next.nodeId, x: next.position.x, y: next.position.y, collapsed: next.collapsed };
        tx.insert(canvasLayout).values(row).onConflictDoUpdate({ target: canvasLayout.nodeId, set: row }).run();
        changed.set(update.nodeId, next);
      }
      return [...changed.values()];
    });
    this.#events.publish({ type: "canvas.layout_changed", layouts });
    return layouts;
  }
}

function toEntry(nodeId: string, row: LayoutRow | undefined): NodeLayoutEntry {
  if (row) return { nodeId, ...toLayout(row) };
  return { nodeId, ...defaultChatLayout };
}

function toLayout(row: LayoutRow): NodeLayout {
  return { position: { x: row.x, y: row.y }, collapsed: row.collapsed };
}

function toChatNode(row: LayoutRow | undefined): ChatNode {
  return { id: chatNodeId, kind: "chat", ...(row ? toLayout(row) : defaultChatLayout), data: {} };
}
