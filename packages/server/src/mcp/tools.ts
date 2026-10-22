import { z } from "zod";
import type { Canvas } from "../canvas/canvas.ts";
import { defineTool, type ToolDefinition } from "./tool.ts";

/** The app's MCP tool set. The walking skeleton exposes one demo tool. */
export function createTools(canvas: Canvas): ToolDefinition[] {
  return [
    defineTool({
      name: "demo_place_note",
      title: "Place a demo note",
      description: "Place a short note on the Candidate's Canvas. Demo tool proving the MCP-to-Canvas path.",
      input: z.strictObject({
        title: z.string().trim().min(1).max(120).describe("Short heading shown on the note, 1-120 characters."),
        body: z.string().trim().max(2000).default("").describe("Optional note text, up to 2000 characters."),
      }),
      output: z.strictObject({
        node_id: z.string(),
        title: z.string(),
      }),
      fixHint: 'Pass {"title": "<1-120 characters>", "body": "<optional, up to 2000 characters>"} and no other fields.',
      run: (input) => {
        const node = canvas.placeDemoNote(input);
        return { node_id: node.id, title: node.data.title };
      },
      summarize: (output) => `Placed note "${output.title}" on the Canvas (node ${output.node_id}).`,
    }),
  ];
}
