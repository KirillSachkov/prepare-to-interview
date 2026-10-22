import { z } from "zod";
import { maxHintRungs } from "../domain/arithmetic.ts";

/** Who is calling a tool, from the role token of the request (see `createApp`). */
export interface ToolContext {
  /** True for the Chat's Agent session. */
  fromChat: boolean;
}

/** Trimmed, non-empty text of at most `max` characters. */
export const shortText = (max: number) => z.string().trim().min(1).max(max);

// Input pieces the Chat's and Research's tools share, so the same field validates the same way.

export const topicName = shortText(120).describe('Topic name as the Market names it, such as "PostgreSQL indexes".');

export const rubricAnchorsInput = z
  .strictObject({ "0": shortText(500).optional(), "1": shortText(500).optional(), "2": shortText(500).optional(), "3": shortText(500).optional() })
  .describe("What each Rubric score means for this Question.");

export const testOptionsInput = z
  .array(z.strictObject({ text: shortText(500), correct: z.boolean() }))
  .min(2)
  .max(10)
  .describe("Test options; only for single_choice and multiple_choice.");

export const hintsInput = z.array(shortText(500)).max(maxHintRungs).describe("Hint ladder rungs, mildest first.");

/**
 * One MCP tool the Interviewer may call. Input and output are strict schemas: unknown fields are
 * rejected, and every failure returns `isError` with a hint on how to fix the call.
 */
export interface ToolDefinition<Input extends z.ZodObject = z.ZodObject, Output extends z.ZodObject = z.ZodObject> {
  name: string;
  title: string;
  description: string;
  input: Input;
  output: Output;
  /** Shown after validation errors: what a correct call looks like. */
  fixHint: string;
  run: (input: z.output<Input>, context: ToolContext) => z.input<Output>;
  /** Concise, readable text for the agent; structured output carries the data. */
  summarize: (output: z.output<Output>) => string;
}

export function defineTool<Input extends z.ZodObject, Output extends z.ZodObject>(
  tool: ToolDefinition<Input, Output>,
): ToolDefinition {
  return tool;
}
