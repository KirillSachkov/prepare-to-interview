import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Placeholder domain record for the walking skeleton; real domain tables replace it. */
export const demoNotes = sqliteTable("demo_notes", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

/** Canvas layout is stored apart from domain data: one row per node shown on the Canvas. */
export const canvasLayout = sqliteTable("canvas_layout", {
  nodeId: text("node_id").primaryKey(),
  x: real("x").notNull(),
  y: real("y").notNull(),
});
