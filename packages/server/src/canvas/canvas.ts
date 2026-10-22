import crypto from "node:crypto";
import { count, eq } from "drizzle-orm";
import type { CanvasNode, CanvasSnapshot, DemoNoteNode } from "@prepare-to-interview/shared";
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
    return { nodes: rows.map((row) => toNode(row.demo_notes, row.canvas_layout)) };
  }

  /** Stores a demo note, places it on the next free grid cell, and notifies live clients. */
  placeDemoNote(input: DemoNoteInput): CanvasNode {
    const node = this.#db.transaction((tx) => {
      const placed = tx.select({ placed: count() }).from(canvasLayout).get()?.placed ?? 0;
      const note = { id: crypto.randomUUID(), title: input.title, body: input.body, createdAt: new Date() };
      const layout = {
        nodeId: note.id,
        x: (placed % columns) * cellWidth,
        y: Math.floor(placed / columns) * cellHeight,
      };
      tx.insert(demoNotes).values(note).run();
      tx.insert(canvasLayout).values(layout).run();
      return toNode(note, layout);
    });
    this.#events.publish({ type: "canvas.node_added", node });
    return node;
  }
}

function toNode(
  note: typeof demoNotes.$inferSelect,
  layout: typeof canvasLayout.$inferSelect,
): DemoNoteNode {
  return {
    id: note.id,
    kind: "demo_note",
    position: { x: layout.x, y: layout.y },
    data: { title: note.title, body: note.body },
  };
}
