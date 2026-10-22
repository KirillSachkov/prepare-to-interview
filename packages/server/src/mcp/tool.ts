import { z } from "zod";

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
  run: (input: z.output<Input>) => z.input<Output>;
  /** Concise, readable text for the agent; structured output carries the data. */
  summarize: (output: z.output<Output>) => string;
}

export function defineTool<Input extends z.ZodObject, Output extends z.ZodObject>(
  tool: ToolDefinition<Input, Output>,
): ToolDefinition {
  return tool;
}
