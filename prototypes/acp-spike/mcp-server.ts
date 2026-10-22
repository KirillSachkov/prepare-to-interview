// PROTOTYPE: tiny in-process HTTP MCP server with one stub tool.
import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

export type RecordedCall = { at: string; args: unknown };

export async function startMcpServer(log: (e: object) => void) {
  const calls: RecordedCall[] = [];

  function buildServer() {
    const server = new McpServer({ name: "interview", version: "0.0.0" });
    server.registerTool(
      "record_attempt",
      {
        description: "Record the Candidate's attempt at a question with a 0-3 rubric score.",
        inputSchema: {
          question_id: z.string(),
          score: z.number().int().min(0).max(3),
          evidence_quote: z.string(),
        },
      },
      async (args) => {
        const call = { at: new Date().toISOString(), args };
        calls.push(call);
        log({ type: "mcp.record_attempt", ...call });
        return { content: [{ type: "text", text: `recorded attempt for ${args.question_id}` }] };
      },
    );
    return server;
  }

  const httpServer = http.createServer(async (req, res) => {
    // Stateless mode: a fresh server + transport per request.
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
    log({ type: "mcp.http", method: req.method, rpc: body?.method });
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  });

  await new Promise<void>((r) => httpServer.listen(0, "127.0.0.1", r));
  const port = (httpServer.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    calls,
    close: () => httpServer.close(),
  };
}
