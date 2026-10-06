#!/usr/bin/env node
/**
 * Local trading-control MCP server (stdio). Gives Claude Code research and
 * operator capabilities over the local Trading API without credentials or
 * any direct order authority.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { TradingApiClient } from "./client";
import { TOOLS } from "./tools";

const api = new TradingApiClient({
  baseUrl: process.env.API_URL ?? "http://127.0.0.1:4100",
  ...(process.env.CONTROL_API_TOKEN ? { token: process.env.CONTROL_API_TOKEN } : {}),
  ...(process.env.CLAUDE_MODEL ? { model: process.env.CLAUDE_MODEL } : {}),
});

const server = new McpServer({ name: "trading-control", version: "0.1.0" });

for (const tool of TOOLS) {
  server.registerTool(tool.name, { description: tool.description, inputSchema: tool.input }, async (args: Record<string, unknown>) => {
    try {
      const result = await tool.run(api, args);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { isError: true, content: [{ type: "text" as const, text: (err as Error).message }] };
    }
  });
}

await server.connect(new StdioServerTransport());
