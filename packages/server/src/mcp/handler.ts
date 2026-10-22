import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { DomainError } from "../domain/domain.ts";
import type { ToolContext, ToolDefinition } from "./tool.ts";

/** Server name agents see as the tool namespace (`mcp__interview__…`, `interview_…`). */
export const mcpServerName = "interview";

/** Serves one MCP request; the caller's role comes from its token, which the HTTP route checked. */
export type McpHandler = (request: Request, context: ToolContext) => Promise<Response>;

/**
 * Stateless Streamable HTTP: every request gets a fresh MCP server and transport, so agents can
 * reconnect at will and no MCP session state lives in the app.
 */
export function createMcpHandler(tools: readonly ToolDefinition[], version: string): McpHandler {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const listing = tools.map(describeTool);

  return async (request, context) => {
    const server = new McpServer({ name: mcpServerName, version }, { capabilities: { tools: {} } });
    server.server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: listing }));
    server.server.setRequestHandler(CallToolRequestSchema, (call) =>
      callTool(byName, call.params.name, call.params.arguments, context),
    );
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
      return await transport.handleRequest(request);
    } finally {
      await server.close();
    }
  };
}

function describeTool(tool: ToolDefinition): Tool {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: jsonSchema(tool.input, "input"),
    outputSchema: jsonSchema(tool.output, "output"),
  };
}

function jsonSchema(schema: z.ZodObject, io: "input" | "output"): Tool["inputSchema"] {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, { io }) as Record<string, unknown>;
  return { ...rest, type: "object" };
}

function callTool(byName: Map<string, ToolDefinition>, name: string, args: unknown, context: ToolContext): CallToolResult {
  const tool = byName.get(name);
  if (!tool) {
    return toolError(`Unknown tool "${name}".`, `Call one of: ${[...byName.keys()].join(", ")}.`);
  }
  const parsed = tool.input.safeParse(args ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `- ${issue.path.join(".") || "(input)"}: ${issue.message}`);
    return toolError(`Invalid input for ${tool.name}:\n${issues.join("\n")}`, tool.fixHint);
  }
  let output;
  try {
    output = tool.output.parse(tool.run(parsed.data, context));
  } catch (error) {
    if (error instanceof DomainError) return toolError(error.message, error.fixHint);
    throw error;
  }
  return { content: [{ type: "text", text: tool.summarize(output) }], structuredContent: output };
}

function toolError(message: string, fixHint: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: `${message}\nFix: ${fixHint}` }] };
}
