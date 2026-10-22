import crypto from "node:crypto";
import { count, eq, inArray } from "drizzle-orm";
import {
  chatNodeId,
  type CanvasNode,
  type CanvasSnapshot,
  type ChatNode,
  type DemoNoteNode,
  type LayoutUpdate,
  type NodeLayout,
  type NodeLayoutEntry,
} from "@prepare-to-interview/shared";
import type { Database } from "../db/database.ts";
import { canvasLayout, demoNotes } from "../db/schema.ts";
import type { EventBus } from "../events.ts";

export interface DemoNoteInput {
  title: string;
  body: string;
}

const columns = 4;
const cellWidth = 280;
const cellHeight = 180;

/** Until the Candidate moves it, the Chat sits left of the first grid cell. */
const defaultChatLayout: NodeLayout = { position: { x: -420, y: 0 }, collapsed: false };

/** A layout update named a node the Canvas does not have. */
export class UnknownNodeError extends Error {
  readonly nodeIds: string[];

  constructor(nodeIds: string[]) {
    super(`Unknown Canvas node: ${nodeIds.join(", ")}`);
    this.nodeIds = nodeIds;
  }
}

type LayoutRow = typeof canvasLayout.$inferSelect;

/** What the Canvas shows, assembled from domain records and their stored layout. */
export class Canvas {
  readonly #db: Database;
  readonly #events: EventBus;

  constructor(db: Database, events: EventBus) {
    this.#db = db;
    this.#events = events;
  }

  snapshot(): CanvasSnapshot {
    const rows = this.#db
      .select()
      .from(demoNotes)
      .innerJoin(canvasLayout, eq(canvasLayout.nodeId, demoNotes.id))
      .orderBy(demoNotes.createdAt, demoNotes.id)
      .all();
    const chatRow = this.#db.select().from(canvasLayout).where(eq(canvasLayout.nodeId, chatNodeId)).get();
    return {
      nodes: [toChatNode(chatRow), ...rows.map((row) => toNoteNode(row.demo_notes, row.canvas_layout))],
    };
  }

  /** Stores a demo note, places it on the next free grid cell, and notifies live clients. */
  placeDemoNote(input: DemoNoteInput): CanvasNode {
    const node = this.#db.transaction((tx) => {
      const placed = tx.select({ placed: count() }).from(demoNotes).get()?.placed ?? 0;
      const note = { id: crypto.randomUUID(), title: input.title, body: input.body, createdAt: new Date() };
      const layout = {
        nodeId: note.id,
        x: (placed % columns) * cellWidth,
        y: Math.floor(placed / columns) * cellHeight,
        collapsed: false,
      };
      tx.insert(demoNotes).values(note).run();
      tx.insert(canvasLayout).values(layout).run();
      return toNoteNode(note, layout);
    });
    this.#events.publish({ type: "canvas.node_added", node });
    return node;
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

function toNoteNode(note: typeof demoNotes.$inferSelect, layout: LayoutRow): DemoNoteNode {
  return { id: note.id, kind: "demo_note", ...toLayout(layout), data: { title: note.title, body: note.body } };
}
